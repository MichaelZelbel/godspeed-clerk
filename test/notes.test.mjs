// One notebook note per document (F10), and the tag that keeps a document out (F11), against a
// pretend Paperless, a pretend drive and a pretend notebook.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { kitWorld, DOCS, expected, text } from "./kit-world.mjs";
import { Notebook } from "../lib/core/notebook.mjs";

const ALEX = DOCS.filter((d) => d.owner === "alex").map((d) => d.slug);
const summaries = (w) => w.prompts.filter((p) => p.system.startsWith("You summarise")).length;
const tagId = (w, name) => [...w.pl.state.tags.values()].find((t) => t.name === name).id;
const change = (w, slug, fields) => Object.assign(w.doc(slug), fields, { modified: new Date().toISOString() });
const KEEP_OUT = "Not in notebook";

test("F10: a run over the kit makes exactly one note per document", async () => {
  const w = await kitWorld();
  try {
    await w.runUntilQuiet();
    for (const slug of ALEX) {
      const e = expected(slug);
      if (e.not_in_notebook) { assert.equal(w.notesOf(slug).length, 0, slug); continue; }
      const n = w.noteOf(slug), d = w.doc(slug), f = w.fileOf(slug)[0];
      assert.equal(n.folder_path, "Documents", slug);
      assert.equal(n.title, d.title, slug);
      assert.equal(n.clerk_sum, w.record(slug).sum, slug);
      for (const v of [e.correspondent, e.created, e.document_type, ...(e.tags_include || [])].filter(Boolean)) assert.ok(n.content.includes(v), `${slug}: ${v}`);
      assert.ok(n.content.includes(e.folder), `${slug}: its folder`);
      assert.ok(n.content.includes(`(${w.pl.url}/documents/${w.ids[slug]}/details)`), `${slug}: link to Paperless`);
      assert.ok(n.content.includes(`(https://drive.google.com/file/d/${f.id}/view)`), `${slug}: link to the drive`);
      for (const line of text(slug).split("\n").map((l) => l.trim()).filter((l) => l.split(/\s+/).length >= 4)) assert.ok(n.content.includes(line), `${slug}: "${line}"`);
      // The summary and key facts of a document the Clerk sorted come from that same answer.
      if (!e.check && !DOCS.find((x) => x.slug === slug).presorted) {
        assert.ok(n.clerk_summary && n.content.includes(n.clerk_summary), `${slug}: summary`);
        assert.ok(n.clerk_facts.length && n.clerk_facts.every((x) => n.content.includes(x)), `${slug}: key facts`);
      }
    }
    // No second AI call for a summary, and none for the archive.
    assert.equal(summaries(w), 0);
    assert.equal(w.noteOf("bank-certificate").clerk_summary ?? null, null);
    assert.equal(w.notes().length, ALEX.length - 1);
  } finally { await w.close(); }
});

test("F10: renaming a document and running again updates the same note and keeps a line the user added", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "pay-slip"] });
  try {
    await w.runUntilQuiet();
    const n = w.noteOf("utility-invoice");
    w.nb.edit("notes", n.id, { content: `${n.content}\nPaid on 25 March, checked against the bank statement.\n` });
    change(w, "utility-invoice", { title: "Electricity bill for February" });
    await w.runUntilQuiet();
    const after = w.noteOf("utility-invoice");
    assert.equal(after.id, n.id);
    assert.equal(after.title, "Electricity bill for February");
    assert.match(after.content, /\n## Your notes\n\nPaid on 25 March, checked against the bank statement\.\n$/);
    assert.equal(after.content.split("Paid on 25 March").length, 2);
    assert.ok(after.content.includes(n.clerk_summary));
    assert.equal(w.notes().length, 2);
    assert.equal(summaries(w), 0);
  } finally { await w.close(); }
});

test("F10: a reinstall followed by a run makes no new notes", async () => {
  const w = await kitWorld();
  try {
    await w.runUntilQuiet();
    const before = w.notes().map((n) => `${n.id} ${n._hash}`).sort();
    assert.equal(before.length, ALEX.length - 1);
    const inserts = () => w.nb.writes.filter((x) => x.table === "notes" && x.operation === "insert").length;
    const made = inserts();
    fs.rmSync(w.paths.records, { recursive: true, force: true });
    fs.rmSync(w.paths.state, { force: true });
    await w.runUntilQuiet();
    assert.equal(inserts(), made);
    assert.deepEqual(w.notes().map((n) => `${n.id} ${n._hash}`).sort(), before, "and not one note changed");
  } finally { await w.close(); }
});

