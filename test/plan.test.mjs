import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeDrive, TEST_CLIENT } from "./fakes/drive.mjs";
import { Drive, Confined } from "../lib/core/drive.mjs";
import { DEFAULTS } from "../lib/core/settings.mjs";
import { readTree, proposePlan, proposeWithAi, sentences, resolveFolder, segments, fileName, confirmPlan, folderChoices } from "../lib/core/plan.mjs";

const KIT = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "kit", "kit.json"), "utf8"));
const settings = structuredClone(DEFAULTS);
const types = KIT.paperless.types;
const senders = KIT.paperless.correspondents;

async function kitDrive() {
  const fake = await startFakeDrive({ tree: KIT.drive.tree });
  const drive = new Drive({ creds: { client_id: TEST_CLIENT.id, client_secret: TEST_CLIENT.secret, refresh_token: fake.issue() }, env: fake.env });
  const confined = await new Confined(drive, { rootId: fake.idOf("Paperwork") }).load();
  return { fake, confined };
}

test("the plan from the existing tree: each type to the folder named like it", async () => {
  const { fake, confined } = await kitDrive();
  try {
    const tree = readTree(confined);
    assert.deepEqual(tree.map((f) => f.name).sort(), ["Bank", "Insurance", "Invoices", "Letters", "Payslips", "Taxes"]);
    const plan = proposePlan({ tree, types, senders, settings });
    const by = Object.fromEntries(plan.rules.map((r) => [r.type, r.folder]));
    assert.equal(by.Invoice, "Invoices/{sender}");
    assert.equal(by["Tax assessment"], "Taxes/{year}");
    assert.equal(by.Insurance, "Insurance");
    assert.equal(by["Pay slip"], "Payslips/{year}");
    assert.equal(by.Letter, "Letters");
    assert.equal(by["Bank statement"], "Bank");
    assert.deepEqual(plan.open.sort(), ["Certificate", "Contract", "Receipt"]);
  } finally { await fake.close(); }
});

test("the AI fills the types left open, only with folders that exist", async () => {
  const { fake, confined } = await kitDrive();
  try {
    const tree = readTree(confined);
    const first = proposePlan({ tree, types, senders, settings });
    const asked = [];
    const ask = async (req) => {
      asked.push(req);
      return { text: JSON.stringify({ rules: [{ type: "Certificate", folder: "Taxes/{year}" }, { type: "Receipt", folder: "Receipts" }, { type: "Invoice", folder: "Letters" }, { type: "Contract", folder: "Letters/{sender}" }], confident: true }), provider: "p" };
    };
    const plan = await proposeWithAi({ plan: first, tree, types, senders, settings, ask });
    const by = Object.fromEntries(plan.rules.map((r) => [r.type, r.folder]));
    assert.equal(by.Certificate, "Taxes/{year}");
    assert.equal(by.Contract, "Letters/{sender}");
    assert.equal(by.Invoice, "Invoices/{sender}");
    assert.equal(by.Receipt, undefined);
    assert.match(plan.notes.join(" "), /Receipts/);
    assert.match(asked[0].prompt, /Payslips/);
    assert.doesNotMatch(asked[0].prompt, /handwritten note/);
    const kitTypes = ["Invoice", "Tax assessment", "Insurance", "Pay slip", "Letter", "Certificate"];
    const tops = tree.map((f) => f.name);
    for (const t of kitTypes) assert.ok(tops.includes(by[t].split("/")[0]), t);
  } finally { await fake.close(); }
});

test("a plan that is one sender rule says so plainly, and says how subfolders are used", () => {
  const s = sentences({ rules: [{ folder: "{sender}" }], to_sort: { name: "Zu sortieren" } });
  assert.equal(s[0], "Each paper goes into its sender's folder.");
  assert.match(s.join(" "), /subfolder/);
  assert.equal(s[s.length - 1], "Anything the Clerk cannot place stays in \"Zu sortieren\".");
});

test("the plan in plain words", () => {
  const s = sentences({ rules: [{ type: "Invoice", folder: "Invoices/{sender}" }, { tag: "Home", folder: "Home" }, { folder: "{sender}" }], to_sort: { name: "To sort" } });
  assert.deepEqual(s, [
    "\"Invoice\" papers go to Invoices/<sender>.",
    "Papers tagged \"Home\" go to Home.",
    "Everything else goes to <sender>.",
    "Inside a sender's folder it uses the subfolder that fits, if there is one. It makes a new folder only for a sender that has none yet, or for a missing year where the subfolders are years.",
    "Anything the Clerk cannot place stays in \"To sort\".",
  ]);
});

