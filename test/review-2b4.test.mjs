// Independent review of batch 2b, third round (dd754a9): fresh made-up papers and senders, what a
// person with a Paperless of their own does on its pages.
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
const sps = (w) => [...w.pl.state.storagePaths.values()];
const views = (w) => [...w.pl.state.savedViews.values()];
const folderOf = (w, slug) => String(w.pathOf(slug)).split("/").slice(0, -1).join("/");
const set = (w, slug, fields) => Object.assign(w.doc(slug), fields, { modified: new Date().toISOString() });
const links = (t) => t.match(/https?:\/\/\S+/g) || [];
let minute = 0;
function addPaper(w, slug, id, content) {
  const m = String(10 + (minute++ % 49)).padStart(2, "0");
  w.pl.addDoc({ id, content, title: `Scan 2026-10-23 08-${m}-00`, original_file_name: `Scan 2026-10-23 08-${m}-00.pdf`, tags: [1], owner: 2, created: "2026-10-22", added: `2026-10-22T22:${m}:00+02:00` });
  w.ids[slug] = id;
}
const letter = (sender, ref, body) => `${sender}\n2 Willow Court, 40290 Fairford\n\nAlex Morgan\n12 Elm Row\n40210 Fairford\n\nFairford, 19 July 2025\n\n${body} Reference ${ref}.\nBest wishes,\n${sender}`;
const unsureLetter = () => letter("Quayside Rowing Club", "QRC-4471", "Thank you for your interest. The winter training starts in November. Please let us know if you would like to join.");

// A person who already sorts in Paperless: a storage path "To sort" of their own for scans to look at.
test("ROUND3 1: a storage path named To sort of the person's own does not leave the Clerk without its To sort page", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    const theirs = w.pl.addStoragePath({ name: "To sort", path: "inbox/{{ title }}" });
    await w.runUntilQuiet();
    console.log(`ROUND3 1: storage paths ${JSON.stringify(sps(w).map((s) => s.name))}; views ${JSON.stringify(views(w).map((v) => v.name))}; message ${JSON.stringify(w.messages)}`);
    assert.deepEqual(w.pl.state.storagePaths.get(theirs.id), theirs, "theirs untouched");
    const clerks = sps(w).find((s) => s.id !== theirs.id && /To sort/.test(s.name));
    assert.ok(clerks, "the Clerk has a To sort path of its own, under a free name");
    assert.equal(w.doc("blurry-scan").storage_path, clerks.id, "the paper waiting carries it");
    assert.equal(views(w).length, 1, "and its page");
    assert.ok(links(w.messages.at(-1))[0].includes(`/view/${views(w)[0].id}`), "the message links to it");
  } finally { await w.close(); }
});

// The same person also has a saved view "To sort" of their own, on that storage path.
test("ROUND3 2: a saved view named To sort of the person's own, on a storage path of theirs, is never changed", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    const inbox = w.pl.addStoragePath({ name: "Scans to look at", path: "look/{{ title }}" });
    const theirs = { id: 40, name: "To sort", sort_field: "created", sort_reverse: false, filter_rules: [{ rule_type: 25, value: String(inbox.id) }], display_mode: "table", owner: 2 };
    w.pl.state.savedViews.set(40, structuredClone(theirs));
    w.pl.state.next.view = 41;
    await w.runUntilQuiet();
    console.log(`ROUND3 2: their view now ${JSON.stringify(w.pl.state.savedViews.get(40))}; all views ${JSON.stringify(views(w).map((v) => [v.id, v.name]))}`);
    assert.deepEqual(w.pl.state.savedViews.get(40), theirs, "F6: the person's own view is not changed");
  } finally { await w.close(); }
});

// The person removes the Clerk's page in Paperless (they do not want it in the sidebar).
test("ROUND3 3: after the person deleted the To sort page in Paperless, a message never links to it", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    const [v] = views(w);
    assert.ok(links(w.messages[0])[0].endsWith(`/view/${v.id}`));
    w.pl.state.savedViews.delete(v.id);
    addPaper(w, "rowing", 131, unsureLetter());
    await w.runUntilQuiet();
    console.log(`ROUND3 3: ${w.messages.at(-1)}`);
    assert.equal(w.messages.length, 2);
    assert.ok(!links(w.messages[1])[0].includes(`/view/${v.id}`), "not a link to a page that is gone");
  } finally { await w.close(); }
});

// Godspeed sorted with the page; then the person switches to "nobody sorts".
test("ROUND3 4: after switching from Godspeed sorting to nobody sorting, no Clerk page stays in the sidebar listing papers that are filed", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "council-letter"], settings: yes });
  try {
    await w.runUntilQuiet();
    const [v] = views(w);
    assert.deepEqual(w.pl.viewDocs(v.id), [w.ids["blurry-scan"]]);
    writeJson(w.paths.settings, { ...readJson(w.paths.settings), sorting: "nobody" });
    // The person sorts the waiting paper by hand: a type and a date.
    const letterType = [...w.pl.state.types.values()].find((t) => t.name === "Letter").id;
    set(w, "blurry-scan", { document_type: letterType, created: "2025-07-19" });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Letters");
    const still = views(w).filter((x) => w.pl.viewDocs(x.id).includes(w.ids["blurry-scan"]));
    console.log(`ROUND3 4: views ${JSON.stringify(views(w).map((x) => [x.id, x.name, w.pl.viewDocs(x.id)]))}; sidebar ${JSON.stringify(w.pl.visibleViews())}`);
    assert.deepEqual(still.map((x) => x.name), [], "a filed paper is on no To sort page");
  } finally { await w.close(); }
});

// The records lost (F18) right after a pick, before the next run.
test("ROUND3 5: a pick made just before the Clerk's records were lost is still followed", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    const letters = sps(w).find((s) => s.name === "Letters");
    set(w, "blurry-scan", { storage_path: letters.id });
    fs.rmSync(w.paths.records, { recursive: true, force: true });
    await w.runUntilQuiet();
    console.log(`ROUND3 5: ${w.pathOf("blurry-scan")}, storage path ${w.pl.state.storagePaths.get(w.doc("blurry-scan").storage_path)?.name}`);
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Letters");
  } finally { await w.close(); }
});

// The yes given with the settings command instead of plan mirror; storage paths of the person's from before.
test("ROUND3 6: the yes given through the settings command: papers with storage paths of the person's from before stay where the plan put them", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "council-letter"] });
  try {
    const mine = w.pl.addStoragePath({ name: "Paid bills", path: "paid/{{ title }}" });
    await w.runUntilQuiet();
    set(w, "utility-invoice", { storage_path: mine.id });
    await w.runUntilQuiet();
    const env = (() => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-rev4-")); fs.writeFileSync(path.join(d, "AGENTS.md"), "A made-up Godspeed folder.\n"); return { ...w.env, GODSPEED_WORKSPACE: d }; })();
    const r = await cli(["settings", "storage_paths", "yes", "--state", w.paths.root], { env });
    assert.equal(r.code, 0, r.err);
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "utility-invoice"), "Paperwork/Invoices/Brightwater Utilities");
    assert.ok(!readJson(w.paths.plan).rules.some((x) => x.sender));
  } finally { await w.close(); }
});
