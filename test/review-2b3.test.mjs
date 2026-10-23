// Independent review of batch 2b, second round (df062b4): fresh made-up papers and senders.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kitWorld, ANSWERS, expected } from "./kit-world.mjs";
import { readJson, writeJson } from "../lib/core/files.mjs";
import { cli } from "./helpers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const yes = { storage_paths: "yes" };
const spNamed = (w, name) => [...w.pl.state.storagePaths.values()].find((s) => s.name === name);
const view = (w) => [...w.pl.state.savedViews.values()][0];
const folderOf = (w, slug) => String(w.pathOf(slug)).split("/").slice(0, -1).join("/");
const set = (w, slug, fields) => Object.assign(w.doc(slug), fields, { modified: new Date().toISOString() });
const links = (t) => t.match(/https?:\/\/\S+/g) || [];
const countIn = (m) => Number((String(m).match(/(\d+) papers? (?:is|are) waiting/) || [])[1] || 0);
let minute = 0;
function addPaper(w, slug, id, content) {
  const m = String(10 + (minute++ % 49)).padStart(2, "0");
  w.pl.addDoc({ id, content, title: `Scan 2026-10-22 21-${m}-00`, original_file_name: `Scan 2026-10-22 21-${m}-00.pdf`, tags: [1], owner: 2, created: "2026-10-22", added: `2026-10-22T21:${m}:00+02:00` });
  w.ids[slug] = id;
}
const letter = (sender, ref, body) => `${sender}\n7 Harbour Street, 40280 Fairford\n\nAlex Morgan\n12 Elm Row\n40210 Fairford\n\nFairford, 11 August 2025\n\n${body} Reference ${ref}.\nYours sincerely,\n${sender}`;
function envFor(w) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-rev3-"));
  fs.writeFileSync(path.join(d, "AGENTS.md"), "A made-up Godspeed folder.\n");
  const file = path.join(d, "answers.json");
  fs.copyFileSync(path.join(HERE, "kit", "answers.json"), file);
  return { ...w.env, GODSPEED_WORKSPACE: d, GODSPEED_MODEL_COMMAND: path.join(HERE, "fakes", "model.mjs"), GODSPEED_CLERK_FAKE_ANSWERS: file };
}

// Kestrel Labs exists in the kit's Paperless. The AI is unsure of these letters (no "unsure" list).
const kl = (ref) => letter("Kestrel Labs", ref, "Please find enclosed a note about your staff account. Keep it for your records.");
const KL = (ref) => ({ match: [ref], answer: { title: "Note about a staff account", correspondent: "Kestrel Labs", document_type: null, tags: [], created: null, folder: null, confident: false } });

test("ROUND2 1: after a pick taught a sender's folder, a new paper from that sender the AI is unsure of is filed there in the same run, without a message", async () => {
  const w = await kitWorld({ only: [], settings: yes, answers: [KL("KL-3301"), KL("KL-3302"), ...ANSWERS] });
  try {
    addPaper(w, "kl-1", 101, kl("KL-3301"));
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "kl-1"), "Paperwork/To sort");
    assert.equal(w.messages.length, 1);
    set(w, "kl-1", { storage_path: spNamed(w, "Bank").id });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "kl-1"), "Paperwork/Bank");
    assert.equal(readJson(w.paths.plan).rules[0].sender, "Kestrel Labs", "learned");
    addPaper(w, "kl-2", 102, kl("KL-3302"));
    const r = await w.run();
    console.log(`ROUND2 1: after the run that sorted it: ${w.pathOf("kl-2")}, messages ${JSON.stringify(w.messages.slice(1))}`);
    assert.equal(folderOf(w, "kl-2"), "Paperwork/Bank", "filed in the run that sorted it");
    assert.equal(w.messages.length, 1, "nothing to tell: its sender's folder is known");
    assert.ok(!w.pl.viewDocs(view(w).id).includes(102));
  } finally { await w.close(); }
});

test("ROUND2 2: storage paths the person changed while the answer was \"no\" (or not given) are not picks once they say yes", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "council-letter"], settings: { storage_paths: "no" } });
  try {
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "council-letter"), "Paperwork/Letters");
    const mine = w.pl.addStoragePath({ name: "Old house", path: "house/{{ title }}" });
    set(w, "utility-invoice", { storage_path: mine.id }); // their own Paperless habits, months before the yes
    set(w, "council-letter", { storage_path: mine.id });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "utility-invoice"), "Paperwork/Invoices/Brightwater Utilities", "not followed with no");
    const r = await cli(["plan", "mirror", "--storage-paths", "yes", "--state", w.paths.root], { env: envFor(w) });
    assert.equal(r.code, 0, r.err);
    await w.runUntilQuiet();
    console.log(`ROUND2 2: after the yes: ${w.pathOf("utility-invoice")} | ${w.pathOf("council-letter")} | learned ${JSON.stringify(readJson(w.paths.plan).rules.filter((x) => x.sender).map((x) => x.sender))}`);
    assert.equal(folderOf(w, "utility-invoice"), "Paperwork/Invoices/Brightwater Utilities", "a paper filed by the plan stays");
    assert.equal(folderOf(w, "council-letter"), "Paperwork/Letters");
    assert.ok(!readJson(w.paths.plan).rules.some((x) => x.sender), "nothing learned");
  } finally { await w.close(); }
});

