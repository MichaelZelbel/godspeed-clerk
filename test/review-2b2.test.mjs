// Independent review of batch 2b (F19): what a person does on Paperless's own pages, with fresh
// made-up papers and senders. Every name and letter here is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kitWorld, ANSWERS } from "./kit-world.mjs";
import { readJson, writeJson } from "../lib/core/files.mjs";
import { cli } from "./helpers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const yes = { storage_paths: "yes" };
const spNamed = (w, name) => [...w.pl.state.storagePaths.values()].find((s) => s.name === name);
const view = (w) => [...w.pl.state.savedViews.values()][0];
const folderOf = (w, slug) => String(w.pathOf(slug)).split("/").slice(0, -1).join("/");
const set = (w, slug, fields) => Object.assign(w.doc(slug), fields, { modified: new Date().toISOString() });
const links = (t) => t.match(/https?:\/\/\S+/g) || [];
const tagId = (w, name) => [...w.pl.state.tags.values()].find((t) => t.name === name)?.id;
let minute = 0;
function addPaper(w, slug, id, content) {
  const m = String(10 + (minute++ % 49)).padStart(2, "0");
  w.pl.addDoc({ id, content, title: `Scan 2026-10-22 20-${m}-00`, original_file_name: `Scan 2026-10-22 20-${m}-00.pdf`, tags: [1], owner: 2, created: "2026-10-22", added: `2026-10-22T20:${m}:00+02:00` });
  w.ids[slug] = id;
}
const letter = (sender, ref, body) => `${sender}\n4 Mill Lane, 40260 Fairford\n\nAlex Morgan\n12 Elm Row\n40210 Fairford\n\nFairford, 3 September 2025\n\n${body} Reference ${ref}.\nKind regards,\n${sender}`;

// ---------------------------------------------------------------------------------------------
// 1. Paperless's own matching at consumption is not the person's choice.
const tw1 = letter("Thornfield Water Ltd", "TW-77001", "Invoice for the water supply from June to August 2025: 61.20 EUR, collected by direct debit.");
const tw2 = letter("Thornfield Water Ltd", "TW-77002", "Invoice for the water supply from September to November 2025: 58.90 EUR, collected by direct debit.");
const twAnswer = (ref, title, created) => ({ match: [ref], answer: { title, correspondent: "Thornfield Water", document_type: "Invoice", tags: ["Home"], created, folder: "Invoices/{sender}", sender_folder: "NEW", confident: true, summary: "Thornfield Water bills the water supply. It is collected by direct debit.", key_facts: [] } });
const TW_ANSWERS = [twAnswer("TW-77001", "Water invoice June to August 2025", "2025-09-03"), twAnswer("TW-77002", "Water invoice September to November 2025", "2025-09-03"), ...ANSWERS];

test("REVIEW 1: a storage path Paperless's classifier gave a new paper at consumption is not learned as the person's choice for that sender", async () => {
  const w = await kitWorld({ only: ["utility-invoice"], settings: yes, answers: TW_ANSWERS });
  try {
    await w.runUntilQuiet();
    addPaper(w, "water-1", 61, tw1);
    w.doc("water-1").storage_path = spNamed(w, "Letters").id; // Paperless's Auto matching guessed "Letters" while consuming it
    await w.runUntilQuiet();
    console.log(`REVIEW 1: the confidently sorted invoice went to ${folderOf(w, "water-1")}; plan rules now: ${JSON.stringify(readJson(w.paths.plan).rules.slice(0, 2))}`);
    assert.ok(!readJson(w.paths.plan).rules.some((r) => r.sender), "a classifier's guess is not a sender rule the person made");
    addPaper(w, "water-2", 62, tw2);
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "water-2"), "Paperwork/Invoices/Thornfield Water", "the next invoice from that sender goes where the plan says");
  } finally { await w.close(); }
});

