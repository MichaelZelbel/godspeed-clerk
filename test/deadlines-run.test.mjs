// Deadlines from letters (F15) over the kit, against a pretend Paperless, Drive and notebook whose
// add-on deadlines follow the product's rules. The first six tests are the PRD's F15 test, sentence
// by sentence.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { kitWorld, DOCS, expected } from "./kit-world.mjs";
import { keyOf } from "../lib/core/deadlines.mjs";

const ALEX = DOCS.filter((d) => d.owner === "alex").map((d) => d.slug);
const LETTERS = ["water-invoice", "tax-office-letter", "parking-notice", "gym-letter", "library-reminder", "meter-letter", "clinic-letter"];
const of = (w, slug) => w.nb.deadlineRows().filter((d) => d.key.startsWith(keyOf(w.record(slug).sum, "")));
const tagNames = (w, slug) => w.tagNames(w.doc(slug));
const change = (w, slug, fields) => Object.assign(w.doc(slug), fields, { modified: new Date().toISOString() });
const later = (day) => new Date(`${day}T12:00:00Z`);

test("F15: the kit's letter with a deadline in the future creates exactly one deadline with the right date and a link to the document, also after a second run", async () => {
  const w = await kitWorld();
  try {
    await w.runUntilQuiet();
    const [d, ...more] = of(w, "water-invoice");
    assert.equal(more.length, 0);
    assert.equal(d.due, "2026-11-20");
    assert.equal(d.link, `${w.pl.url}/documents/${w.ids["water-invoice"]}/details`);
    assert.equal(d.title, "Pay the Brightwater Utilities electricity invoice of 212.40 EUR");
    assert.equal(d.key, keyOf(w.record("water-invoice").sum, 1), "it carries the document's mark and which request it is");
    assert.ok(d.done_when && d.cost, "what is true when it is done, and what passing it costs");
    const all = w.nb.deadlineRows().length;
    await w.run();
    await w.runUntilQuiet();
    assert.equal(of(w, "water-invoice").length, 1);
    assert.equal(w.nb.deadlineRows().length, all, "a second run makes none");
    // Every kit document: exactly the deadlines its expected-result file names.
    for (const slug of ALEX) {
      const want = expected(slug).deadlines || [];
      assert.deepEqual(of(w, slug).map((x) => x.due).sort(), want.map((x) => x.due).sort(), slug);
    }
  } finally { await w.close(); }
});

test("F15: a kit letter whose deadline has passed creates none", async () => {
  const w = await kitWorld({ only: ["library-reminder"] });
  try {
    await w.runUntilQuiet();
    assert.equal(w.nb.deadlineRows().length, 0);
    // Written into the note, among its key facts.
    const facts = w.noteOf("library-reminder").content.split("## Key facts")[1].split("##")[0];
    assert.ok(facts.includes("Pay the Fairford Library fine of 12.50 EUR: by 2026-08-31, already passed"), facts);
    assert.ok(!tagNames(w, "library-reminder").includes("Important"));
    assert.equal(w.messages.length, 0, "nothing to act on");
  } finally { await w.close(); }
});

test("F15: the letter with two requests creates two", async () => {
  const w = await kitWorld({ only: ["tax-office-letter"] });
  try {
    await w.runUntilQuiet();
    const got = of(w, "tax-office-letter").sort((a, b) => a.due.localeCompare(b.due));
    assert.deepEqual(got.map((d) => [d.title, d.due]), [
      ["Send the donation receipts for 2025 to the Fairford Tax Office", "2026-11-13"],
      ["Pay the Fairford Tax Office the remaining 340.00 EUR", "2026-11-30"],
    ]);
    assert.deepEqual(got.map((d) => d.key.split("#")[1]).sort(), ["1", "2"]);
  } finally { await w.close(); }
});