test("ROUND2 3: with Paperless or nobody sorting and the yes, the To sort page never lists papers the Clerk filed into their folders", async () => {
  for (const sorting of ["paperless", "nobody"]) {
    const w = await kitWorld({ sorting, settings: yes });
    try {
      // Paperless's own rules (or the person) sorted every paper before the Clerk ran; one has a type the plan has no folder for.
      const byName = (m, n) => [...m.values()].find((x) => x.name === n);
      for (const s of Object.keys(w.ids).filter((x) => w.doc(x).owner === 2)) {
        const e = expected(s);
        let corr = byName(w.pl.state.correspondents, e.correspondent);
        if (!corr && e.correspondent) { corr = { id: 200 + w.pl.state.correspondents.size, name: e.correspondent, matching_algorithm: 0, match: "", owner: 2 }; w.pl.state.correspondents.set(corr.id, corr); }
        Object.assign(w.doc(s), { document_type: byName(w.pl.state.types, e.document_type)?.id ?? null, correspondent: corr?.id ?? null, created: e.created || w.doc(s).created, tags: (e.tags_include || []).map((t) => byName(w.pl.state.tags, t)?.id).filter(Boolean) });
      }
      Object.assign(w.doc("gym-letter"), { document_type: byName(w.pl.state.types, "Contract").id });
      await w.runUntilQuiet();
      // (In these settings the Clerk makes no To sort page, since only a write to documents could
      // make one exact; F4 forbids that. No page, no filed paper on it.)
      const listed = view(w) ? w.pl.viewDocs(view(w).id).filter((id) => w.pl.doc(id).owner === 2) : [];
      const filedListed = Object.keys(w.ids).filter((s) => listed.includes(w.ids[s]) && w.fileOf(s).length === 1 && folderOf(w, s) !== "Paperwork/To sort");
      console.log(`ROUND2 3 (${sorting}): messages ${JSON.stringify(w.messages.map(countIn))}; the page lists ${listed.length} of Alex's papers, ${filedListed.length} of them filed in their folders (${filedListed.slice(0, 4).join(", ")}, ...)`);
      assert.deepEqual(filedListed, [], `${sorting}: filed papers on the To sort page`);
      if (w.messages.length && view(w)) assert.equal(listed.length, countIn(w.messages.at(-1)), `${sorting}: the page lists what the message counts`);
      if (w.messages.length) assert.ok(!links(w.messages.at(-1)).some((l) => l.includes("/view/")), `${sorting}: the message never links to a page that is not exact`);
    } finally { await w.close(); }
  }
});

test("ROUND2 4: after the yes over an archive, a new paper the Clerk cannot place is on the To sort page in the run that told about it", async () => {
  const contractLetter = letter("Larkspur Lettings", "LL-5520", "Here is your tenancy agreement for the garage on Station Road, signed by both sides.");
  const answers = [{ match: ["LL-5520"], answer: { title: "Tenancy agreement for a garage", correspondent: "Larkspur Lettings", document_type: "Contract", tags: [], created: "2025-08-11", folder: null, confident: true, summary: "The tenancy agreement for the garage on Station Road. Both sides signed it.", key_facts: [] } }, ...ANSWERS];
  const w = await kitWorld({ settings: { copy_batch: 3 }, answers });
  try {
    await w.runUntilQuiet({}, 40);
    const told = w.messages.length;
    const s = readJson(w.paths.settings);
    writeJson(w.paths.settings, { ...s, storage_paths: "yes" });
    addPaper(w, "contract", 111, contractLetter);
    await w.run();
    await w.run();
    const listed = w.pl.viewDocs(view(w).id);
    console.log(`ROUND2 4: ${w.pathOf("contract")}, tags check: ${w.tagNames(w.doc("contract")).includes("Check this")}; new messages ${JSON.stringify(w.messages.slice(told))}; the page lists ${JSON.stringify(listed)}`);
    assert.equal(folderOf(w, "contract"), "Paperwork/To sort");
    assert.ok(w.messages.length > told, "told");
    assert.ok(listed.includes(111), "the message's page lists it");
    assert.equal(listed.length, countIn(w.messages.at(-1)), "and counts what the page lists");
  } finally { await w.close(); }
});

