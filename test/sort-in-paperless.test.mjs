// F19: sort in Paperless, and the drive follows. What a person does on Paperless's own pages (pick a
// storage path, make one, pick a sender), and what the Clerk does when Godspeed sorts.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { kitWorld, ANSWERS } from "./kit-world.mjs";
import { readJson, writeJson } from "../lib/core/files.mjs";

const yes = { storage_paths: "yes" };
const spNamed = (w, name) => [...w.pl.state.storagePaths.values()].find((s) => s.name === name);
const view = (w) => [...w.pl.state.savedViews.values()][0];
const folderOf = (w, slug) => String(w.pathOf(slug)).split("/").slice(0, -1).join("/");
const tagId = (w, name) => [...w.pl.state.tags.values()].find((t) => t.name === name)?.id;
// The person's change on a document's page in Paperless.
const set = (w, slug, fields) => Object.assign(w.doc(slug), fields, { modified: new Date().toISOString() });
function addPaper(w, slug, id, content, minute) {
  w.pl.addDoc({ id, content, title: `Scan 2026-10-22 19-${minute}-00`, original_file_name: `Scan 2026-10-22 19-${minute}-00.pdf`, tags: [1], owner: 2, created: "2026-10-22", added: `2026-10-22T19:${minute}:00+02:00` });
  w.ids[slug] = id;
}

test("F19: picking a plan folder as the blurry paper's storage path moves its file at the next run, takes off Check this, and takes it off the To sort page", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "utility-invoice"], settings: yes });
  try {
    await w.runUntilQuiet();
    const id = w.ids["blurry-scan"];
    assert.deepEqual(w.pl.viewDocs(view(w).id), [id]);
    assert.equal(w.doc("blurry-scan").storage_path, spNamed(w, "To sort").id);
    set(w, "blurry-scan", { storage_path: spNamed(w, "Letters").id });
    await w.run();
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Letters");
    assert.ok(!w.tagNames(w.doc("blurry-scan")).includes("Check this"));
    assert.deepEqual(w.pl.viewDocs(view(w).id), []);
    assert.equal(w.doc("blurry-scan").storage_path, spNamed(w, "Letters").id, "the person's pick stays");
    const item = w.nb.rows("collection_items").find((i) => i.source_id === w.record("blurry-scan").sum);
    assert.equal(item?.data.status, "sorted");
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Letters", "and stays there");
  } finally { await w.close(); }
});

const secondLetter = "Pinecrest Dental Practice\n3 Orchard Close, 40250 Fairford\n\nAlex Morgan\n12 Elm Row\n40210 Fairford\n\nFairford, 2 October 2025\n\nInvoice PD-2210 for your check-up on 1 October 2025: 64.00 EUR.\nPlease pay within 30 days.\n\nPinecrest Dental Practice";
const secondAnswer = { match: ["PD-2210"], answer: { title: "Invoice for the dental check-up", correspondent: "Pinecrest Dental Practice", document_type: "Invoice", tags: [], created: "2025-10-02", folder: null, confident: false, unsure: ["document_type"] } };

test("F19: a second paper from the same sender is filed into that folder without being shown on the To sort page", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes, answers: [secondAnswer, ...ANSWERS] });
  try {
    await w.runUntilQuiet();
    set(w, "blurry-scan", { storage_path: spNamed(w, "Letters").id });
    await w.runUntilQuiet();
    assert.equal(w.senderName(w.doc("blurry-scan")), "Pinecrest Dental Practice", "the sender read off the letter, the AI sure of it");
    assert.equal(readJson(w.paths.plan).rules[0].sender, "Pinecrest Dental Practice");
    addPaper(w, "dental-invoice", 50, secondLetter, "10");
    const before = w.messages.length;
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "dental-invoice"), "Paperwork/Letters");
    assert.ok(!w.tagNames(w.doc("dental-invoice")).includes("Check this"));
    assert.ok(!w.pl.viewDocs(view(w).id).includes(50));
    assert.equal(w.doc("dental-invoice").storage_path, spNamed(w, "Letters").id);
    assert.equal(w.messages.length, before, "nothing to tell");
  } finally { await w.close(); }
});

