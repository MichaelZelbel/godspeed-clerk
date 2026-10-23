// The person's words for a folder (F19): a number, "the second one", a folder's name with a typo, a
// path, a Drive link, "put it with my travel stuff". Only folders inside the documents folder are
// ever named; a folder outside is refused; a folder that is not there yet is made only after a yes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kitWorld } from "./kit-world.mjs";
import { prepare } from "../lib/core/run.mjs";
import { parseReply, folderPhrase, findFolder } from "../lib/core/where.mjs";

test("replies: numbers, ordinals, yes, no, leave it, and words", () => {
  for (const [said, n, rest = ""] of [["1", 1], [" 2. ", 2], ["#3", 3], ["option 2", 2], ["Nummer 2", 2], ["number 4", 4], ["3, Travel", 3, "Travel"], ["3 Travel", 3, "Travel"], ["2)", 2]]) {
    assert.deepEqual(parseReply(said), { kind: "number", n, rest }, said);
  }
  for (const [said, i] of [["the second one", 1], ["second", 1], ["die zweite", 1], ["the first", 0], ["the last one", -1], ["third option", 2], ["den ersten", 0]]) {
    assert.deepEqual(parseReply(said), { kind: "ordinal", i }, said);
  }
  for (const said of ["yes", "Yes, make it", "ja", "ok", "sure", "go ahead"]) assert.equal(parseReply(said).kind, "yes", said);
  for (const said of ["no", "nein", "No."]) assert.equal(parseReply(said).kind, "no", said);
  for (const said of ["leave it", "skip", "never mind", "leave it in To sort"]) assert.equal(parseReply(said).kind, "leave", said);
  for (const said of ["the Travel folder", "Deutsche Bahn", "put it with my travel stuff", "the second folder from the top of Insurance"]) assert.equal(parseReply(said).kind, "words", said);
});

test("the folder in a sentence: the filler words around a name go", () => {
  assert.equal(folderPhrase("the Travel folder"), "Travel");
  assert.equal(folderPhrase("into my Travel folder please"), "Travel");
  assert.equal(folderPhrase("put it with my travel stuff"), "travel");
  assert.equal(folderPhrase("in den Ordner Reisen"), "Reisen");
  assert.equal(folderPhrase("\"Deutsche Bahn\""), "Deutsche Bahn");
  assert.equal(folderPhrase("Insurance/Car"), "Insurance/Car");
});

const TREE = {
  Paperwork: { Travel: {}, "Deutsche Bahn": { Tickets: {} }, Insurance: { Car: {}, Home: {} }, Letters: {}, Archive: { Travel: {}, Tickets: {} } },
  "Holiday photos": { "beach.jpg": "Not a document." },
};
const AI = [{ match: ["Which of their folders", "trips"], answer: { folder: "Travel" } }];

async function world() {
  const w = await kitWorld({ only: [], tree: TREE, rules: [{ folder: "{sender}" }], answers: AI });
  const c = await prepare(w.context());
  return { w, c, find: (words) => findFolder(c, words) };
}

test("a folder's own name, in any case, a path, or the documents folder's own name in front", async () => {
  const { w, find } = await world();
  try {
    for (const said of ["Deutsche Bahn", "deutsche bahn", "the Deutsche Bahn folder"]) assert.deepEqual((await find(said)).folder?.path, "Paperwork/Deutsche Bahn", said);
    for (const said of ["Insurance/Car", "Paperwork/Insurance/Car", "My Drive/Paperwork/Insurance/Car", "insurance / car"]) assert.equal((await find(said)).folder?.path, "Paperwork/Insurance/Car", said);
    assert.equal((await find("Travel")).folder?.path, "Paperwork/Travel", "the one at the top wins over one further down");
    assert.equal((await find("put it with my travel stuff")).folder?.path, "Paperwork/Travel");
    const t = await find("Tickets");
    assert.deepEqual(t.candidates?.map((x) => x.path).sort(), ["Paperwork/Archive/Tickets", "Paperwork/Deutsche Bahn/Tickets"], "two of that name further down: the person chooses");
    assert.equal(w.drive.writes.length, 0, "finding a folder writes nothing");
  } finally { await w.close(); }
});

test("a typo, and words only the AI can place, are offered to choose, never filed straight away", async () => {
  const { w, find } = await world();
  try {
    assert.deepEqual((await find("Deutsch Bahn")).candidates?.map((x) => x.path), ["Paperwork/Deutsche Bahn"]);
    assert.deepEqual((await find("Insurence")).candidates?.map((x) => x.path), ["Paperwork/Insurance"]);
    assert.deepEqual((await find("the folder for my trips")).candidates?.map((x) => x.path), ["Paperwork/Travel"]);
  } finally { await w.close(); }
});

test("a folder outside the documents folder is refused: by name, by path, by link", async () => {
  const { w, find } = await world();
  try {
    const outside = w.drive.idOf("Holiday photos");
    for (const said of ["Holiday photos", "My Drive/Holiday photos", "/Holiday photos", `https://drive.google.com/drive/folders/${outside}`, `https://drive.google.com/drive/u/0/folders/${outside}?usp=sharing`]) {
      const r = await find(said);
      assert.ok(r.outside, `${said}: ${JSON.stringify(r)}`);
      assert.equal(r.folder, undefined, said);
      assert.equal(r.missing, undefined, said);
    }
    assert.equal(w.drive.writes.length, 0);
    const inside = await find(`https://drive.google.com/drive/folders/${w.drive.idOf("Paperwork/Letters")}`);
    assert.equal(inside.folder?.path, "Paperwork/Letters", "a link to a folder inside is that folder");
  } finally { await w.close(); }
});

test("a folder that is not there: offered to make inside the documents folder, never made here", async () => {
  const { w, c, find } = await world();
  try {
    const g = await find("Gardening");
    assert.deepEqual(g.missing, { parent_id: c.rootId, parent: "Paperwork", names: ["Gardening"] });
    const p = await find("Insurance/Pets");
    assert.deepEqual(p.missing, { parent_id: w.drive.idOf("Paperwork/Insurance"), parent: "Paperwork/Insurance", names: ["Pets"] });
    assert.equal(w.drive.writes.length, 0);
    assert.ok((await find("To sort")).toSort, "To sort is where it waits, not where it goes");
    assert.ok((await find("   ")).empty);
  } finally { await w.close(); }
});