test("F11: the doctor's letter with the tag is sorted and filed but has no note", async () => {
  const w = await kitWorld({ only: ["doctor-letter", "utility-invoice"] });
  try {
    await w.runUntilQuiet();
    const d = w.doc("doctor-letter");
    assert.equal(w.senderName(d), "Linden Street Practice");
    assert.equal(d.created, "2025-09-03");
    assert.ok(w.tagNames(d).includes(KEEP_OUT));
    assert.equal(w.pathOf("doctor-letter"), "Paperwork/Letters/2025-09-03 Blood test results.pdf");
    assert.equal(w.notesOf("doctor-letter").length, 0);
    assert.ok(!w.nb.rows("notes").some((n) => JSON.stringify(n).includes("LH-20931")));
    assert.equal(w.notesOf("utility-invoice").length, 1);
  } finally { await w.close(); }
});

test("F11: adding the tag to a noted document trashes its note on the next run", async () => {
  const w = await kitWorld({ only: ["council-letter"] });
  try {
    await w.runUntilQuiet();
    const n = w.noteOf("council-letter");
    change(w, "council-letter", { tags: [...w.doc("council-letter").tags, tagId(w, KEEP_OUT)] });
    await w.runUntilQuiet();
    const after = w.nb.row("notes", n.id);
    assert.equal(after.is_trashed, true);
    assert.equal(after.title, "Document kept out of the notebook");
    const all = JSON.stringify(after);
    for (const s of [n.title, "Waste and Recycling", "Fairford Borough Council", "collection days", n.clerk_summary]) assert.ok(!all.includes(s), `the trashed note still holds "${s}"`);
  } finally { await w.close(); }
});

test("F11: adding it to a noted document with a line the user added leaves a note holding only that line", async () => {
  const w = await kitWorld({ only: ["council-letter"] });
  try {
    await w.runUntilQuiet();
    const n = w.noteOf("council-letter");
    w.nb.edit("notes", n.id, { content: `${n.content}\nCall the council about the brown bin.\n` });
    change(w, "council-letter", { tags: [...w.doc("council-letter").tags, tagId(w, KEEP_OUT)] });
    await w.runUntilQuiet();
    const after = w.nb.row("notes", n.id);
    assert.equal(after.is_trashed, false);
    assert.equal(after.title, "Document kept out of the notebook");
    assert.equal(after.content.trim(), "Call the council about the brown bin.");
    assert.ok(!JSON.stringify(after).includes(n.clerk_summary));
    // Taken off again: the Clerk's part comes back above the person's line.
    change(w, "council-letter", { tags: w.doc("council-letter").tags.filter((t) => t !== tagId(w, KEEP_OUT)) });
    await w.runUntilQuiet();
    const back = w.nb.row("notes", n.id);
    assert.equal(back.title, n.title);
    assert.match(back.content, /Waste and Recycling[\s\S]*\n## Your notes\n\nCall the council about the brown bin\.\n$/);
    assert.equal(w.notesOf("council-letter").length, 1);
  } finally { await w.close(); }
});

test("a new document Paperless sorts gets its summary in one AI call; the archive none", async () => {
  const w = await kitWorld({ sorting: "paperless", only: ["pay-slip"] });
  try {
    await w.runUntilQuiet();
    assert.equal(w.notes().length, 1);
    assert.equal(summaries(w), 0);
    const invoice = [...w.pl.state.types.values()].find((t) => t.name === "Invoice").id;
    const sender = [...w.pl.state.correspondents.values()].find((c) => c.name === "Brightwater Utilities").id;
    const added = w.pl.addDoc({ title: "Roof repair", content: text("roofing-invoice"), tags: [], document_type: invoice, correspondent: sender, created: "2025-05-12", added: new Date().toISOString() });
    await w.runUntilQuiet();
    assert.equal(summaries(w), 1);
    const n = w.notes().find((x) => x.clerk_doc === added.id);
    assert.match(n.clerk_summary, /^Hollis Roofing invoices 1014\.48 EUR/);
    assert.ok(n.content.includes(n.clerk_summary));
    change(w, "pay-slip", { title: "Pay slip March" });
    await w.runUntilQuiet();
    assert.equal(summaries(w), 1, "never asked again, and the archive never");
    assert.deepEqual(w.pl.writes, []);
  } finally { await w.close(); }
});

test("a note the person deleted is never made again; one they trashed stays in the trash", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "pay-slip"] });
  try {
    await w.runUntilQuiet();
    w.nb.remove("notes", w.noteOf("utility-invoice").id);
    const slip = w.noteOf("pay-slip");
    w.nb.edit("notes", slip.id, { is_trashed: true, trashed_at: new Date().toISOString() });
    for (const s of ["utility-invoice", "pay-slip"]) change(w, s, { title: `${w.doc(s).title} renamed` });
    await w.runUntilQuiet();
    assert.equal(w.notesOf("utility-invoice").length, 0);
    const s2 = w.nb.row("notes", slip.id);
    assert.equal(s2.is_trashed, true);
    assert.equal(s2.title, slip.title);
    assert.equal(w.notes().length, 1);
  } finally { await w.close(); }
});