test("F19: a storage path the person makes in Paperless becomes a folder inside the documents folder", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    const mine = w.pl.addStoragePath({ name: "Dentist", path: "dentist/{{ title }}" });
    set(w, "blurry-scan", { storage_path: mine.id });
    await w.run();
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Dentist");
    assert.ok(w.drive.byPath("Paperwork/Dentist"));
    assert.deepEqual(w.pl.state.storagePaths.get(mine.id), mine, "the person's storage path is not changed");
    assert.ok(!w.tagNames(w.doc("blurry-scan")).includes("Check this"));
    const writes = w.drive.writes.filter((x) => x.op === "create-folder");
    assert.ok(writes.every((x) => w.drive.pathOf(x.id).startsWith("Paperwork/")), "never anywhere else");
  } finally { await w.close(); }
});

test("F19: a storage path named to lead outside the documents folder still becomes a folder inside it", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    const mine = w.pl.addStoragePath({ name: "../Holiday photos", path: "x/{{ title }}" });
    set(w, "blurry-scan", { storage_path: mine.id });
    await w.run();
    assert.match(folderOf(w, "blurry-scan"), /^Paperwork\/[^/]+$/);
    assert.ok(!w.pathOf("blurry-scan").startsWith("Holiday photos"));
  } finally { await w.close(); }
});

const SENDER_TREE = { Paperwork: { "Pinecrest Dental Practice": {}, Letters: {} }, "Holiday photos": {} };

test("F19: with the person's \"no\", Paperless's storage paths are unchanged, and a sender the person picks still files the paper", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], tree: SENDER_TREE, rules: [{ folder: "{sender}" }], settings: { storage_paths: "no" } });
  try {
    const mine = w.pl.addStoragePath({ name: "Archive 2019", path: "old/{{ title }}" });
    await w.runUntilQuiet();
    assert.match(w.pathOf("blurry-scan"), /^Paperwork\/To sort\//);
    w.pl.state.correspondents.set(90, { id: 90, name: "Pinecrest Dental Practice", matching_algorithm: 0, match: "", owner: 2 });
    set(w, "blurry-scan", { correspondent: 90 });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Pinecrest Dental Practice");
    assert.ok(!w.tagNames(w.doc("blurry-scan")).includes("Check this"), "resolved: Check this is off");
    assert.deepEqual([...w.pl.state.storagePaths.values()], [mine]);
    assert.equal(w.pl.state.savedViews.size, 0);
    assert.equal(w.doc("blurry-scan").storage_path, null);
    // A storage path the person picks is not followed without their yes.
    set(w, "blurry-scan", { storage_path: mine.id });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Pinecrest Dental Practice");
  } finally { await w.close(); }
});

test("when Godspeed sorts, the papers filed before the yes get their storage paths once; papers waiting get To sort", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "council-letter", "blurry-scan", "bank-certificate"] });
  try {
    await w.runUntilQuiet();
    const s = readJson(w.paths.settings);
    writeJson(w.paths.settings, { ...s, storage_paths: "yes" });
    await w.runUntilQuiet();
    const sp = (slug) => w.pl.state.storagePaths.get(w.doc(slug).storage_path)?.name;
    assert.deepEqual(["utility-invoice", "council-letter", "blurry-scan", "bank-certificate"].map(sp), ["Brightwater Utilities", "Letters", "To sort", "Taxes"]);
    const patches = w.pl.writes.filter((x) => x.method === "PATCH" && /documents/.test(x.path)).length;
    await w.runUntilQuiet();
    assert.equal(w.pl.writes.filter((x) => x.method === "PATCH" && /documents/.test(x.path)).length, patches, "once");
  } finally { await w.close(); }
});

test("a storage path Paperless's own matching gave a new paper is followed, and its Check this taken off", async () => {
  const w = await kitWorld({ only: [], settings: yes });
  try {
    await w.runUntilQuiet();
    addPaper(w, "blurry-again", 51, "Pinecrest Dental Practice. Your next dental check-up is due in October 2025. Please call us to book a time that suits you. Kind regards.", "20");
    w.doc("blurry-again").storage_path = spNamed(w, "Letters").id;
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "blurry-again"), "Paperwork/Letters");
    assert.ok(!w.tagNames(w.doc("blurry-again")).includes("Check this"));
  } finally { await w.close(); }
});