// The person's Paperless had storage paths of its own on old papers; they then said yes.
test("REVIEW 2: saying yes does not move papers that carried the person's own storage paths from before into new folders", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "council-letter"] });
  try {
    const mine = w.pl.addStoragePath({ name: "Household 2025", path: "household/{{ title }}" });
    w.doc("utility-invoice").storage_path = mine.id; // set years ago, long before the Clerk
    w.doc("council-letter").storage_path = mine.id;
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "utility-invoice"), "Paperwork/Invoices/Brightwater Utilities");
    assert.equal(folderOf(w, "council-letter"), "Paperwork/Letters");
    const r = await cli(["plan", "mirror", "--storage-paths", "yes", "--state", w.paths.root], { env: envFor(w) });
    assert.equal(r.code, 0, r.err);
    await w.runUntilQuiet();
    console.log(`REVIEW 2: after the yes: ${w.pathOf("utility-invoice")} | ${w.pathOf("council-letter")} | rules ${JSON.stringify(readJson(w.paths.plan).rules.filter((x) => x.sender))}`);
    assert.equal(folderOf(w, "utility-invoice"), "Paperwork/Invoices/Brightwater Utilities", "a paper filed by the plan stays where it is");
    assert.equal(folderOf(w, "council-letter"), "Paperwork/Letters");
  } finally { await w.close(); }
});

// ---------------------------------------------------------------------------------------------
// 3. Two waiting papers from the same sender: a pick for one files the other.
const ng = (ref) => letter("Northgate Insurance", ref, "We write to you about your policy. Please read this letter carefully and keep it.");
const NG_ANSWERS = ["NGX-50110", "NGX-50120"].map((ref) => ({ match: [ref], answer: { title: "Letter about a policy", correspondent: "Northgate Insurance", document_type: null, tags: [], created: null, folder: null, confident: false } }));

test("REVIEW 3: a pick for one waiting paper files the same sender's other waiting paper (not modified since)", async () => {
  const w = await kitWorld({ only: [], settings: yes, answers: [...NG_ANSWERS, ...ANSWERS] });
  try {
    addPaper(w, "ng-a", 71, ng("NGX-50110"));
    addPaper(w, "ng-b", 72, ng("NGX-50120"));
    await w.runUntilQuiet();
    for (const s of ["ng-a", "ng-b"]) {
      assert.equal(folderOf(w, s), "Paperwork/To sort");
      assert.equal(w.senderName(w.doc(s)), "Northgate Insurance");
      assert.ok(w.tagNames(w.doc(s)).includes("Check this"));
    }
    set(w, "ng-b", { storage_path: spNamed(w, "Insurance").id });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "ng-b"), "Paperwork/Insurance");
    assert.equal(readJson(w.paths.plan).rules[0].sender, "Northgate Insurance", "learned");
    assert.equal(folderOf(w, "ng-a"), "Paperwork/Insurance", "the same sender's waiting paper follows");
    assert.ok(!w.pl.viewDocs(view(w).id).includes(w.ids["ng-a"]));
  } finally { await w.close(); }
});

// ---------------------------------------------------------------------------------------------
// 4. "Nobody sorts" / "Paperless sorts" with the yes: the message's link opens the page with the paper.
test("REVIEW 4: with nobody or Paperless sorting and the yes, the message's link opens a page that lists the paper waiting", async () => {
  for (const sorting of ["nobody", "paperless"]) {
    const vet = { slug: "vet-receipt", owner: "alex", content: "Ashgrove Vet Clinic, 9 Quarry Road, 40270 Fairford. Receipt AVC-3301 for a check-up of the cat on 14 August 2025: 48.00 EUR paid by card. Thank you." };
    const w = await kitWorld({ sorting, only: [], extra: [vet], settings: yes });
    try {
      const receipt = [...w.pl.state.types.values()].find((t) => t.name === "Receipt").id;
      Object.assign(w.doc("vet-receipt"), { document_type: receipt, tags: [], created: "2025-08-14" }); // sorted in Paperless; the plan has no folder for receipts
      await w.runUntilQuiet();
      assert.equal(folderOf(w, "vet-receipt"), "Paperwork/To sort", sorting);
      assert.equal(w.messages.length, 1, sorting);
      const [link] = links(w.messages[0]);
      console.log(`REVIEW 4 (${sorting}): ${w.messages[0]} | page lists ${JSON.stringify(view(w) ? w.pl.viewDocs(view(w).id) : null)}`);
      if (link.includes("/view/")) assert.deepEqual(w.pl.viewDocs(Number(link.split("/view/")[1])), [w.ids["vet-receipt"]], `${sorting}: the To sort page lists the paper the message counts`);
    } finally { await w.close(); }
  }
});

