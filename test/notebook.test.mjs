// The notebook client against a pretend notebook: the record requests the Clerk relies on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Notebook, NotebookError, NotebookDown } from "../lib/core/notebook.mjs";
import { startFakeNotebook } from "./fakes/notebook.mjs";

test("the notebook client: insert, read back, update with the version read", async () => {
  const fake = await startFakeNotebook();
  try {
    const nb = new Notebook({ base: fake.url });
    assert.equal(await nb.answers(), true);
    assert.equal(await nb.address(), "https://notebook.example");
    assert.equal(await nb.note("clerk-abc"), null);
    const made = await nb.insertNote({ id: "clerk-abc", title: "A made-up letter", content: "text", folder_path: "Documents", clerk_doc: 7 });
    assert.equal(made.id, "clerk-abc");
    const read = await nb.note("clerk-abc");
    assert.equal(read.clerk_doc, 7);
    assert.equal(read.is_trashed, false);
    const after = await nb.updateNote("clerk-abc", { title: "Renamed" }, read._hash);
    assert.equal(after.title, "Renamed");
    assert.equal(after.content, "text");
    // Only that one note: an update always names its row.
    await nb.insertNote({ id: "clerk-def", title: "Another", content: "x" });
    await nb.updateNote("clerk-abc", { content: "y" }, after._hash);
    assert.equal((await nb.note("clerk-def")).content, "x");
    const coll = await nb.createCollection({ name: "Documents", source_app: "godspeed-clerk", field_schema: [{ key: "title", label: "Title", type: "text", primary: true }] });
    assert.equal(coll.slug, "documents");
    assert.equal((await nb.collectionsBy("godspeed-clerk")).length, 1);
    const it = await nb.insertItem({ collection_id: coll.id, source_app: "godspeed-clerk", source_id: "sum1", data: { title: "A made-up letter" } });
    assert.equal((await nb.item(coll.id, "sum1")).id, it.id);
    assert.equal((await nb.updateItem(it.id, { title: "B" }, it._hash)).title, "B");
  } finally { await fake.close(); }
});

test("a stale version is refused (409) and nothing changes", async () => {
  const fake = await startFakeNotebook();
  try {
    const nb = new Notebook({ base: fake.url });
    const made = await nb.insertNote({ id: "clerk-abc", title: "T", content: "mine" });
    fake.edit("notes", "clerk-abc", { content: "the person's words" });
    await assert.rejects(nb.updateNote("clerk-abc", { content: "the Clerk's" }, made._hash), (e) => e instanceof NotebookError && e.status === 409 && e.code === "CONFLICT");
    assert.equal(fake.row("notes", "clerk-abc").content, "the person's words");
  } finally { await fake.close(); }
});

test("a deleted note cannot be made again", async () => {
  const fake = await startFakeNotebook();
  try {
    const nb = new Notebook({ base: fake.url });
    await nb.insertNote({ id: "clerk-abc", title: "T", content: "x" });
    fake.remove("notes", "clerk-abc");
    assert.equal(await nb.note("clerk-abc"), null);
    await assert.rejects(nb.insertNote({ id: "clerk-abc", title: "T", content: "x" }), (e) => e instanceof NotebookError && e.exists === true);
  } finally { await fake.close(); }
});

test("down: NotebookDown, answers() false", async () => {
  const fake = await startFakeNotebook();
  try {
    const nb = new Notebook({ base: fake.url, timeoutMs: 2000 });
    fake.down = true;
    assert.equal(await nb.answers(), false);
    await assert.rejects(nb.note("clerk-abc"), (e) => e instanceof NotebookDown);
  } finally { await fake.close(); }
});

// Deadlines an add-on keeps (the product's POST /api/functions/addon-deadlines, discussion #27):
// made once per key, listed, changed only while the person has not touched them.
test("deadlines: made once per key, listed, changed only while nobody touched them", async () => {
  const fake = await startFakeNotebook();
  try {
    const nb = new Notebook({ base: fake.url });
    const one = { key: "ab12#1", title: "Pay the made-up water bill", due: "2026-11-20", done_when: "Paid.", cost: "A fee.", link: "http://paperless.example/documents/7/details" };
    const made = await nb.deadlines({ action: "create", ...one });
    assert.equal(made.created, true);
    assert.equal(made.deadline.due, "2026-11-20");
    const again = await nb.deadlines({ action: "create", ...one, due: "2026-12-01" });
    assert.equal(again.created, false);
    assert.equal(again.deadline.due, "2026-11-20");
    assert.equal(fake.deadlineRows().length, 1);
    assert.equal(fake.deadlineRows()[0].addon, "godspeed-clerk", "the client names the Clerk");
    const moved = await nb.deadlines({ action: "update", key: "ab12#1", due: "2026-11-25" });
    assert.equal(moved.updated, true);
    fake.personMoves("ab12#1", "2026-11-28");
    const left = await nb.deadlines({ action: "update", key: "ab12#1", due: "2026-11-30" });
    assert.deepEqual([left.updated, left.touched], [false, true]);
    const listed = (await nb.deadlines({ action: "list" })).deadlines;
    assert.deepEqual(listed.map((d) => [d.key, d.due, d.touched]), [["ab12#1", "2026-11-28", true]]);
    await assert.rejects(nb.deadlines({ action: "create", ...one, key: "ab12#2", due: "2026-02-30" }), (e) => e instanceof NotebookError && e.status === 400);
  } finally { await fake.close(); }
});

test("a Godspeed without add-on deadlines: the client says the function is missing", async () => {
  const fake = await startFakeNotebook();
  try {
    fake.withoutDeadlines = true;
    const nb = new Notebook({ base: fake.url });
    await assert.rejects(nb.deadlines({ action: "list" }), (e) => e instanceof NotebookError && e.missing === true);
  } finally { await fake.close(); }
});
