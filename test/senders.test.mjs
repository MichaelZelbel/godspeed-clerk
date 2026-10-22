// Folders named after senders, the way many people keep their papers (a folder per sender, some
// with subfolders by topic or year). The Clerk must find the person's own folder for a sender, by
// the AI choosing from a shortlist of the real folder names, never make a look-alike next to it,
// and use the subfolder a person would use.
import { test } from "node:test";
import fs from "node:fs";
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
    VKO: {},
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
  letter("vko", "Vereinigte Krankenkasse Ostlicht. Your contribution statement for 2024, dated 20 January 2025."),
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
  // Picks VKO when VKO is offered; says NEW when it is not, as a real AI did.
  { match: ["Reference VKO"], offered: ["VKO"], answer: { title: "Contribution statement 2024", correspondent: "Vereinigte Krankenkasse Ostlicht", document_type: "Letter", tags: [], created: "2025-01-20", folder: "{sender}", sender_folder: "VKO", confident: true } },
  answer("vko", { title: "Contribution statement 2024", correspondent: "Vereinigte Krankenkasse Ostlicht", created: "2025-01-20", sender_folder: "NEW" }),
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

const offered = (w, ref) => JSON.parse(w.prompts.find((x) => x.prompt.includes(ref)).prompt.match(/Sender folders: (.*)/)[1]);

test("the AI sees every sender folder's name (up to about a thousand), subfolders of the likely ones, nothing outside", async () => {
  const many = structuredClone(SENDER_TREE);
  for (let i = 0; i < 300; i++) many.Paperwork[`Unrelated Supplier ${i}`] = {};
  const w = await senderWorld({ tree: many });
  try {
    await w.runUntilQuiet();
    const list = offered(w, "Reference CAR");
    assert.ok(list.includes("Ostwald Insurance/Car") && list.includes("Ostwald Insurance/Home contents"), JSON.stringify(list.slice(-10)));
    assert.equal(list.filter((x) => x.startsWith("Unrelated Supplier")).length, 300);
    assert.ok(list.includes("Vossberg Dental") && list.includes("VKO"));
    assert.ok(!list.includes("Holiday photos"));
  } finally { await w.close(); }
});

test("above about a thousand sender folders, a shortlist of the likely ones", async () => {
  const many = structuredClone(SENDER_TREE);
  for (let i = 0; i < 1100; i++) many.Paperwork[`Unrelated Supplier ${i}`] = {};
  const w = await senderWorld({ tree: many });
  try {
    await w.runUntilQuiet();
    const list = offered(w, "Reference CAR");
    assert.ok(list.includes("Ostwald Insurance/Car"));
    assert.equal(list.filter((x) => x.startsWith("Unrelated Supplier")).length, 0);
  } finally { await w.close(); }
});