// 5. The person deleted the Clerk's "To sort" storage path in Paperless.
test("REVIEW 5: after the person deleted the To sort storage path, a message never links to a page that lists nothing", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 1);
    const ts = spNamed(w, "To sort");
    w.pl.state.storagePaths.delete(ts.id);
    for (const { doc } of w.pl.state.docs.values()) if (doc.storage_path === ts.id) doc.storage_path = null; // Paperless sets it to none
    addPaper(w, "optician", 81, letter("Corrin and Hale Opticians", "CH-2290", "Your new glasses are ready. Please call us to arrange a time to collect them."));
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 2);
    const [link] = links(w.messages[1]);
    console.log(`REVIEW 5: ${w.messages[1]}`);
    if (link.includes("/view/")) assert.ok(w.pl.viewDocs(Number(link.split("/view/")[1])).includes(81), "the page the link opens lists the new paper");
  } finally { await w.close(); }
});

// ---------------------------------------------------------------------------------------------
// 6. Storage paths the person makes.
test("REVIEW 6: a storage path the person names like To sort (another case) never files a paper into To sort as sorted, nor teaches that", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    const toSortId = readJson(w.paths.plan).to_sort.id;
    const mine = w.pl.addStoragePath({ name: "to sort", path: "later/{{ title }}" });
    set(w, "blurry-scan", { storage_path: mine.id });
    await w.runUntilQuiet();
    const item = w.nb.rows("collection_items").find((i) => i.source_id === w.record("blurry-scan").sum);
    console.log(`REVIEW 6: file ${w.pathOf("blurry-scan")}, status ${item?.data.status}, tags ${w.tagNames(w.doc("blurry-scan"))}, rules ${JSON.stringify(readJson(w.paths.plan).rules.filter((r) => r.sender))}`);
    assert.ok(!readJson(w.paths.plan).rules.some((r) => r.folder_id === toSortId), "no rule sends a sender's papers into To sort");
    assert.ok(!(folderOf(w, "blurry-scan") === "Paperwork/To sort" && item?.data.status === "sorted"), "never 'sorted' while it lies in To sort");
  } finally { await w.close(); }
});

test("REVIEW 7: a storage path the person names like an existing folder (another case) does not stop the Clerk's own path from following a rename", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "council-letter"], settings: yes });
  try {
    await w.runUntilQuiet();
    const clerks = spNamed(w, "Letters");
    const mine = w.pl.addStoragePath({ name: "letters", path: "post/{{ title }}" });
    set(w, "blurry-scan", { storage_path: mine.id });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Letters");
    w.drive.userRename(w.drive.idOf("Paperwork/Letters"), "Post");
    await w.runUntilQuiet();
    assert.equal(w.pl.state.storagePaths.get(clerks.id).path, "Paperwork/Post/{{ created }} {{ title }}", "the Clerk's own Letters path follows the rename");
    assert.equal(w.pl.state.storagePaths.get(clerks.id).name, "Post");
  } finally { await w.close(); }
});

test("REVIEW 8: storage paths the person makes with odd names stay inside the documents folder", async () => {
  for (const name of ["Health/Dentist", "..", "../../Holiday photos", "Paperwork", "  Pets  "]) {
    const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
    try {
      await w.runUntilQuiet();
      const mine = w.pl.addStoragePath({ name, path: "x/{{ title }}" });
      set(w, "blurry-scan", { storage_path: mine.id });
      await w.runUntilQuiet();
      const made = w.drive.writes.filter((x) => x.op === "create-folder").map((x) => w.drive.pathOf(x.id));
      console.log(`REVIEW 8 "${name}": ${w.pathOf("blurry-scan")} made ${JSON.stringify(made)}`);
      assert.ok(String(w.pathOf("blurry-scan")).startsWith("Paperwork/"), name);
      assert.ok(made.every((p) => p.startsWith("Paperwork/")), name);
    } finally { await w.close(); }
  }
});

// ---------------------------------------------------------------------------------------------
// 9. A folder whose year cannot be known: the paper never silently disappears.
test("REVIEW 9: picking a year folder (Taxes) for a paper whose year is not known keeps it visible: filed, or still on the To sort page", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    set(w, "blurry-scan", { storage_path: spNamed(w, "Taxes").id });
    await w.runUntilQuiet();
    const id = w.ids["blurry-scan"];
    console.log(`REVIEW 9: ${w.pathOf("blurry-scan")}, tags ${w.tagNames(w.doc("blurry-scan"))}, on the page: ${w.pl.viewDocs(view(w).id).includes(id)}`);
    addPaper(w, "optician", 82, letter("Corrin and Hale Opticians", "CH-2291", "Your new glasses are ready. Please call us to arrange a time to collect them."));
    await w.runUntilQuiet();
    const m = w.messages.at(-1);
    const listed = w.pl.viewDocs(view(w).id);
    console.log(`REVIEW 9: last message "${m}", the page lists ${JSON.stringify(listed)}`);
    assert.ok(folderOf(w, "blurry-scan").startsWith("Paperwork/Taxes/") || listed.includes(id), "neither filed nor on the To sort page");
    const n = Number((m.match(/(\d+) papers? (is|are) waiting/) || [])[1]);
    assert.equal(n, listed.length, "the count in the message is what the page lists");
  } finally { await w.close(); }
});

