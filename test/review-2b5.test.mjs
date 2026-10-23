// Independent review of batch 2b, fourth round (f6eefde): fresh made-up papers and senders.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { kitWorld, ANSWERS } from "./kit-world.mjs";
import { readJson, writeJson } from "../lib/core/files.mjs";

const yes = { storage_paths: "yes" };
const sps = (w) => [...w.pl.state.storagePaths.values()];
const spNamed = (w, name) => sps(w).find((s) => s.name === name);
const views = (w) => [...w.pl.state.savedViews.values()];
const folderOf = (w, slug) => String(w.pathOf(slug)).split("/").slice(0, -1).join("/");
const set = (w, slug, fields) => Object.assign(w.doc(slug), fields, { modified: new Date().toISOString() });
const links = (t) => t.match(/https?:\/\/\S+/g) || [];
const countIn = (m) => Number((String(m).match(/(\d+) papers? (?:is|are) waiting/) || [])[1] || 0);
let minute = 0;
function addPaper(w, slug, id, content) {
  const m = String(10 + (minute++ % 49)).padStart(2, "0");
  w.pl.addDoc({ id, content, title: `Scan 2026-10-23 09-${m}-00`, original_file_name: `Scan 2026-10-23 09-${m}-00.pdf`, tags: [1], owner: 2, created: "2026-10-22", added: `2026-10-22T23:${m}:00+02:00` });
  w.ids[slug] = id;
}
const letter = (sender, ref, body) => `${sender}\n5 Ferry Lane, 40295 Fairford\n\nAlex Morgan\n12 Elm Row\n40210 Fairford\n\nFairford, 4 June 2025\n\n${body} Reference ${ref}.\nKind regards,\n${sender}`;

test("ROUND4 1: a filed paper picked into another folder just before the records were lost is moved there", async () => {
  const w = await kitWorld({ only: ["council-letter"], settings: yes });
  try {
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "council-letter"), "Paperwork/Letters");
    set(w, "council-letter", { storage_path: spNamed(w, "Insurance").id });
    fs.rmSync(w.paths.records, { recursive: true, force: true });
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "council-letter"), "Paperwork/Insurance");
    assert.equal(w.pl.state.storagePaths.get(w.doc("council-letter").storage_path)?.name, "Insurance");
    assert.equal(w.fileOf("council-letter").length, 1);
  } finally { await w.close(); }
});

test("ROUND4 2: the person takes the Clerk's page out of the sidebar; ordinary runs leave it out", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    const [v] = views(w);
    w.pl.state.ui.saved_views.sidebar_views_visible_ids = [];
    addPaper(w, "pottery", 141, letter("Millpond Pottery", "MP-2210", "Your class place is confirmed. Please bring an apron."));
    await w.runUntilQuiet();
    assert.deepEqual(w.pl.visibleViews().sidebar, [], "the person's choice stays");
    assert.ok(w.pl.visibleViews().dashboard.includes(v.id));
  } finally { await w.close(); }
});

test("ROUND4 3: the page deleted while nobody sorts is not made again when Godspeed sorts again; the message links to the Check this list", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    const [v] = views(w);
    writeJson(w.paths.settings, { ...readJson(w.paths.settings), sorting: "nobody" });
    await w.runUntilQuiet();
    w.pl.state.savedViews.delete(v.id);
    await w.runUntilQuiet();
    writeJson(w.paths.settings, { ...readJson(w.paths.settings), sorting: "godspeed" });
    addPaper(w, "pottery", 142, letter("Millpond Pottery", "MP-2211", "Your class place is confirmed. Please bring an apron."));
    await w.runUntilQuiet();
    assert.equal(views(w).length, 0, "not made again");
    const link = links(w.messages.at(-1))[0];
    assert.match(link, /\/documents\?tags__id__all=\d+$/, w.messages.at(-1));
  } finally { await w.close(); }
});

test("ROUND4 4: a To sort folder renamed while a path of the person's is called like the new name: the Clerk's path and page take a free name, theirs are untouched", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    const theirs = w.pl.addStoragePath({ name: "Inbox", path: "in/{{ title }}" });
    const plan = readJson(w.paths.plan);
    w.drive.userRename(plan.to_sort.id, "Inbox");
    writeJson(w.paths.plan, { ...plan, to_sort: { ...plan.to_sort, name: "Inbox" } });
    writeJson(w.paths.settings, { ...readJson(w.paths.settings), to_sort: "Inbox" });
    await w.runUntilQuiet();
    assert.deepEqual(w.pl.state.storagePaths.get(theirs.id), theirs);
    const clerks = sps(w).find((s) => s.id !== theirs.id && /^Inbox/.test(s.name));
    console.log(`ROUND4 4: paths ${JSON.stringify(sps(w).map((s) => s.name))}, views ${JSON.stringify(views(w).map((x) => x.name))}`);
    assert.ok(clerks, "the Clerk's To sort path follows the rename under a free name");
    assert.equal(clerks.path, "Paperwork/Inbox/{{ added }} {{ title }}");
    assert.deepEqual(w.pl.viewDocs(views(w)[0].id), [w.ids["blurry-scan"]]);
  } finally { await w.close(); }
});

test("ROUND4 5: over the whole kit with the yes, the count in every message is what the To sort page lists when it is sent", async () => {
  const counts = [];
  const w = await kitWorld({ settings: yes });
  try {
    await w.runUntilQuiet({ tell: async (text) => { counts.push([countIn(text), w.pl.viewDocs(views(w)[0]?.id ?? -1).length, text]); w.messages.push(text); return { delivered: true }; } });
    for (const [n, listed, text] of counts) if (n) assert.equal(listed, n, text);
    assert.ok(counts.length >= 1);
  } finally { await w.close(); }
});
