// Folders named after senders, the way many people keep their papers (a folder per sender, some
// with subfolders by topic or year). The Clerk must find the person's own folder for a sender, by
// the AI choosing from a shortlist of the real folder names, never make a look-alike next to it,
// and use the subfolder a person would use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kitWorld } from "./kit-world.mjs";
import { sameName, findSame } from "../lib/core/names.mjs";

const SENDER_TREE = {
  Paperwork: {
    "Vossberg Dental": {},
    "Lindqvist Garden and Landscaping": {},
    "Ostwald Insurance": { Car: {}, "Home contents": {} },
    "Wendmark Tax Office": { 2023: {}, 2024: {} },
    "Harbour Savings Bank": { Statements: { 2024: {}, 2025: {} }, "Credit card": {} },
  },
  "Holiday photos": {},
};
const RULES = [{ folder: "{sender}" }];
const letter = (slug, body) => ({ slug, owner: "alex", content: `${body} This letter is addressed to Alex Morgan, 12 Elm Row, 40210 Fairford. Reference ${slug.toUpperCase()}.` });
const DOCS = [
  letter("dental", "Vossberg Dental Practice, Dr. Vossberg. Invoice for a check-up on 3 March 2025, 85 EUR."),
  letter("garden", "Lindqvist Gardening. Invoice for hedge cutting on 9 May 2025, 120 EUR."),
  letter("car", "Ostwald Insurances. Car insurance policy renewal for 2026, dated 12 October 2025."),
  letter("north", "Wendmark-North Tax Office. Notice about the property tax, dated 2 June 2025."),
  letter("taxoffice", "Wendmark Tax Office. Income tax assessment 2025, dated 15 September 2025."),
  letter("statement", "Harbour Savings Bank. Account statement for August 2025, dated 31 August 2025."),
  letter("lifecover", "Ostwald Insurance. Your life cover offer, dated 1 July 2025."),
];
const answer = (slug, a) => ({ match: [`REFERENCE ${slug.toUpperCase()}`], answer: { document_type: "Letter", tags: [], folder: "{sender}", confident: true, ...a } });
const ANSWERS = [
  answer("dental", { title: "Invoice for a dental check-up", correspondent: "Vossberg Dental Practice", created: "2025-03-03", sender_folder: "Vossberg Dental" }),
  answer("garden", { title: "Invoice for hedge cutting", correspondent: "Lindqvist Gardening", created: "2025-05-09", sender_folder: null }),
  answer("car", { title: "Car insurance renewal 2026", correspondent: "Ostwald Insurances", created: "2025-10-12", sender_folder: "Ostwald Insurance/Car" }),
  answer("north", { title: "Property tax notice", correspondent: "Wendmark-North Tax Office", created: "2025-06-02", sender_folder: "NEW" }),
  answer("taxoffice", { title: "Income tax assessment 2025", correspondent: "Wendmark Tax Office", created: "2025-09-15", sender_folder: "Wendmark Tax Office/<year>" }),
  answer("statement", { title: "Account statement August 2025", correspondent: "Harbour Savings Bank", created: "2025-08-31", sender_folder: "Harbour Savings Bank/Statements/<year>" }),
  answer("lifecover", { title: "Life cover offer", correspondent: "Ostwald Insurance", created: "2025-07-01", sender_folder: "Ostwald Insurance/Life" }),
  { match: ["Pick the folder"], answer: { folder: null, confident: false } },
];

async function senderWorld(opts = {}) {
  return kitWorld({ only: [], tree: SENDER_TREE, rules: RULES, extra: DOCS, answers: ANSWERS, ...opts });
}
const made = (w) => w.drive.writes.filter((x) => x.op === "create-folder").map((x) => w.drive.pathOf(x.id)).sort();