// 10. A file the person moved by hand, then a pick.
test("REVIEW 10: a pick for a paper whose file the person moved by hand takes Check this off (the person decided)", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    w.drive.userMove(w.fileOf("blurry-scan")[0].id, "Paperwork/Letters");
    await w.runUntilQuiet();
    set(w, "blurry-scan", { storage_path: spNamed(w, "Insurance").id });
    await w.runUntilQuiet();
    const item = w.nb.rows("collection_items").find((i) => i.source_id === w.record("blurry-scan").sum);
    console.log(`REVIEW 10: ${w.pathOf("blurry-scan")}, tags ${w.tagNames(w.doc("blurry-scan"))}, item status ${item?.data.status}, to_check ${readJson(w.paths.state).last_run.to_check}`);
    assert.ok(!w.tagNames(w.doc("blurry-scan")).includes("Check this"));
  } finally { await w.close(); }
});

// ---------------------------------------------------------------------------------------------
// 11. "Paperless sorts" and "nobody sorts" with the yes and with no: nothing of a document is written.
test("REVIEW 11: F4 over the whole kit, with the yes and with no: documents, tags, senders and types unchanged; only storage paths and the view written", async () => {
  for (const sorting of ["paperless", "nobody"]) for (const sp of ["yes", "no"]) {
    const w = await kitWorld({ sorting, settings: { storage_paths: sp } });
    try {
      const before = w.pl.snapshot();
      await w.runUntilQuiet();
      // A pick on the page, too.
      if (sp === "yes") {
        set(w, "blurry-scan", { storage_path: spNamed(w, "Letters").id });
        const snap = w.pl.snapshot();
        await w.runUntilQuiet();
        assert.equal(w.pl.snapshot(), snap, `${sorting}/${sp}: after a pick`);
        console.log(`REVIEW 11 ${sorting}/${sp}: blurry now ${w.pathOf("blurry-scan")}; AI asked who sent it: ${w.prompts.some((p) => p.system.startsWith("You read who sent"))}`);
      } else assert.equal(w.pl.snapshot(), before, `${sorting}/${sp}`);
      const other = w.pl.writes.filter((x) => !/^\/api\/(storage_paths|saved_views)\//.test(x.path));
      assert.deepEqual(other, [], `${sorting}/${sp}`);
      if (sp === "no") assert.equal(w.pl.writes.length, 0, `${sorting}/no: nothing at all`);
      console.log(`REVIEW 11 ${sorting}/${sp}: writes ${JSON.stringify(w.pl.writes.map((x) => `${x.method} ${x.path}`))}`);
    } finally { await w.close(); }
  }
});

// ---------------------------------------------------------------------------------------------
// 12. Renames and deletions.
function envFor(w) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-rev-"));
  fs.writeFileSync(path.join(d, "AGENTS.md"), "A made-up Godspeed folder.\n");
  const file = path.join(d, "answers.json");
  fs.copyFileSync(path.join(HERE, "kit", "answers.json"), file);
  return { ...w.env, GODSPEED_WORKSPACE: d, GODSPEED_MODEL_COMMAND: path.join(HERE, "fakes", "model.mjs"), GODSPEED_CLERK_FAKE_ANSWERS: file };
}