test("a note changed by the person at the same moment is not overwritten", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    await w.runUntilQuiet();
    const n = w.noteOf("utility-invoice");
    change(w, "utility-invoice", { title: "Electricity bill for February" });
    // The person saves the note between the Clerk's read and its write.
    class Racing extends Notebook {
      async updateNote(id, values, hash) {
        if (!this.raced) { this.raced = true; w.nb.edit("notes", id, { content: `${w.nb.row("notes", id).content}\nWritten at that very moment.\n` }); }
        return super.updateNote(id, values, hash);
      }
    }
    await w.run({ notebook: new Racing({ base: w.nb.url }) });
    assert.equal(w.nb.row("notes", n.id).title, n.title, "the Clerk's stale write did not land");
    await w.runUntilQuiet();
    const after = w.nb.row("notes", n.id);
    assert.equal(after.title, "Electricity bill for February");
    assert.match(after.content, /\nWritten at that very moment\.\n$/);
  } finally { await w.close(); }
});

test("without its heading a changed note is left as it is", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    await w.runUntilQuiet();
    const n = w.noteOf("utility-invoice");
    const mine = "I rewrote this note my own way.\n\nPaid in March.";
    w.nb.edit("notes", n.id, { content: mine });
    change(w, "utility-invoice", { title: "Electricity bill for February" });
    await w.runUntilQuiet();
    assert.equal(w.nb.row("notes", n.id).content, mine);
    assert.match(fs.readFileSync(w.paths.log, "utf8"), /cannot be told apart/);
  } finally { await w.close(); }
});

test("with the notebook down the run goes on and the notes come later", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "pay-slip"] });
  try {
    w.nb.down = true;
    const r = await w.run();
    assert.equal(r.filed, 2);
    assert.equal(r.noted, 0);
    assert.match(r.notes.join(" "), /notebook did not answer/);
    w.nb.down = false;
    await w.runUntilQuiet();
    assert.equal(w.notes().length, 2);
  } finally { await w.close(); }
});

test("the notebook stopping in the middle of a run: the run ends normally, the rest comes later", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "pay-slip", "council-letter"] });
  try {
    class Stopping extends Notebook {
      async insertNote(values) { const r = await super.insertNote(values); w.nb.down = true; return r; }
    }
    const r = await w.run({ notebook: new Stopping({ base: w.nb.url, timeoutMs: 2000 }) });
    assert.equal(r.noted, 1);
    assert.equal(r.filed, 3);
    w.nb.down = false;
    await w.runUntilQuiet();
    assert.equal(w.notes().length, 3);
  } finally { await w.close(); }
});

for (const sorting of ["paperless", "nobody"]) {
  test(`F4: with "${sorting === "paperless" ? "Paperless sorts" : "nobody sorts"}" every note is still written and nothing reaches Paperless`, async () => {
    const w = await kitWorld({ sorting });
    try {
      const before = w.pl.snapshot();
      await w.runUntilQuiet();
      assert.deepEqual(w.pl.writes, []);
      assert.equal(w.pl.snapshot(), before);
      for (const slug of ALEX) assert.equal(w.notesOf(slug).length, expected(slug).not_in_notebook ? 0 : 1, slug);
    } finally { await w.close(); }
  });
}

test("a line the person writes above the Clerk's part is never lost: the note is left as it is", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    await w.runUntilQuiet();
    const n = w.noteOf("utility-invoice");
    const mine = `Gardener keeps the side gate key until July.\n\n${n.content}`;
    w.nb.edit("notes", n.id, { content: mine });
    change(w, "utility-invoice", { title: "Electricity bill for February" });
    await w.runUntilQuiet();
    assert.equal(w.nb.row("notes", n.id).content, mine);
    assert.match(fs.readFileSync(w.paths.log, "utf8"), /cannot be told apart/);
  } finally { await w.close(); }
});

