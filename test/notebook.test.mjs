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