test("ROUND2 5: a storage path the person picks for a sorted paper while Google Drive is away is followed once the drive is back", async () => {
  const insurance = letter("Northgate Insurance", "NGI-90217", "Your home insurance renews on 1 October 2025. The yearly premium is 312.00 EUR.");
  const answers = [{ match: ["NGI-90217"], answer: { title: "Home insurance renewal 2025", correspondent: "Northgate Insurance", document_type: "Insurance", tags: ["Home"], created: "2025-08-11", folder: "Insurance", confident: true, summary: "Northgate Insurance renews the home insurance. The premium is 312.00 EUR a year.", key_facts: [] } }, ...ANSWERS];
  const w = await kitWorld({ only: ["utility-invoice"], settings: yes, answers });
  try {
    await w.runUntilQuiet();
    w.drive.revoke();
    addPaper(w, "home-ins", 121, insurance);
    await w.run(); // sorted while the drive is away
    assert.equal(w.typeName(w.doc("home-ins")), "Insurance");
    set(w, "home-ins", { storage_path: spNamed(w, "Letters").id }); // the person disagrees
    await w.run();
    writeJson(w.paths.drive, { ...readJson(w.paths.drive), refresh_token: w.drive.issue() });
    await w.runUntilQuiet();
    console.log(`ROUND2 5: ${w.pathOf("home-ins")}, storage path ${w.pl.state.storagePaths.get(w.doc("home-ins").storage_path)?.name}`);
    assert.equal(folderOf(w, "home-ins"), "Paperwork/Letters", "the person's pick is followed");
    assert.equal(w.pl.state.storagePaths.get(w.doc("home-ins").storage_path)?.name, "Letters", "and not overwritten");
  } finally { await w.close(); }
});

// M7 as fixed: a folder name longer than Paperless takes for a name (128) still gets its path, shortened.
test("ROUND2 6: a sender folder with a name over 128 characters gets a storage path whose name fits, and the others and the page are made", async () => {
  const long = "Northgate Insurance policy documents for the house at 12 Elm Row and the garage on Station Road kept together since 2019 and later";
  const w = await kitWorld({ only: ["blurry-scan"], tree: { Paperwork: { [long]: {}, Letters: {} } }, rules: [{ folder: "{sender}" }], settings: yes });
  try {
    await w.runUntilQuiet();
    const sps = [...w.pl.state.storagePaths.values()];
    assert.ok(sps.every((s) => s.name.length <= 128), JSON.stringify(sps.map((s) => s.name.length)));
    assert.ok(sps.some((s) => s.path.includes(long)), "the template keeps the whole folder name");
    assert.ok(spNamed(w, "Letters") && spNamed(w, "To sort") && view(w));
  } finally { await w.close(); }
});

test("a saved view named To sort that an earlier setting made is taken over and levelled, never a second one refused by Paperless", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    // Made by the Clerk under "Paperless sorts" before (storage path is none), its records since lost.
    const old = { id: 40, name: "To sort", sort_field: "added", sort_reverse: true, filter_rules: [{ rule_type: 25, value: null }], display_mode: "smallCards", owner: 2 };
    w.pl.state.savedViews.set(40, old);
    w.pl.state.next.view = 41;
    await w.runUntilQuiet();
    assert.equal(w.pl.state.savedViews.size, 1, "no second view");
    assert.deepEqual(w.pl.state.savedViews.get(40).filter_rules, [{ rule_type: 25, value: String(spNamed(w, "To sort").id) }]);
    assert.deepEqual(w.pl.viewDocs(40), [w.ids["blurry-scan"]]);
  } finally { await w.close(); }
});

test("a saved view of the person's own named To sort is never changed; the Clerk's page takes another name", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    const theirs = { id: 40, name: "To sort", sort_field: "title", sort_reverse: false, filter_rules: [{ rule_type: 6, value: "3" }, { rule_type: 0, value: "invoice" }], display_mode: "table", owner: 2 };
    w.pl.state.savedViews.set(40, { ...theirs });
    w.pl.state.next.view = 41;
    await w.runUntilQuiet();
    assert.deepEqual(w.pl.state.savedViews.get(40), theirs, "untouched");
    const mine = [...w.pl.state.savedViews.values()].find((v) => v.id !== 40);
    assert.ok(mine && mine.name !== "To sort", JSON.stringify(mine));
    assert.deepEqual(w.pl.viewDocs(mine.id), [w.ids["blurry-scan"]]);
    assert.ok(w.messages.at(-1).includes(`/view/${mine.id}`));
  } finally { await w.close(); }
});