test("F15: the letter whose period runs from receipt creates one counted from its printed date and marked \"check the date\"", async () => {
  const w = await kitWorld({ only: ["parking-notice"] });
  try {
    await w.runUntilQuiet();
    const [d, ...more] = of(w, "parking-notice");
    assert.equal(more.length, 0);
    assert.equal(d.due, "2026-11-09", "one month from 9 October 2026, the date printed on the notice");
    assert.match(d.title, /\(check the date\)$/);
    assert.ok(w.noteOf("parking-notice").content.includes("by 2026-11-09 at the earliest"));
    assert.equal(w.messages.length, 1);
    assert.ok(w.messages[0].includes("please check them") && w.messages[0].includes(`"${w.doc("parking-notice").title}"`), w.messages[0]);
  } finally { await w.close(); }
});

test("F15: a vague request creates none", async () => {
  const w = await kitWorld({ only: ["gym-letter"] });
  try {
    await w.runUntilQuiet();
    assert.equal(w.nb.deadlineRows().length, 0);
    assert.equal(w.messages.length, 0, "and no message");
    // The request is in the note's key facts.
    const n = w.noteOf("gym-letter");
    const facts = n.content.split("## Key facts")[1].split("##")[0];
    assert.ok(facts.includes("Return the signed membership form to Elm Row Fitness (no date given)"), facts);
  } finally { await w.close(); }
});

test("F15: after the user moves a deadline's date, a run that reads the letter again leaves the user's date", async () => {
  const w = await kitWorld({ only: ["water-invoice", "parking-notice"] });
  try {
    await w.runUntilQuiet();
    const water = keyOf(w.record("water-invoice").sum, 1), parking = keyOf(w.record("parking-notice").sum, 1);
    w.nb.personMoves(water, "2026-11-27");
    w.nb.personMoves(parking, "2026-11-12");
    await w.runUntilQuiet();
    // Read again from the note, with the records lost.
    fs.rmSync(w.paths.records, { recursive: true, force: true });
    await w.runUntilQuiet();
    // Read again by the AI: the records lost and the inbox tag put back, so both are sorted again.
    const inbox = [...w.pl.state.tags.values()].find((t) => t.name === "Inbox").id;
    for (const slug of ["water-invoice", "parking-notice"]) change(w, slug, { tags: [...w.doc(slug).tags, inbox] });
    fs.rmSync(w.paths.records, { recursive: true, force: true });
    const asked = w.prompts.filter((p) => p.system.startsWith("You sort")).length;
    await w.runUntilQuiet();
    assert.equal(w.prompts.filter((p) => p.system.startsWith("You sort")).length - asked, 2, "both letters were read again");
    // And the letter's date corrected in Paperless: the person's date still stays.
    change(w, "parking-notice", { created: "2026-10-12" });
    await w.runUntilQuiet();
    const rows = w.nb.deadlineRows();
    assert.equal(rows.length, 2, "never a second deadline");
    assert.equal(rows.find((d) => d.key === water).due, "2026-11-27");
    assert.equal(rows.find((d) => d.key === parking).due, "2026-11-12");
  } finally { await w.close(); }
});

test("F15: a corrected letter date moves an untouched deadline counted from it; a written date stays", async () => {
  const w = await kitWorld({ only: ["water-invoice", "parking-notice"] });
  try {
    await w.runUntilQuiet();
    change(w, "parking-notice", { created: "2026-10-12" });
    change(w, "water-invoice", { created: "2026-10-14" });
    await w.runUntilQuiet();
    assert.equal(of(w, "parking-notice")[0].due, "2026-11-12");
    assert.equal(of(w, "water-invoice")[0].due, "2026-11-20", "a date written in the letter does not move");
    assert.ok(w.noteOf("parking-notice").content.includes("by 2026-11-12 at the earliest"), "the note says the new day");
    assert.equal(w.nb.deadlineRows().length, 2);
  } finally { await w.close(); }
});