test("names: plurals and legal forms are the same sender; a longer, more specific name is not", () => {
  assert.equal(sameName("Ostwald Versicherungen", "Ostwald Versicherung"), true);
  assert.equal(sameName("Ostwald Insurances", "Ostwald Insurance"), true);
  assert.equal(sameName("Brightwater Utilities plc", "Brightwater Utilities"), true);
  assert.equal(sameName("Müller GmbH & Co. KG", "Mueller"), true);
  assert.equal(sameName("Finanzamt Wendmark-Nord", "Finanzamt Wendmark"), false);
  assert.equal(sameName("Zahnarztpraxis Dr. Vossberg", "Zahnarzt Vossberg"), false);
  assert.equal(sameName("Lindqvist Gartenbau", "Lindqvist Garten- und Landschaftsbau"), false);
  assert.equal(findSame([{ id: 1, name: "Finanzamt Wendmark" }], "Finanzamt Wendmark-Nord"), null);
});

test("the AI picks the person's own sender folder; the new Paperless sender takes that folder's name", async () => {
  const w = await senderWorld();
  try {
    await w.runUntilQuiet();
    assert.match(w.pathOf("dental"), /^Paperwork\/Vossberg Dental\/2025-03-03 Invoice for a dental check-up\.pdf$/);
    assert.equal(w.senderName(w.doc("dental")), "Vossberg Dental");
    assert.match(w.pathOf("car"), /^Paperwork\/Ostwald Insurance\/Car\//);
    assert.equal(w.senderName(w.doc("car")), "Ostwald Insurance");
    assert.match(w.pathOf("statement"), /^Paperwork\/Harbour Savings Bank\/Statements\/2025\//);
  } finally { await w.close(); }
});

test("never a look-alike folder: unsure means To sort; a new sender folder only when the AI is sure none fits", async () => {
  const w = await senderWorld();
  try {
    await w.runUntilQuiet();
    assert.match(w.pathOf("garden"), /^Paperwork\/To sort\//);
    assert.match(w.pathOf("north"), /^Paperwork\/Wendmark-North Tax Office\//);
    assert.match(w.pathOf("lifecover"), /^Paperwork\/To sort\//);
    // The only folders made: "To sort" at confirmation (not counted), the new office, and the
    // missing year inside a folder that holds years.
    assert.deepEqual(made(w), ["Paperwork/Wendmark Tax Office/2025", "Paperwork/Wendmark-North Tax Office"]);
  } finally { await w.close(); }
});

test("the AI sees the real folder names: a shortlist of similar ones and their subfolders, never the whole drive", async () => {
  const many = structuredClone(SENDER_TREE);
  for (let i = 0; i < 300; i++) many.Paperwork[`Unrelated Supplier ${i}`] = {};
  const w = await senderWorld({ tree: many });
  try {
    await w.runUntilQuiet();
    const p = w.prompts.find((x) => x.prompt.includes("Reference CAR")).prompt;
    const list = JSON.parse(p.match(/Sender folders: (.*)/)[1]);
    assert.ok(list.includes("Ostwald Insurance/Car") && list.includes("Ostwald Insurance/Home contents"), JSON.stringify(list));
    assert.ok(!list.some((x) => x.startsWith("Unrelated Supplier")));
    assert.ok(!p.includes("Holiday photos"));
    assert.ok(list.length <= 60);
  } finally { await w.close(); }
});

test("when Paperless sorts, a person's sender name finds their folder by plural and legal form, and the AI picks the subfolder", async () => {
  const doc = { ...letter("homeletter", "Ostwald Insurance, home contents cover, dated 4 April 2025."), presorted: { title: "Home contents cover 2025", correspondent: "Ostwald Insurances AG", document_type: "Letter", tags: [], created: "2025-04-04" } };
  const answers = [{ match: ["Pick the folder", "Home contents cover 2025"], answer: { folder: "Ostwald Insurance/Home contents", confident: true } }, ...ANSWERS];
  const w = await senderWorld({ sorting: "paperless", extra: [doc], answers });
  try {
    await w.runUntilQuiet();
    assert.match(w.pathOf("homeletter"), /^Paperwork\/Ostwald Insurance\/Home contents\/2025-04-04 Home contents cover 2025\.pdf$/);
    const pick = w.prompts.find((x) => x.prompt.includes("Home contents cover 2025")).prompt;
    assert.ok(!pick.includes("Vossberg"), "only the matched sender's own subfolders are offered");
    assert.deepEqual(w.pl.writes, []);
  } finally { await w.close(); }
});