test("REVIEW 12: a sender folder renamed in the drive and To sort renamed with plan to-sort: paths, templates and the page follow; the link still lists the paper", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    const bw = spNamed(w, "Brightwater Utilities"), ts = spNamed(w, "To sort");
    w.drive.userRename(w.drive.idOf("Paperwork/Invoices/Brightwater Utilities"), "Brightwater Energy");
    const r = await cli(["plan", "to-sort", "Waiting room", "--state", w.paths.root], { env: envFor(w) });
    assert.equal(r.code, 0, r.err);
    await w.runUntilQuiet();
    assert.equal(w.pl.state.storagePaths.get(bw.id).name, "Brightwater Energy");
    assert.equal(w.pl.state.storagePaths.get(bw.id).path, "Paperwork/Invoices/Brightwater Energy/{{ created }} {{ title }}");
    assert.equal(w.pl.state.storagePaths.get(ts.id).name, "Waiting room");
    assert.equal(w.pl.state.storagePaths.get(ts.id).path, "Paperwork/Waiting room/{{ added }} {{ title }}");
    assert.equal(view(w).name, "Waiting room");
    assert.deepEqual(w.pl.viewDocs(view(w).id), [w.ids["blurry-scan"]]);
    assert.equal(folderOf(w, "utility-invoice"), "Paperwork/Invoices/Brightwater Energy");
    assert.equal(w.pl.state.storagePaths.size, 7, "nothing made twice"); // 6 places for this kit tree, and To sort
  } finally { await w.close(); }
});

test("REVIEW 13: a Clerk-made storage path deleted in Paperless is not made again, and its papers stay where they are", async () => {
  const w = await kitWorld({ only: ["council-letter", "blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    const lt = spNamed(w, "Letters");
    w.pl.state.storagePaths.delete(lt.id);
    for (const { doc } of w.pl.state.docs.values()) if (doc.storage_path === lt.id) doc.storage_path = null;
    const writes = w.pl.writes.length;
    const out = await w.runUntilQuiet();
    assert.ok(!spNamed(w, "Letters"));
    assert.equal(folderOf(w, "council-letter"), "Paperwork/Letters");
    assert.equal(out.at(-1).copied + out.at(-1).filed, 0);
    assert.deepEqual(w.pl.writes.slice(writes).map((x) => `${x.method} ${x.path}`), [], "nothing written");
    assert.equal(readJson(w.paths.state).last_run.failures, 0);
  } finally { await w.close(); }
});

// ---------------------------------------------------------------------------------------------
// 14. Picking a sender (not a storage path) whose folder does not exist yet, with the yes and with no.
const ASHGROVE_TREE = { Paperwork: { "Millbrook Garage": {}, Letters: {} }, "Holiday photos": {} };
test("REVIEW 14: picking a new sender for a waiting paper, plan by sender: a new sender folder (the AI says NEW), with the yes it gets its storage path", async () => {
  for (const sp of ["yes", "no"]) {
    const answers = [{ match: ["Pick the folder", "Ashgrove Vet Clinic"], answer: { folder: "NEW", confident: true } }, ...ANSWERS];
    const w = await kitWorld({ only: ["blurry-scan"], tree: ASHGROVE_TREE, rules: [{ folder: "{sender}" }], settings: { storage_paths: sp }, answers });
    try {
      await w.runUntilQuiet();
      assert.equal(folderOf(w, "blurry-scan"), "Paperwork/To sort");
      w.pl.state.correspondents.set(95, { id: 95, name: "Ashgrove Vet Clinic", matching_algorithm: 0, match: "", owner: 2 });
      set(w, "blurry-scan", { correspondent: 95 });
      await w.runUntilQuiet();
      assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Ashgrove Vet Clinic", sp);
      assert.ok(!w.tagNames(w.doc("blurry-scan")).includes("Check this"), sp);
      if (sp === "yes") assert.equal(w.pl.state.storagePaths.get(w.doc("blurry-scan").storage_path)?.name, "Ashgrove Vet Clinic");
      else assert.equal(w.pl.state.storagePaths.size, 0);
    } finally { await w.close(); }
  }
});

// 15. A crash right after the move of a pick.
test("REVIEW 15: killed right after a pick's move, the next run ends with one file in the picked folder, Check this off, one rule", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    set(w, "blurry-scan", { storage_path: spNamed(w, "Letters").id });
    const killed = (p) => { if (p === "after-file") { const e = new Error("killed"); e.name = "Killed"; throw e; } };
    await assert.rejects(w.run({ crash: killed }), /killed/);
    await w.runUntilQuiet();
    assert.equal(w.fileOf("blurry-scan").length, 1);
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Letters");
    assert.ok(!w.tagNames(w.doc("blurry-scan")).includes("Check this"));
    assert.equal(readJson(w.paths.plan).rules.filter((r) => r.sender).length, 1);
    assert.equal(w.doc("blurry-scan").storage_path, spNamed(w, "Letters").id);
  } finally { await w.close(); }
});