test("with \"Paperless sorts\" and the yes, a pick is followed and nothing of a document is written", async () => {
  const w = await kitWorld({ sorting: "paperless", only: ["council-letter"], tree: SENDER_TREE, rules: [{ type: "Invoice", folder: "{sender}" }], settings: yes, answers: [{ match: ["Pick the folder"], answer: { folder: null, confident: false } }] });
  try {
    const d = w.doc("council-letter");
    const letter = [...w.pl.state.types.values()].find((t) => t.name === "Letter").id;
    Object.assign(d, { title: "Bin collection days", document_type: letter, tags: [], created: "2025-06-02" });
    await w.runUntilQuiet();
    const docWrites = () => w.pl.writes.filter((x) => /\/api\/(documents|tags|correspondents|document_types)\//.test(x.path));
    assert.deepEqual(docWrites(), []);
    set(w, "council-letter", { storage_path: spNamed(w, "Letters").id });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "council-letter"), "Paperwork/Letters");
    assert.deepEqual(docWrites(), [], "never a write to a document, a tag, a sender or a type");
  } finally { await w.close(); }
});

// What the reviewer of the first round taught.
test("a pick is never lost: Google refusing the move keeps it for the next run", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    set(w, "blurry-scan", { storage_path: spNamed(w, "Letters").id });
    w.drive.revoke();
    await w.run();
    assert.match(w.pathOf("blurry-scan"), /^Paperwork\/To sort\//);
    writeJson(w.paths.drive, { ...readJson(w.paths.drive), refresh_token: w.drive.issue() });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Letters");
    assert.equal(w.fileOf("blurry-scan").length, 1);
  } finally { await w.close(); }
});

test("a pick for one paper never files another sender's paper", async () => {
  const other = { slug: "other-letter", owner: "alex", content: "Marlow Clinic. A note about appointment MC-4410 for Alex Morgan, 12 Elm Row, 40210 Fairford. Please call us." };
  const w = await kitWorld({ only: ["blurry-scan"], extra: [other], settings: yes });
  try {
    await w.runUntilQuiet();
    assert.match(w.pathOf("other-letter"), /^Paperwork\/To sort\//);
    set(w, "blurry-scan", { storage_path: spNamed(w, "Letters").id });
    await w.runUntilQuiet();
    assert.match(w.pathOf("other-letter"), /^Paperwork\/To sort\//, "still waiting");
    assert.ok(w.tagNames(w.doc("other-letter")).includes("Check this"));
    assert.equal(w.senderName(w.doc("other-letter")), null);
  } finally { await w.close(); }
});

test("a waiting paper from the same sender is filed once that sender's folder is learned", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    addPaper(w, "dental-two", 52, "Pinecrest Dental Practice. Reminder DR-7781 for Alex Morgan, 12 Elm Row, 40210 Fairford. Kind regards.", "30");
    await w.runUntilQuiet();
    w.pl.state.correspondents.set(91, { id: 91, name: "Pinecrest Dental Practice", matching_algorithm: 0, match: "", owner: 2 });
    set(w, "dental-two", { correspondent: 91 });
    set(w, "blurry-scan", { correspondent: 91, storage_path: spNamed(w, "Letters").id });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Letters");
    assert.equal(folderOf(w, "dental-two"), "Paperwork/Letters", "the same sender's waiting paper follows");
  } finally { await w.close(); }
});

test("a folder never becomes a sender: picked for a paper whose sender the AI cannot tell, no sender is made", async () => {
  const unsure = [{ match: ["Who sent this document"], answer: { correspondent: "Letters", sure: false } }, ...ANSWERS];
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes, answers: unsure });
  try {
    await w.runUntilQuiet();
    set(w, "blurry-scan", { storage_path: spNamed(w, "Letters").id });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Letters");
    assert.equal(w.senderName(w.doc("blurry-scan")), null);
    assert.equal(w.pl.writes.filter((x) => x.path === "/api/correspondents/").length, 0);
    assert.ok(!readJson(w.paths.plan).rules.some((r) => r.sender), "nothing learned");
  } finally { await w.close(); }
});