test("F11 with a line above the Clerk's part: nothing of the person's goes to the trash, the Clerk's own fields come out, and the person hears it once", async () => {
  const w = await kitWorld({ only: ["council-letter"] });
  try {
    await w.runUntilQuiet();
    const n = w.noteOf("council-letter");
    const mine = `Ask the neighbours about the brown bin.\n\n${n.content}`;
    w.nb.edit("notes", n.id, { content: mine });
    change(w, "council-letter", { tags: [...w.doc("council-letter").tags, tagId(w, KEEP_OUT)] });
    await w.runUntilQuiet();
    const after = w.nb.row("notes", n.id);
    assert.equal(after.is_trashed, false);
    assert.equal(after.content, mine, "the text is the person's to clean");
    assert.equal(after.title, "Document kept out of the notebook");
    assert.equal(after.clerk_summary, null);
    assert.equal(after.clerk_facts, null);
    assert.equal(w.messages.length, 1);
    assert.match(w.messages[0], /please remove it by hand/);
    await w.run();
    assert.equal(w.messages.length, 1);
  } finally { await w.close(); }
});

test("a heading \"Your notes\" the person puts at the top: the note is left as it is, the text never twice", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    await w.runUntilQuiet();
    const n = w.noteOf("utility-invoice");
    const mine = `## Your notes\n\nMy plan for this bill.\n\n${n.content}`;
    w.nb.edit("notes", n.id, { content: mine });
    change(w, "utility-invoice", { title: "Electricity bill for February" });
    await w.runUntilQuiet();
    assert.equal(w.nb.row("notes", n.id).content, mine);
  } finally { await w.close(); }
});

test("the notebook's editor writing the Clerk's part back its own way is not a change by the person", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    await w.runUntilQuiet();
    const n = w.noteOf("utility-invoice");
    // The editor's Markdown: other list markers, other emphasis, other line breaks; the same words.
    const rewritten = n.content.replace(/^- /gm, "* ").replace(/^_(.*)_$/gm, "*$1*").replace(/\n\n/g, "\n\n\n");
    w.nb.edit("notes", n.id, { content: `${rewritten}\nPaid on 25 March.\n` });
    change(w, "utility-invoice", { title: "Electricity bill for February" });
    await w.runUntilQuiet();
    const after = w.nb.row("notes", n.id);
    assert.equal(after.title, "Electricity bill for February");
    assert.match(after.content, /^- \*\*Sender:\*\* Brightwater Utilities/);
    assert.match(after.content, /\n## Your notes\n\n+Paid on 25 March\.\n$/);
  } finally { await w.close(); }
});

test("taking the tag off again brings back the note the Clerk put in the trash", async () => {
  const w = await kitWorld({ only: ["council-letter"] });
  try {
    await w.runUntilQuiet();
    const n = w.noteOf("council-letter");
    change(w, "council-letter", { tags: [...w.doc("council-letter").tags, tagId(w, KEEP_OUT)] });
    await w.runUntilQuiet();
    assert.equal(w.nb.row("notes", n.id).is_trashed, true);
    change(w, "council-letter", { tags: w.doc("council-letter").tags.filter((t) => t !== tagId(w, KEEP_OUT)) });
    await w.runUntilQuiet();
    const back = w.nb.row("notes", n.id);
    assert.equal(back.is_trashed, false);
    assert.equal(back.title, n.title);
    assert.ok(back.content.includes("Waste and Recycling"));
    assert.equal(w.notesOf("council-letter").length, 1);
  } finally { await w.close(); }
});

test("F11: what the notebook's own processing wrote about the letter comes out of a kept-out note too", async () => {
  const w = await kitWorld({ only: ["council-letter", "pay-slip"] });
  try {
    await w.runUntilQuiet();
    // As the notebook's processing leaves a note: its fields named in metadata.ai_fields, its tags.
    const processed = { metadata: { summary: "Bin days change in July.", people: ["Jordan Reeve"], type: "letter", ai_fields: ["summary", "people", "type"], my_rating: 3 }, tags: ["bins", "council"] };
    for (const slug of ["council-letter", "pay-slip"]) w.nb.edit("notes", w.noteOf(slug).id, processed);
    const slip = w.noteOf("pay-slip");
    w.nb.edit("notes", slip.id, { content: `${slip.content}\nAsk about the bonus.\n` });
    for (const slug of ["council-letter", "pay-slip"]) change(w, slug, { tags: [...w.doc(slug).tags, tagId(w, KEEP_OUT)] });
    await w.runUntilQuiet();
    const trashed = w.noteOf("council-letter"), kept = w.noteOf("pay-slip");
    assert.equal(trashed.is_trashed, true);
    assert.deepEqual(trashed.metadata, { my_rating: 3 }, "only what the person set stays");
    assert.deepEqual(trashed.tags, [], "nothing of the person's was in it, so its tags go too");
    assert.deepEqual(kept.metadata, { my_rating: 3 });
    assert.deepEqual(kept.tags, ["bins", "council"], "tags cannot be told apart from the person's own, so they stay");
    assert.equal(kept.content.trim(), "Ask about the bonus.");
  } finally { await w.close(); }
});
