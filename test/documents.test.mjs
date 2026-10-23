// The "Documents" collection in the notebook (F17): one item per document the Clerk handled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kitWorld, DOCS, expected } from "./kit-world.mjs";
import { SOURCE } from "../lib/core/note.mjs";

const ALEX = DOCS.filter((d) => d.owner === "alex").map((d) => d.slug);
const change = (w, slug, fields) => Object.assign(w.doc(slug), fields, { modified: new Date().toISOString() });
const tagId = (w, name) => [...w.pl.state.tags.values()].find((t) => t.name === name).id;
const collection = (w) => w.nb.rows("collections").filter((c) => c.source_app === SOURCE);
const itemOf = (w, slug) => { const it = w.nb.rows("collection_items").filter((i) => i.source_id === w.record(slug).sum); assert.equal(it.length, 1, `${slug}: one item`); return it[0]; };

test("F17: after a run over the kit, the collection has one item per document with every field filled as its expected-result file says", async () => {
  const w = await kitWorld();
  try {
    await w.runUntilQuiet();
    const colls = collection(w);
    assert.equal(colls.length, 1);
    assert.equal(colls[0].name, "Documents");
    assert.equal(w.nb.rows("collection_items").filter((i) => i.collection_id === colls[0].id).length, ALEX.length);
    for (const slug of ALEX) {
      const e = expected(slug), d = w.doc(slug), it = itemOf(w, slug);
      assert.equal(it.source_app, SOURCE);
      assert.equal(it.data.added, "2026-10-22", slug);
      assert.equal(it.data.folder, e.folder, `${slug}: folder`);
      if (e.not_in_notebook) {
        assert.deepEqual(Object.keys(it.data).sort(), ["added", "folder", "status"], slug);
        assert.equal(it.data.status, "kept out of the notebook");
        continue;
      }
      assert.equal(it.data.title, d.title, `${slug}: title`);
      // What the expected-result file names must match; what it leaves open is the document's own.
      assert.equal(it.data.sender, ("correspondent" in e ? e.correspondent : w.senderName(d)) ?? "", `${slug}: sender`);
      assert.equal(it.data.type, (e.document_type ?? w.typeName(d)) ?? "", `${slug}: type`);
      assert.equal(it.data.date, e.created ?? d.created, `${slug}: date`);
      for (const t of e.tags_include || []) assert.ok(it.data.tags.split(", ").includes(t), `${slug}: tag ${t}`);
      assert.equal(it.data.status, e.check ? "check this" : "sorted", `${slug}: status`);
      assert.equal(it.data.in_drive, true, `${slug}: in drive`);
      assert.equal(it.data.note, `https://notebook.example/dashboard/notes/${w.noteOf(slug).id}`, `${slug}: note link`);
      assert.equal(it.data.paperless, `${w.pl.url}/documents/${w.ids[slug]}/details`, `${slug}: Paperless link`);
      assert.equal(it.data.drive, `https://drive.google.com/file/d/${w.fileOf(slug)[0].id}/view`, `${slug}: drive link`);
      assert.equal(it.data.deadlines, undefined, "deadlines come with the next version");
    }
  } finally { await w.close(); }
});

test("F17: renaming a document updates its item", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "pay-slip"] });
  try {
    await w.runUntilQuiet();
    const before = itemOf(w, "utility-invoice");
    change(w, "utility-invoice", { title: "Electricity bill for February" });
    await w.runUntilQuiet();
    const after = itemOf(w, "utility-invoice");
    assert.equal(after.id, before.id);
    assert.equal(after.data.title, "Electricity bill for February");
    assert.equal(after.title, "Electricity bill for February");
    assert.equal(w.nb.rows("collection_items").length, 2);
  } finally { await w.close(); }
});

test("F17: the doctor's letter with \"Not in notebook\" has an item without a title", async () => {
  const w = await kitWorld({ only: ["doctor-letter"] });
  try {
    await w.runUntilQuiet();
    const it = itemOf(w, "doctor-letter");
    assert.equal(it.data.title, undefined);
    assert.notEqual(it.title, w.doc("doctor-letter").title);
    assert.ok(!JSON.stringify(it).includes("Linden"));
    assert.deepEqual(it.data, { added: "2026-10-22", folder: "Letters", status: "kept out of the notebook" });
  } finally { await w.close(); }
});

test("F11: an item shrinks to its kept-out form when the tag is added", async () => {
  const w = await kitWorld({ only: ["council-letter"] });
  try {
    await w.runUntilQuiet();
    assert.equal(itemOf(w, "council-letter").data.sender, "Fairford Borough Council");
    change(w, "council-letter", { tags: [...w.doc("council-letter").tags, tagId(w, "Not in notebook")] });
    await w.runUntilQuiet();
    const it = itemOf(w, "council-letter");
    assert.deepEqual(it.data, { added: "2026-10-22", folder: "Letters", status: "kept out of the notebook" });
    assert.equal(it.title, "Untitled", "the notebook shows no title for it");
    assert.ok(!JSON.stringify(it).includes("Fairford Borough Council"));
    assert.ok(!JSON.stringify(it).includes("Changes to the waste collection"));
  } finally { await w.close(); }
});

test("a column the person added keeps its value", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    await w.runUntilQuiet();
    const it = itemOf(w, "utility-invoice");
    w.nb.edit("collection_items", it.id, { data: { ...it.data, keep_until: "2035" } });
    change(w, "utility-invoice", { title: "Electricity bill for February" });
    await w.runUntilQuiet();
    const after = itemOf(w, "utility-invoice");
    assert.equal(after.data.keep_until, "2035");
    assert.equal(after.data.title, "Electricity bill for February");
  } finally { await w.close(); }
});

test("a paper nobody sorted yet is \"to sort\"; one placed by the Clerk's rules in nobody sorts is \"sorted\"", async () => {
  const w = await kitWorld({ sorting: "nobody", only: ["utility-invoice", "bank-certificate"] });
  try {
    await w.runUntilQuiet();
    assert.equal(itemOf(w, "utility-invoice").data.status, "to sort");
    assert.equal(itemOf(w, "utility-invoice").data.folder, "To sort");
    assert.equal(itemOf(w, "bank-certificate").data.status, "sorted");
    assert.deepEqual(w.pl.writes, []);
  } finally { await w.close(); }
});

test("the collection is found again after a reinstall: no second collection, no second item", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "doctor-letter"] });
  try {
    await w.runUntilQuiet();
    const items = w.nb.rows("collection_items").map((i) => `${i.id} ${i._hash}`).sort();
    const fs = await import("node:fs");
    fs.rmSync(w.paths.records, { recursive: true, force: true });
    fs.rmSync(w.paths.state, { force: true });
    await w.runUntilQuiet();
    assert.equal(collection(w).length, 1);
    assert.deepEqual(w.nb.rows("collection_items").map((i) => `${i.id} ${i._hash}`).sort(), items);
  } finally { await w.close(); }
});