test("a paper the AI is unsure of is on the To sort page at once, also while Google Drive is away", async () => {
  const w = await kitWorld({ only: ["utility-invoice"], settings: yes });
  try {
    await w.runUntilQuiet();
    w.drive.revoke();
    addPaper(w, "blurry-late", 53, "Pinecrest Dental Practice. Your next dental check-up is due in October 2025. Please call us to book a time that suits you. Kind regards.", "50");
    await w.run();
    assert.ok(w.tagNames(w.doc("blurry-late")).includes("Check this"));
    assert.deepEqual(w.pl.viewDocs(view(w).id), [53], "on the page, though its file is not in the drive yet");
    const patches = w.pl.writes.filter((x) => x.path === "/api/documents/53/");
    assert.equal(patches.length, 1, "in the same update that sorted it");
  } finally { await w.close(); }
});

test("a paper sorted while Google Drive is away is told once: not again when its file reaches To sort", async () => {
  const w = await kitWorld({ only: ["utility-invoice"], settings: yes });
  try {
    await w.runUntilQuiet();
    w.drive.revoke();
    addPaper(w, "blurry-away", 54, "Pinecrest Dental Practice. Your next dental check-up is due in October 2025. Please call us to book a time that suits you. Kind regards.", "55");
    await w.run();
    await w.run();
    const told = w.messages.length;
    assert.match(w.messages.at(-1), /1 paper is waiting to be sorted\./);
    writeJson(w.paths.drive, { ...readJson(w.paths.drive), refresh_token: w.drive.issue() });
    await w.runUntilQuiet();
    assert.match(w.pathOf("blurry-away"), /^Paperwork\/To sort\//);
    assert.equal(w.messages.length, told, "not told twice about the same wait");
  } finally { await w.close(); }
});

test("F18: with the records lost, storage paths that stand for where the files are change nothing", async () => {
  const fs = await import("node:fs");
  const w = await kitWorld({ only: ["utility-invoice", "council-letter", "blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    set(w, "blurry-scan", { storage_path: spNamed(w, "Letters").id });
    await w.runUntilQuiet();
    const pl = w.pl.writes.length, drive = w.drive.writes.length, prompts = w.prompts.length, plan = JSON.stringify(readJson(w.paths.plan));
    fs.rmSync(w.paths.records, { recursive: true, force: true });
    await w.runUntilQuiet();
    assert.equal(w.drive.writes.length, drive, "no move, no rename");
    assert.equal(w.pl.writes.length, pl, "nothing written in Paperless");
    assert.equal(w.prompts.length, prompts, "no AI asked who sent anything");
    assert.equal(JSON.stringify(readJson(w.paths.plan)), plan);
  } finally { await w.close(); }
});

// F19's last bullet (batch 4, the open item from batch 2b): in "Paperless sorts" and "nobody sorts"
// the Clerk changes no document, so its To sort page is a saved view of the papers that have no
// storage path yet; the message links to it there too, never to the notebook's collection.
const NO_PATH = [{ rule_type: 25, value: null }];
const linksIn = (m) => String(m).match(/https?:\/\/\S+/g) || [];
// Paperless (or the person) sorted the papers before the Clerk ran: the gym letter as a Contract,
// a type the plan has no folder for, so it is the paper to sort.
function sortedInPaperless(w) {
  const byName = (m, n) => [...m.values()].find((x) => x.name === n);
  Object.assign(w.doc("utility-invoice"), { document_type: byName(w.pl.state.types, "Invoice").id, created: "2025-09-03" });
  Object.assign(w.doc("gym-letter"), { document_type: byName(w.pl.state.types, "Contract").id, created: "2025-09-03" });
}

test("F19: with Paperless or nobody sorting and the yes, the To sort page lists the papers without a storage path, in the sidebar and on the dashboard, and the message links to it", async () => {
  for (const sorting of ["paperless", "nobody"]) {
    const w = await kitWorld({ sorting, only: ["gym-letter", "utility-invoice", "council-letter"], settings: yes });
    try {
      sortedInPaperless(w);
      await w.runUntilQuiet();
      const v = view(w);
      assert.ok(v, `${sorting}: a To sort page`);
      assert.equal(v.name, "To sort");
      assert.deepEqual(v.filter_rules.map((r) => ({ rule_type: r.rule_type, value: r.value ?? null })), NO_PATH, `${sorting}: one rule, no storage path`);
      assert.deepEqual(w.pl.visibleViews(), { sidebar: [v.id], dashboard: [v.id] }, `${sorting}: in the sidebar and on the dashboard`);
      const alex = Object.keys(w.ids).filter((s) => w.doc(s).owner === 2).map((s) => w.ids[s]).sort((a, b) => a - b);
      assert.deepEqual(w.pl.viewDocs(v.id).filter((id) => w.pl.doc(id).owner === 2).sort((a, b) => a - b), alex, `${sorting}: every paper without a storage path (the Clerk writes none here)`);
      const told = w.messages.filter((m) => /waiting to be sorted/.test(m));
      assert.ok(told.length >= 1, `${sorting}: the papers to sort are told`);
      for (const m of told) {
        assert.ok(linksIn(m).some((l) => l.endsWith(`/view/${v.id}`)), `${sorting}: the message links to the To sort page: ${m}`);
        assert.ok(!linksIn(m).some((l) => /\/collections\//.test(l)), `${sorting}: never to the notebook's collection`);
      }
    } finally { await w.close(); }
  }
});

test("F19: with nobody sorting and the person's no, no page is made and the message links to Paperless's list of papers without a storage path", async () => {
  const w = await kitWorld({ sorting: "nobody", only: ["gym-letter", "utility-invoice"], settings: { storage_paths: "no" } });
  try {
    sortedInPaperless(w);
    await w.runUntilQuiet();
    assert.equal(w.pl.state.savedViews.size, 0, "no saved view");
    assert.equal(w.pl.state.storagePaths.size, 0, "no storage path");
    const told = w.messages.filter((m) => /waiting to be sorted/.test(m));
    assert.ok(told.length >= 1, "told");
    assert.ok(linksIn(told.at(-1)).some((l) => l.endsWith("/documents?storage_path__isnull=1")), told.at(-1));
    assert.ok(!linksIn(told.at(-1)).some((l) => /\/collections\//.test(l)), "never the collection");
  } finally { await w.close(); }
});

test("F19: the To sort page follows the sorting setting: Godspeed's To sort path, then no storage path, then To sort again", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "utility-invoice"], settings: yes });
  try {
    await w.runUntilQuiet();
    const v = view(w);
    const toSort = spNamed(w, "To sort").id;
    assert.deepEqual(v.filter_rules.map((r) => [r.rule_type, String(r.value)]), [[25, String(toSort)]]);
    const s = readJson(w.paths.settings);
    writeJson(w.paths.settings, { ...s, sorting: "nobody" });
    await w.run();
    assert.deepEqual(view(w).filter_rules.map((r) => ({ rule_type: r.rule_type, value: r.value ?? null })), NO_PATH);
    assert.deepEqual(w.pl.visibleViews(), { sidebar: [v.id], dashboard: [v.id] }, "still shown");
    assert.equal(w.pl.state.savedViews.size, 1, "the same page, no second one");
    writeJson(w.paths.settings, { ...readJson(w.paths.settings), sorting: "godspeed" });
    await w.run();
    assert.deepEqual(view(w).filter_rules.map((r) => [r.rule_type, String(r.value)]), [[25, String(toSort)]]);
    assert.deepEqual(w.pl.viewDocs(v.id), [w.ids["blurry-scan"]]);
  } finally { await w.close(); }
});

test("F18, F19: a Clerk whose records were lost finds its own To sort page from Paperless sorts again, and makes no second one", async () => {
  const w = await kitWorld({ sorting: "paperless", only: ["gym-letter", "utility-invoice"], settings: yes });
  try {
    sortedInPaperless(w);
    await w.runUntilQuiet();
    assert.equal(w.pl.state.savedViews.size, 1);
    const [v] = [...w.pl.state.savedViews.values()];
    // The records are lost (a new state folder would be the same): Godspeed sorts from now on.
    for (const f of [w.paths.mirror]) fs.rmSync(f, { force: true });
    writeJson(w.paths.settings, { ...readJson(w.paths.settings), sorting: "godspeed" });
    await w.runUntilQuiet();
    assert.equal(w.pl.state.savedViews.size, 1, `no second page: ${JSON.stringify([...w.pl.state.savedViews.values()].map((x) => x.name))}`);
    assert.deepEqual(view(w).filter_rules.map((r) => [r.rule_type, String(r.value)]), [[25, String(spNamed(w, "To sort").id)]], "its rule follows the setting");
    assert.equal(view(w).id, v.id);
  } finally { await w.close(); }
});