test("the first rule that fits decides, and a rule that needs a sender needs one", () => {
  const plan = { rules: [{ type: "Invoice", folder: "Invoices/{sender}" }, { type: "Invoice", folder: "Invoices" }, { tag: "Car", folder: "Car" }, { folder: "Letters" }] };
  assert.equal(resolveFolder(plan, { type: "Invoice", sender: "Brightwater Utilities", tags: [] }), "Invoices/{sender}");
  assert.equal(resolveFolder(plan, { type: "Invoice", sender: null, tags: [] }), "Invoices");
  assert.equal(resolveFolder(plan, { type: "Letter", sender: null, tags: ["Car"] }), "Car");
  assert.equal(resolveFolder({ rules: [{ type: "Invoice", folder: "Invoices" }] }, { type: "Letter", tags: [] }), null);
  assert.deepEqual(folderChoices(plan), ["Invoices/{sender}", "Invoices", "Car", "Letters"]);
});

test("placeholders: the year of the one tax tag, else of the date; only placeholders are made", () => {
  const meta = { type: "Tax assessment", sender: "Fairford Revenue Office", tags: ["Tax 2024"], date: "2025-09-18" };
  assert.deepEqual(segments("Taxes/{year}", meta, settings), [{ name: "Taxes", create: false, sender: false }, { name: "2024", create: true, sender: false }]);
  assert.equal(segments("Taxes/{year}", { ...meta, tags: [] }, settings)[1].name, "2025");
  assert.equal(segments("Taxes/{year}", { ...meta, tags: ["Tax 2023", "Tax 2024"] }, settings)[1].name, "2025");
  assert.deepEqual(segments("Invoices/{sender}", { ...meta, sender: "Hollis / Sons" }, settings)[1], { name: "Hollis - Sons", create: true, sender: true });
});

test("fileName cleans and shortens", () => {
  assert.equal(fileName("2025-03-04", "Electricity invoice March 2025"), "2025-03-04 Electricity invoice March 2025.pdf");
  assert.equal(fileName("2025-03-04", "a/b: c\nd*?"), "2025-03-04 a-b - c d--.pdf");
  assert.equal(fileName("2023-11-01", "Krankenversicherung: Beiträge steuerlich berücksichtigen"), "2023-11-01 Krankenversicherung - Beiträge steuerlich berücksichtigen.pdf");
  const long = fileName("2025-03-04", "x".repeat(400));
  assert.ok(long.length <= 154 && long.endsWith(".pdf"));
  assert.equal(fileName("2025-03-04", "   "), "2025-03-04 Document.pdf");
  assert.equal(fileName("2025-03-04", "Ends with dots..."), "2025-03-04 Ends with dots.pdf");
});

test("confirming makes \"To sort\" inside the documents folder and nothing else", async () => {
  const { fake, confined } = await kitDrive();
  try {
    const plan = { format: 1, status: "proposed", root: { id: fake.idOf("Paperwork"), name: "Paperwork" }, rules: [{ type: "Invoice", folder: "Invoices/{sender}" }] };
    const done = await confirmPlan(confined, plan, settings);
    assert.equal(done.status, "confirmed");
    assert.equal(fake.pathOf(done.to_sort.id), "Paperwork/To sort");
    assert.deepEqual(fake.writes.map((w) => `${w.op} ${w.name}`), ["create-folder To sort"]);
    const again = await confirmPlan(confined, { ...plan }, settings);
    assert.equal(again.to_sort.id, done.to_sort.id);
    assert.equal(fake.writes.length, 1);
    await assert.rejects(confirmPlan(confined, { ...plan, rules: [{ type: "Invoice", folder: "Receipts/{sender}" }] }, settings), /Receipts/);
  } finally { await fake.close(); }
});

test("a plan proposed again never offers To sort as a folder", async () => {
  const { fake, confined } = await kitDrive();
  try {
    const plan = { format: 1, status: "proposed", root: { id: fake.idOf("Paperwork"), name: "Paperwork" }, rules: [{ type: "Invoice", folder: "Invoices/{sender}" }] };
    const done = await confirmPlan(confined, plan, settings);
    assert.ok(readTree(confined).some((f) => f.name === "To sort"));
    assert.ok(!readTree(confined, new Set([done.to_sort.id])).some((f) => f.name === "To sort"));
  } finally { await fake.close(); }
});