// 16. Privacy after picks (F14).
test("REVIEW 16: after picks and a person's own storage path, no record, log, mirror or plan file holds a title or a sentence of a letter", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "council-letter", "utility-invoice"], settings: yes });
  try {
    await w.runUntilQuiet();
    const mine = w.pl.addStoragePath({ name: "Dentist", path: "d/{{ title }}" });
    set(w, "blurry-scan", { storage_path: mine.id });
    set(w, "council-letter", { storage_path: spNamed(w, "Insurance").id });
    await w.runUntilQuiet();
    const titles = ["blurry-scan", "council-letter", "utility-invoice"].map((s) => w.doc(s).title);
    const sentences = ["blurry-scan", "council-letter", "utility-invoice"].flatMap((s) => w.doc(s).content.split(/(?<=[.!?])\s+/).filter((x) => x.length > 25));
    const files = [w.paths.log, w.paths.state, w.paths.mirror, w.paths.plan, w.paths.links, ...fs.readdirSync(w.paths.records).map((n) => path.join(w.paths.records, n))].filter(fs.existsSync);
    for (const f of files) {
      const b = fs.readFileSync(f, "utf8");
      for (const t of [...titles, ...sentences]) assert.ok(!b.includes(t), `${path.basename(f)} holds "${t}"`);
    }
  } finally { await w.close(); }
});

// ---------------------------------------------------------------------------------------------
// 17. When Godspeed sorts, the storage path follows the file however the paper got placed.
test("REVIEW 17: a waiting paper the person sorts by hand (type and date, Check this off) leaves the To sort page: its storage path follows its folder", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    const d = w.doc("blurry-scan");
    const letterType = [...w.pl.state.types.values()].find((t) => t.name === "Letter").id;
    set(w, "blurry-scan", { document_type: letterType, created: "2025-08-20", tags: d.tags.filter((t) => t !== tagId(w, "Check this")) });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Letters");
    assert.equal(w.pl.state.storagePaths.get(w.doc("blurry-scan").storage_path)?.name, "Letters", "the list and the drive agree");
    assert.deepEqual(w.pl.viewDocs(view(w).id), [], "off the To sort page");
  } finally { await w.close(); }
});

test("REVIEW 18: a filed paper the Clerk moves after the person changed its type carries its new folder's storage path", async () => {
  const w = await kitWorld({ only: ["council-letter"], settings: yes });
  try {
    await w.runUntilQuiet();
    assert.equal(w.pl.state.storagePaths.get(w.doc("council-letter").storage_path)?.name, "Letters");
    const ins = [...w.pl.state.types.values()].find((t) => t.name === "Insurance").id;
    set(w, "council-letter", { document_type: ins });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "council-letter"), "Paperwork/Insurance");
    assert.equal(w.pl.state.storagePaths.get(w.doc("council-letter").storage_path)?.name, "Insurance", "the list and the drive agree");
  } finally { await w.close(); }
});