test("F15: no usable date: \"Check this\", one message asking for the date, and the deadline once the date is set", async () => {
  const w = await kitWorld({ only: ["meter-letter"] });
  try {
    await w.runUntilQuiet();
    assert.equal(w.nb.deadlineRows().length, 0);
    assert.ok(tagNames(w, "meter-letter").includes("Check this"));
    assert.ok(w.noteOf("meter-letter").content.includes("the letter sets a period but prints no date to count from"));
    assert.equal(w.messages.length, 1);
    assert.match(w.messages[0], /Set the letter's date in Paperless/);
    assert.ok(w.messages[0].includes(`"${w.doc("meter-letter").title}"`));
    const item = w.nb.rows("collection_items")[0];
    assert.equal(item.data.status, "check this");
    // The person reads the letter's date off the envelope and sets it.
    change(w, "meter-letter", { created: "2026-10-20" });
    await w.runUntilQuiet();
    const [d] = of(w, "meter-letter");
    assert.equal(d.due, "2026-11-03", "two weeks from the date the person set");
    assert.match(d.title, /\(check the date\)$/);
    assert.equal(w.messages.filter((m) => /Set the letter's date/.test(m)).length, 1, "asked once");
  } finally { await w.close(); }
});

test("F11: a letter kept out of the notebook gets its deadline, named only by its title and date", async () => {
  const w = await kitWorld({ only: ["clinic-letter"] });
  try {
    await w.runUntilQuiet();
    assert.equal(w.notesOf("clinic-letter").length, 0);
    const [d, ...more] = of(w, "clinic-letter");
    assert.equal(more.length, 0);
    assert.deepEqual([d.title, d.due], ["Follow-up appointment reminder, 2026-10-14", "2026-11-27"]);
    assert.ok(tagNames(w, "clinic-letter").includes("Important"));
  } finally { await w.close(); }
});

test("F11: the tag added later renames an untouched deadline to the title and date, never one the person renamed", async () => {
  const w = await kitWorld({ only: ["water-invoice", "tax-office-letter"] });
  try {
    await w.runUntilQuiet();
    const keep = [...w.pl.state.tags.values()].find((t) => t.name === "Not in notebook").id;
    w.nb.personRenames(keyOf(w.record("tax-office-letter").sum, 1), "Receipts to the tax office");
    for (const slug of ["water-invoice", "tax-office-letter"]) change(w, slug, { tags: [...w.doc(slug).tags, keep] });
    await w.runUntilQuiet();
    assert.deepEqual(of(w, "water-invoice").map((d) => d.title), ["Electricity invoice September 2026, 2026-10-12"]);
    const tax = Object.fromEntries(of(w, "tax-office-letter").map((d) => [d.key.split("#")[1], d.title]));
    assert.equal(tax[1], "Receipts to the tax office", "the person's name stays");
    assert.equal(tax[2], "Questions about the income tax return 2025, 2026-10-15");
  } finally { await w.close(); }
});

test("F15: \"Important\" while the date is ahead, off once it has passed, never put back after the person took it off", async () => {
  const w = await kitWorld({ only: ["water-invoice", "tax-office-letter", "gym-letter"] });
  try {
    await w.runUntilQuiet();
    assert.ok(tagNames(w, "water-invoice").includes("Important"));
    assert.ok(tagNames(w, "tax-office-letter").includes("Important"));
    assert.ok(!tagNames(w, "gym-letter").includes("Important"), "no date, no Important");
    const important = [...w.pl.state.tags.values()].find((t) => t.name === "Important").id;
    change(w, "tax-office-letter", { tags: w.doc("tax-office-letter").tags.filter((t) => t !== important) });
    await w.runUntilQuiet();
    assert.ok(!tagNames(w, "tax-office-letter").includes("Important"), "the person took it off: it stays off");
    // 21 November: the water bill's day has gone; the tax office's second day (30 November) has not.
    await w.runUntilQuiet({ today: later("2026-11-21") });
    assert.ok(!tagNames(w, "water-invoice").includes("Important"), "off once the date has passed");
    assert.ok(!tagNames(w, "tax-office-letter").includes("Important"));
    // The person sets it again themselves: theirs, never taken off.
    change(w, "water-invoice", { tags: [...w.doc("water-invoice").tags, important] });
    await w.runUntilQuiet({ today: later("2026-12-05") });
    assert.ok(tagNames(w, "water-invoice").includes("Important"));
  } finally { await w.close(); }
});

for (const sorting of ["paperless", "nobody"]) {
  test(`F4, F15: with "${sorting === "paperless" ? "Paperless sorts" : "nobody sorts"}" the deadlines are made and nothing reaches Paperless`, async () => {
    const w = await kitWorld({ sorting, only: LETTERS });
    try {
      // The Clerk was running when these letters arrived: they are new, not the archive it found
      // (the archive gets no AI reading, F10).
      fs.writeFileSync(w.paths.state, JSON.stringify({ started_at: "2026-10-22T00:00:00Z" }));
      const before = w.pl.snapshot();
      await w.runUntilQuiet();
      assert.deepEqual(w.pl.writes, []);
      assert.equal(w.pl.snapshot(), before);
      for (const slug of LETTERS) assert.deepEqual(of(w, slug).map((d) => d.due).sort(), (expected(slug).deadlines || []).map((x) => x.due).sort(), slug);
      const meter = w.nb.rows("collection_items").find((i) => i.source_id === w.record("meter-letter").sum);
      assert.equal(meter.data.status, "check this", "no tag: the status says it");
    } finally { await w.close(); }
  });
}

test("F18: killed after the deadline was made, the next run makes no second one", async () => {
  const w = await kitWorld({ only: ["tax-office-letter", "water-invoice"] });
  try {
    const killed = (nth) => { let seen = 0; return (p) => { if (p === "after-deadline" && ++seen === nth) { const e = new Error("killed at after-deadline"); e.name = "Killed"; throw e; } }; };
    await assert.rejects(w.runUntilQuiet({ crash: killed(1) }), /killed/);
    await assert.rejects(w.runUntilQuiet({ crash: killed(2) }), /killed/);
    await w.runUntilQuiet();
    assert.equal(of(w, "tax-office-letter").length, 2);
    assert.equal(of(w, "water-invoice").length, 1);
    assert.equal(w.nb.writes.filter((x) => x.table === "deadlines" && x.operation === "insert").length, 3);
  } finally { await w.close(); }
});

test("F18: with the records deleted, no deadline twice and none changed", async () => {
  const w = await kitWorld({ only: LETTERS });
  try {
    await w.runUntilQuiet();
    assert.equal(w.nb.deadlineRows().length, 5, "water 1, tax office 2, parking 1, clinic 1");
    const before = JSON.stringify(w.nb.deadlineRows());
    const writes = w.nb.writes.length, plWrites = w.pl.writes.length;
    fs.rmSync(w.paths.records, { recursive: true, force: true });
    await w.runUntilQuiet();
    assert.equal(JSON.stringify(w.nb.deadlineRows()), before);
    assert.deepEqual(w.nb.writes.slice(writes).filter((x) => x.table === "deadlines"), []);
    assert.equal(w.pl.writes.length, plWrites, "nothing changed in Paperless either");
  } finally { await w.close(); }
});

test("a Godspeed without add-on deadlines: one message, and the deadlines come after the update", async () => {
  const w = await kitWorld({ only: ["water-invoice"] });
  try {
    w.nb.withoutDeadlines = true;
    await w.runUntilQuiet();
    await w.run();
    assert.equal(w.noteOf("water-invoice").clerk_doc, w.ids["water-invoice"], "noted as before");
    assert.equal(w.messages.length, 1);
    assert.match(w.messages[0], /Update Godspeed/);
    w.nb.withoutDeadlines = false;
    await w.runUntilQuiet();
    assert.equal(of(w, "water-invoice").length, 1);
    assert.equal(w.messages.length, 1, "nothing more to say");
  } finally { await w.close(); }
});

test("F14: no request's words in the records or the log", async () => {
  const w = await kitWorld({ only: LETTERS });
  try {
    await w.runUntilQuiet();
    const asks = w.nb.deadlineRows().map((d) => d.title.replace(/ \(check the date\)$/, ""));
    assert.ok(asks.length >= 5);
    const files = [w.paths.log, ...fs.readdirSync(w.paths.records).map((n) => path.join(w.paths.records, n)), w.paths.state, w.paths.outbox].filter(fs.existsSync);
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      for (const a of asks) assert.ok(!text.includes(a), `${path.basename(f)} holds "${a}"`);
    }
  } finally { await w.close(); }
});

// Papers the Clerk sorted and noted before it read deadlines (version 0.2): after the update each
// gets its deadlines read once, in batches, without being sorted or filed again. Here the batch-2
// state is made by taking out of a finished run everything batch 3 adds: the records' requests, the
// notes' clerk_asks and their deadline lines, and the deadlines themselves; and the AI is not
// asked to sort again (the full test runs the real previous version instead).
test("upgrade: a paper sorted under the batch-2 code gets its deadlines read once, in batches, never sorted or filed again", async () => {
  const w = await kitWorld({ only: [...LETTERS, "utility-invoice", "bank-certificate"], settings: { batch_size: 3 } });
  try {
    await w.runUntilQuiet();
    const want = Object.fromEntries(LETTERS.map((s) => [s, of(w, s).map((d) => [d.key.split("#")[1], d.title, d.due]).sort()]));
    // Back to what batch 2 left.
    for (const slug of [...LETTERS, "utility-invoice", "bank-certificate"]) {
      const file = path.join(w.paths.records, `${w.ids[slug]}.json`);
      const r = JSON.parse(fs.readFileSync(file, "utf8"));
      delete r.asks;
      if (r.note) r.note.key = "batch-2";
      fs.writeFileSync(file, JSON.stringify(r));
      for (const n of w.notesOf(slug)) w.nb.edit("notes", n.id, { clerk_asks: undefined, content: n.content.replace(/\n## Deadlines\n\n(- .*\n)+/, "\n") });
    }
    w.nb.clearDeadlines();
    fs.writeFileSync(w.paths.state, JSON.stringify({ ...JSON.parse(fs.readFileSync(w.paths.state, "utf8")), notify: undefined }));
    fs.rmSync(w.paths.outbox, { force: true });
    const sorting = () => w.prompts.filter((p) => p.system.startsWith("You sort")).length;
    const readings = () => w.prompts.filter((p) => p.system.startsWith("You summarise")).length;
    const sorted = sorting(), driveWrites = w.drive.writes.length;
    const sent = w.messages.length;
    await w.run();
    assert.equal(readings(), 3, "the first run reads three: its batch");
    await w.runUntilQuiet();
    assert.equal(readings(), LETTERS.length + 1, "each paper the Clerk sorted is read once (the archive never)");
    assert.equal(sorting(), sorted, "nothing is sorted again");
    assert.equal(w.drive.writes.length, driveWrites, "nothing is filed again");
    for (const slug of LETTERS) assert.deepEqual(of(w, slug).map((d) => [d.key.split("#")[1], d.title, d.due]).sort(), want[slug], slug);
    const facts = w.noteOf("library-reminder").content.split("## Key facts")[1].split("##")[0];
    assert.ok(facts.includes("already passed"), "a deadline that has passed goes into the key facts");
    // What needs a check after the update comes as one message, once the reading is done.
    const told = w.messages.slice(sent);
    assert.equal(told.length, 1, told.join(" | "));
    assert.ok(told[0].includes(`"${w.doc("parking-notice").title}"`) && told[0].includes(`"${w.doc("meter-letter").title}"`), told[0]);
    const all = w.nb.deadlineRows().length;
    await w.runUntilQuiet();
    assert.equal(readings(), LETTERS.length + 1, "read once");
    assert.equal(w.nb.deadlineRows().length, all, "made once");
  } finally { await w.close(); }
});

test("status says how many deadlines are in Godspeed, and when Godspeed cannot keep them", async () => {
  const { statusReport } = await import("../lib/core/status.mjs");
  const w = await kitWorld({ only: ["tax-office-letter", "water-invoice"] });
  try {
    await w.runUntilQuiet();
    assert.match(statusReport(w.paths, { env: {}, home: w.paths.root }), /Deadlines: 3 made in Godspeed from your letters\./);
    w.nb.withoutDeadlines = true;
    await w.run();
    assert.match(statusReport(w.paths, { env: {}, home: w.paths.root }), /This Godspeed cannot keep them yet/);
  } finally { await w.close(); }
});