test("a folder named by initials is offered: VKO for Vereinigte Krankenkasse Ostlicht, and no look-alike is made", async () => {
  const w = await senderWorld();
  try {
    await w.runUntilQuiet();
    assert.ok(offered(w, "Reference VKO").includes("VKO"));
    assert.match(w.pathOf("vko"), /^Paperwork\/VKO\//);
    assert.equal(w.drive.byPath("Paperwork/Vereinigte Krankenkasse Ostlicht"), null);
  } finally { await w.close(); }
});

test("folders with many subfolders never push the right sender off the list", async () => {
  const crowd = { Paperwork: { "Vossberg Dental": {}, "Fairford Elm Row Residents": {}, "Fairford Elm Row Library": {} }, "Holiday photos": {} };
  for (let i = 0; i < 30; i++) { crowd.Paperwork["Fairford Elm Row Residents"][`Topic ${i}`] = {}; crowd.Paperwork["Fairford Elm Row Library"][`Shelf ${i}`] = {}; }
  const w = await senderWorld({ tree: crowd });
  try {
    await w.runUntilQuiet();
    assert.ok(offered(w, "Reference DENTAL").includes("Vossberg Dental"));
    assert.match(w.pathOf("dental"), /^Paperwork\/Vossberg Dental\//);
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

test("names: an ending makes a different surname; only generic words have a plural", () => {
  for (const [a, b] of [["Peters", "Petersen"], ["Lang", "Lange"], ["Kühn", "Kühne"], ["Brand", "Brandes"], ["Schult", "Schulte"], ["Behren", "Behrens"],
    ["Steuerberatung Peters", "Steuerberatung Petersen"], ["Malerbetrieb Lang", "Malerbetrieb Lange"]]) {
    assert.equal(sameName(a, b), false, `${a} / ${b}`);
    assert.equal(findSame([{ id: 1, name: a }], b), null, `${a} / ${b}`);
  }
  for (const [a, b] of [["Ostwald Versicherungen", "Ostwald Versicherung"], ["Rheinische Kassen", "Rheinische Kasse"], ["Volks Banken", "Volks Bank"], ["Stadtwerke Fairford", "Stadtwerk Fairford"],
    ["Northgate Insurances", "Northgate Insurance"], ["Kestrel Services", "Kestrel Service"], ["Wendmark Partners", "Wendmark Partner"]]) {
    assert.equal(sameName(a, b), true, `${a} / ${b}`);
  }
});

const UNSURE_ONLY = [{ match: [], answer: { folder: null, confident: false } }];
const homeDoc = { ...letter("homeletter", "Ostwald Insurance, home contents cover, dated 4 April 2025."), presorted: { title: "Home contents cover 2025", correspondent: "Ostwald Insurances AG", document_type: "Letter", tags: [], created: "2025-04-04" } };
const homeAnswers = [{ match: ["Pick the folder", "Home contents cover 2025"], answer: { folder: "Ostwald Insurance/Home contents", confident: true } }, ...ANSWERS];

test("a filed document stays put: a tag added by hand asks the AI nothing and moves nothing", async () => {
  const w = await senderWorld({ sorting: "paperless", extra: [homeDoc], answers: homeAnswers });
  try {
    await w.runUntilQuiet();
    const where = w.pathOf("homeletter");
    assert.match(where, /Home contents/);
    w.setAnswers(UNSURE_ONLY);
    const asked = w.prompts.length;
    const car = [...w.pl.state.tags.values()].find((t) => t.name === "Car").id;
    Object.assign(w.doc("homeletter"), { tags: [...w.doc("homeletter").tags, car], modified: new Date().toISOString() });
    await w.runUntilQuiet();
    assert.equal(w.prompts.length, asked);
    assert.equal(w.pathOf("homeletter"), where);
  } finally { await w.close(); }
});

test("a new sender moves the file only when its folder is decided with confidence; unsure keeps the place", async () => {
  const w = await senderWorld({ sorting: "paperless", extra: [homeDoc], answers: homeAnswers });
  try {
    await w.runUntilQuiet();
    const where = w.pathOf("homeletter");
    const sender = (name) => { const id = w.pl.state.next.corr++; w.pl.state.correspondents.set(id, { id, name, matching_algorithm: 1 }); return id; };
    // Another sender, and the AI is not sure where it goes: the file stays where it is.
    w.setAnswers(UNSURE_ONLY);
    Object.assign(w.doc("homeletter"), { correspondent: sender("Southmoor Mutual"), modified: new Date().toISOString() });
    await w.runUntilQuiet();
    assert.equal(w.pathOf("homeletter"), where);
    // Another sender again, and now the AI is sure it has no folder yet: the file moves to a new one.
    w.setAnswers([{ match: ["Pick the folder", "Northwind Insurance"], answer: { folder: "NEW", confident: true } }]);
    Object.assign(w.doc("homeletter"), { correspondent: sender("Northwind Insurance"), modified: new Date().toISOString() });
    await w.runUntilQuiet();
    assert.equal(w.pathOf("homeletter"), "Paperwork/Northwind Insurance/2025-04-04 Home contents cover 2025.pdf");
  } finally { await w.close(); }
});

test("with the records lost, the files' own marks say where they are: no AI question, nothing moved", async () => {
  const w = await senderWorld();
  try {
    await w.runUntilQuiet();
    const before = Object.fromEntries(DOCS.map((d) => [d.slug, w.pathOf(d.slug)]));
    w.setAnswers(UNSURE_ONLY);
    fs.rmSync(w.paths.records, { recursive: true, force: true });
    const asked = w.prompts.length, writes = w.drive.writes.length;
    await w.runUntilQuiet();
    assert.deepEqual(Object.fromEntries(DOCS.map((d) => [d.slug, w.pathOf(d.slug)])), before);
    assert.equal(w.prompts.length, asked);
    assert.equal(w.drive.writes.length, writes);
  } finally { await w.close(); }
});