// 19. F13: the first run after the yes over an archive already filed: bounded like any other work.
test("REVIEW 19: after the yes, the storage paths of papers filed before are set in batches (copy_batch), not all in one run", async () => {
  const w = await kitWorld({ settings: { copy_batch: 3 } });
  try {
    await w.runUntilQuiet({}, 30);
    const s = readJson(w.paths.settings);
    writeJson(w.paths.settings, { ...s, storage_paths: "yes" });
    const before = w.pl.writes.length;
    await w.run();
    const patches = w.pl.writes.slice(before).filter((x) => x.method === "PATCH" && /\/api\/documents\//.test(x.path)).length;
    console.log(`REVIEW 19: ${patches} document PATCHes in the first run after the yes (copy_batch 3)`);
    assert.ok(patches <= 3, `${patches} storage paths set in one run`);
  } finally { await w.close(); }
});

test("REVIEW 14b: with no, picking a new sender files the paper into its new folder", async () => {
  const answers = [{ match: ["Pick the folder", "Ashgrove Vet Clinic"], answer: { folder: "NEW", confident: true } }, ...ANSWERS];
  const w = await kitWorld({ only: ["blurry-scan"], tree: ASHGROVE_TREE, rules: [{ folder: "{sender}" }], settings: { storage_paths: "no" }, answers });
  try {
    await w.runUntilQuiet();
    w.pl.state.correspondents.set(95, { id: 95, name: "Ashgrove Vet Clinic", matching_algorithm: 0, match: "", owner: 2 });
    set(w, "blurry-scan", { correspondent: 95 });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Ashgrove Vet Clinic");
    assert.ok(!w.tagNames(w.doc("blurry-scan")).includes("Check this"));
    assert.equal(w.pl.state.storagePaths.size, 0);
  } finally { await w.close(); }
});

// 20. A learned sender rule does not move that sender's papers filed before, on an unrelated edit.
test("REVIEW 20: after a pick teaches a sender's folder, a title typed on an older, filed paper of that sender does not move it", async () => {
  const bw = letter("Brightwater Utilities", "BWX-88120", "A note about your account. Please keep this letter with your papers.");
  const answers = [{ match: ["BWX-88120"], answer: { title: "Account note", correspondent: "Brightwater Utilities", document_type: null, tags: [], created: null, folder: null, confident: false } }, ...ANSWERS];
  const w = await kitWorld({ only: ["utility-invoice"], settings: yes, answers });
  try {
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "utility-invoice"), "Paperwork/Invoices/Brightwater Utilities");
    addPaper(w, "bw-note", 91, bw);
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "bw-note"), "Paperwork/To sort");
    set(w, "bw-note", { storage_path: spNamed(w, "Bank").id });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "bw-note"), "Paperwork/Bank");
    set(w, "utility-invoice", { title: "Electricity February 2025 (paid)" });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "utility-invoice"), "Paperwork/Invoices/Brightwater Utilities", "a filed paper keeps its place; only its name changes");
  } finally { await w.close(); }
});

// 21. Paperless 3.3.3 rewrites "{old}" to "{{ old }}" in a template, even inside a raw block (seen on
// the real one). The Clerk must not then "level" that path again on every run.
test("REVIEW 21: a folder whose name holds {braces}: its storage path is not patched again on every run", async () => {
  const w = await kitWorld({ only: ["council-letter"], tree: { Paperwork: { "Bills {old}": {}, Letters: {} } }, rules: [{ type: "Invoice", folder: "Bills {old}" }, { type: "Letter", folder: "Letters" }], settings: yes });
  try {
    await w.runUntilQuiet();
    const sp = spNamed(w, "Bills {old}");
    assert.ok(sp, "made");
    const before = w.pl.writes.filter((x) => x.path === `/api/storage_paths/${sp.id}/`).length;
    for (let i = 0; i < 3; i++) {
      sp.path = sp.path.replace("{old}", "{{ old }}"); // what Paperless 3.3.3 stores after every POST or PATCH
      await w.run();
    }
    const after = w.pl.writes.filter((x) => x.path === `/api/storage_paths/${sp.id}/`).length;
    assert.equal(after - before, 0, `${after - before} PATCHes of the same storage path in three quiet runs`);
  } finally { await w.close(); }
});

// Minor findings of the review, the builder's tests for them.
test("M8: with Paperless or nobody sorting, a pick never sends the letter to the AI for a sender it could not set", async () => {
  for (const sorting of ["paperless", "nobody"]) {
    const w = await kitWorld({ sorting, only: ["blurry-scan"], settings: yes, answers: [{ match: ["Pick the folder"], answer: { folder: null, confident: false } }, ...ANSWERS] });
    try {
      const letterType = [...w.pl.state.types.values()].find((t) => t.name === "Contract").id;
      Object.assign(w.doc("blurry-scan"), { document_type: letterType, tags: [] });
      await w.runUntilQuiet();
      set(w, "blurry-scan", { storage_path: spNamed(w, "Letters").id });
      await w.runUntilQuiet();
      assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Letters", sorting);
      assert.ok(!w.prompts.some((p) => p.system.startsWith("You read who sent")), sorting);
    } finally { await w.close(); }
  }
});

test("M9: status counts the papers waiting on the To sort page, not filed letters whose deadline needs a date", async () => {
  const { statusReport } = await import("../lib/core/status.mjs");
  const w = await kitWorld({ only: ["blurry-scan", "meter-letter", "utility-invoice"], settings: yes });
  try {
    await w.runUntilQuiet();
    assert.ok(w.tagNames(w.doc("meter-letter")).includes("Check this"), "the letter without a date is to check");
    assert.match(statusReport(w.paths, { env: {}, home: w.paths.root }), /To sort in Paperless: 1 paper waiting/);
  } finally { await w.close(); }
});
