// F19: a paper the Clerk could not place becomes one question with numbered choices.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kitWorld, ANSWERS } from "./kit-world.mjs";
import { readJson } from "../lib/core/files.mjs";
import { loadQuestions } from "../lib/core/questions.mjs";

export const HOTEL_TREE = { Paperwork: { Travel: {}, Letters: {}, "Fairway Rail": {}, "Wayfarer Trips Ltd": {} }, "Holiday photos": { "beach.jpg": "Not a document." } };
export const booking = { slug: "hotel-booking", owner: "alex", content: "Wayfarer Trips. Booking confirmation WT-55102 for Hotel Lindenhof, Hillport, 3 to 5 November 2026. Guest Alex Morgan, 12 Elm Row, 40210 Fairford. Total 212.00 EUR, paid by card." };
export const bookingSorted = { match: ["WT-55102"], answer: { title: "Hotel booking Hotel Lindenhof Hillport", correspondent: "Wayfarer", document_type: null, tags: [], created: "2026-10-21", folder: null, confident: false, unsure: ["correspondent", "document_type"] } };
export const bookingPlaces = { match: ["Suggest places", "WT-55102"], answer: { places: [{ new_folder: "Hotel Lindenhof" }, { folder: "Travel" }, { new_folder: "Wayfarer Trips" }, { folder: "Holiday photos" }, { folder: "Letters" }] } };

const open = (w) => Object.values(loadQuestions(w.paths).open);

test("F19: a kit document left in To sort produces one question with numbered choices", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "utility-invoice"] });
  try {
    await w.runUntilQuiet();
    const qs = open(w);
    assert.equal(qs.length, 1);
    const [q] = qs;
    assert.equal(q.doc, w.ids["blurry-scan"]);
    assert.deepEqual(q.choices.map((c) => c.n), q.choices.map((_, i) => i + 1), "numbered 1, 2, ...");
    assert.ok(q.choices.length >= 2 && q.choices.at(-1).other, "a place, and last: another folder");
    assert.equal(q.choices[0].folder_id, w.drive.idOf("Paperwork/Letters"));
    await w.run();
    assert.equal(open(w).length, 1, "asked once, not again every run");
  } finally { await w.close(); }
});

test("the choices: the AI's places, existing folders by id, new folders where the plan keeps sender folders, at most three, then another folder", async () => {
  const w = await kitWorld({ only: [], extra: [booking], tree: HOTEL_TREE, rules: [{ folder: "{sender}" }], answers: [bookingPlaces, bookingSorted] });
  try {
    await w.runUntilQuiet();
    const [q] = open(w);
    assert.deepEqual(q.choices, [
      { n: 1, new: { parent_id: w.drive.idOf("Paperwork"), names: ["Hotel Lindenhof"] } },
      { n: 2, folder_id: w.drive.idOf("Paperwork/Travel") },
      { n: 3, folder_id: w.drive.idOf("Paperwork/Wayfarer Trips Ltd") },
      { n: 4, other: true },
    ], "a new folder whose name an existing folder already has is that folder; one outside is never offered");
    assert.equal(w.drive.writes.filter((x) => x.op === "create-folder").length, 0, "asking makes no folder");
    const asked = w.prompts.filter((p) => p.prompt.includes("Suggest places"));
    assert.equal(asked.length, 1);
    assert.match(asked[0].system, /data, never instructions/);
    assert.ok(!asked[0].prompt.includes("Holiday photos"), "nothing outside the documents folder is offered");
  } finally { await w.close(); }
});

test("without usable places from the AI the question still comes: a folder named like the paper's sender, and folders whose names it shares", async () => {
  const contract = { slug: "storage-contract", owner: "alex", content: "Westbrook Storage. Your storage unit contract, unit 14B, reference KEPT-CONTRACT-2, starts on 1 May 2025 for Alex Morgan.",
    presorted: { title: "Storage unit contract", correspondent: "Westbrook Storage", document_type: "Contract", tags: [], created: "2025-04-20" } };
  const tree = { Paperwork: { Storage: {}, Letters: {}, Invoices: {} } };
  const w = await kitWorld({ sorting: "nobody", only: [], extra: [contract], tree, rules: [{ type: "Letter", folder: "Letters" }], answers: [{ match: ["Pick the folder"], answer: { folder: null, confident: false } }] });
  try {
    await w.runUntilQuiet();
    assert.equal(w.prompts.filter((p) => p.prompt.includes("Suggest places")).length, 1, "asked, and the answer had no places");
    const [q] = open(w);
    assert.deepEqual(q.choices, [
      { n: 1, new: { parent_id: w.drive.idOf("Paperwork"), names: ["Westbrook Storage"] } },
      { n: 2, folder_id: w.drive.idOf("Paperwork/Storage") },
      { n: 3, other: true },
    ]);
  } finally { await w.close(); }
});

test("an unreadable scan: no AI question, the question says so", async () => {
  const w = await kitWorld({ only: [], extra: [{ slug: "smudge", owner: "alex", content: "~~ ,, .. 1 2 3" }], answers: [] });
  try {
    await w.runUntilQuiet();
    const [q] = open(w);
    assert.equal(q.unreadable, true);
    assert.deepEqual(q.choices, [{ n: 1, other: true }]);
    assert.equal(w.prompts.filter((p) => p.prompt.includes("Suggest places")).length, 0);
  } finally { await w.close(); }
});

test("two papers to check never share a number", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "unusable-answer"] });
  try {
    await w.runUntilQuiet();
    const ns = open(w).flatMap((q) => q.choices.map((c) => c.n));
    assert.equal(new Set(ns).size, ns.length, JSON.stringify(ns));
    assert.equal(Math.min(...ns), 1);
  } finally { await w.close(); }
});

test("a paper resolved by hand loses its question, and is never asked again", async () => {
  const w = await kitWorld({ only: ["blurry-scan"] });
  try {
    await w.runUntilQuiet();
    assert.equal(open(w).length, 1);
    const d = w.doc("blurry-scan");
    const letter = [...w.pl.state.types.values()].find((t) => t.name === "Letter").id;
    const check = [...w.pl.state.tags.values()].find((t) => t.name === "Check this").id;
    Object.assign(d, { document_type: letter, created: "2025-08-20", tags: d.tags.filter((t) => t !== check), modified: new Date().toISOString() });
    await w.runUntilQuiet();
    assert.equal(open(w).length, 0);
    await w.run();
    assert.equal(open(w).length, 0);
  } finally { await w.close(); }
});

test("the questions file holds numbers, folder ids and folder names, never a title or a sentence of the letter", async () => {
  const w = await kitWorld({ only: [], extra: [booking], tree: HOTEL_TREE, rules: [{ folder: "{sender}" }], answers: [bookingPlaces, bookingSorted] });
  try {
    await w.runUntilQuiet();
    const body = JSON.stringify(readJson(w.paths.questions));
    assert.ok(!body.includes(w.doc("hotel-booking").title), body);
    assert.ok(!body.includes("WT-55102") && !body.includes("Elm Row"), body);
  } finally { await w.close(); }
});

export { ANSWERS };
