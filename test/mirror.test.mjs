// F19: Paperless's storage path list mirrors the folder plan, and a "To sort" page lists exactly
// the papers waiting for the person. Made with the person's yes (F4), kept level every run.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "./helpers.mjs";
import { kitWorld, DOCS, expected } from "./kit-world.mjs";
import { readJson, writeJson } from "../lib/core/files.mjs";
import { loadSettings } from "../lib/core/settings.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ALEX = DOCS.filter((d) => d.owner === "alex").map((d) => d.slug);
const sps = (w) => [...w.pl.state.storagePaths.values()];
const spNamed = (w, name) => sps(w).find((s) => s.name === name);
const yes = { storage_paths: "yes" };

test("F19: after the plan is confirmed, one storage path per plan folder and a To sort page listing exactly the papers left in To sort", async () => {
  const w = await kitWorld({ settings: yes });
  try {
    await w.runUntilQuiet();
    assert.deepEqual(sps(w).map((s) => s.name).sort(), ["Bank", "Brightwater Utilities", "Hollis Roofing", "Insurance", "Letters", "Payslips", "Taxes", "To sort"]);
    assert.equal(spNamed(w, "Letters").path, "Paperwork/Letters/{{ created }} {{ title }}", "the template mirrors the drive folder and its file names");
    assert.equal(spNamed(w, "Brightwater Utilities").path, "Paperwork/Invoices/Brightwater Utilities/{{ created }} {{ title }}");
    assert.equal(spNamed(w, "Taxes").path, "Paperwork/Taxes/{{ created_year }}/{{ created }} {{ title }}");
    assert.equal(spNamed(w, "To sort").path, "Paperwork/To sort/{{ added }} {{ title }}");
    for (const s of sps(w)) assert.equal(s.matching_algorithm, s.name === "To sort" ? 0 : 6, `${s.name}: Auto, so Paperless learns; never Auto for To sort`);
    const [view] = [...w.pl.state.savedViews.values()];
    assert.equal(view.name, "To sort");
    assert.deepEqual(view.filter_rules, [{ rule_type: 25, value: String(spNamed(w, "To sort").id) }]);
    assert.equal(view.display_mode, "smallCards", "a picture of each paper's first page");
    assert.deepEqual(w.pl.visibleViews(), { sidebar: [view.id], dashboard: [view.id] });
    const waiting = ALEX.filter((s) => expected(s).folder === "To sort").map((s) => w.ids[s]).sort((a, b) => a - b);
    assert.deepEqual(w.pl.viewDocs(view.id), waiting, "exactly the papers left in To sort");
    // Every paper the Clerk filed carries the storage path of its folder.
    for (const slug of ALEX.filter((s) => expected(s).folder !== "To sort")) {
      const want = { "Invoices/Brightwater Utilities": "Brightwater Utilities", "Invoices/Hollis Roofing": "Hollis Roofing" }[expected(slug).folder] || expected(slug).folder.split("/")[0];
      assert.equal(w.pl.state.storagePaths.get(w.doc(slug).storage_path)?.name, want, slug);
    }
  } finally { await w.close(); }
});

test("without the person's yes nothing is made: no storage path, no view, no document's storage path", async () => {
  for (const settings of [{}, { storage_paths: "no" }]) {
    const w = await kitWorld({ only: ["utility-invoice", "blurry-scan"], settings });
    try {
      await w.runUntilQuiet();
      assert.equal(sps(w).length, 0);
      assert.equal(w.pl.state.savedViews.size, 0);
      assert.ok(Object.values(w.ids).every((id) => !w.pl.doc(id).storage_path));
    } finally { await w.close(); }
  }
});

test("kept level: a folder renamed in the drive renames its storage path; the person's own storage paths are never changed", async () => {
  const w = await kitWorld({ only: ["council-letter"], settings: yes });
  try {
    const mine = w.pl.addStoragePath({ name: "Archive 2019", path: "old/{{ title }}" });
    await w.runUntilQuiet();
    const letters = spNamed(w, "Letters");
    w.drive.userRename(w.drive.idOf("Paperwork/Letters"), "Post");
    await w.runUntilQuiet();
    assert.equal(w.pl.state.storagePaths.get(letters.id).name, "Post");
    assert.equal(w.pl.state.storagePaths.get(letters.id).path, "Paperwork/Post/{{ created }} {{ title }}");
    assert.deepEqual(w.pl.state.storagePaths.get(mine.id), mine, "untouched");
    const n = sps(w).length;
    await w.runUntilQuiet();
    assert.equal(sps(w).length, n, "nothing made twice");
  } finally { await w.close(); }
});

test("the Clerk's records of its storage paths lost: the ones with its own templates are found again, none made twice", async () => {
  const w = await kitWorld({ only: ["council-letter"], settings: yes });
  try {
    await w.runUntilQuiet();
    const n = sps(w).length, views = w.pl.state.savedViews.size;
    fs.rmSync(w.paths.mirror, { force: true });
    await w.runUntilQuiet();
    assert.equal(sps(w).length, n);
    assert.equal(w.pl.state.savedViews.size, views, "the view is found again by its name and its rule");
  } finally { await w.close(); }
});

// The command line, as setup and the assistant run it.
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "clerk-mirror-"));
function envFor(w) {
  const d = tmp();
  fs.writeFileSync(path.join(d, "AGENTS.md"), "A made-up Godspeed folder.\n");
  const file = path.join(d, "answers.json");
  fs.copyFileSync(path.join(HERE, "kit", "answers.json"), file);
  return { ...w.env, GODSPEED_WORKSPACE: d, GODSPEED_MODEL_COMMAND: path.join(HERE, "fakes", "model.mjs"), GODSPEED_CLERK_FAKE_ANSWERS: file };
}
const run = (w, args) => cli([...args, "--state", w.paths.root], { env: envFor(w) });
function unconfirm(w) { const p = readJson(w.paths.plan); writeJson(w.paths.plan, { ...p, status: "proposed" }); }

test("plan confirm: on a Paperless without storage paths of its own, the confirmation is the yes, and the page is there at once", async () => {
  const w = await kitWorld({ only: [] });
  try {
    unconfirm(w);
    const r = await run(w, ["plan", "confirm"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(loadSettings(w.paths).storage_paths, "yes");
    assert.ok(spNamed(w, "To sort") && spNamed(w, "Letters"));
    const [view] = [...w.pl.state.savedViews.values()];
    assert.ok(r.out.includes(`${w.pl.url}/view/${view.id}`), r.out);
  } finally { await w.close(); }
});

test("plan confirm: a Paperless with storage paths of its own is asked first, and its \"no\" leaves them alone", async () => {
  const w = await kitWorld({ only: [] });
  try {
    const mine = w.pl.addStoragePath({ name: "Archive 2019", path: "old/{{ title }}" });
    unconfirm(w);
    const r = await run(w, ["plan", "confirm"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(readJson(w.paths.plan).status, "confirmed", "the plan itself is confirmed");
    assert.equal(loadSettings(w.paths).storage_paths ?? null, null, "not decided for the person");
    assert.match(r.out, /--storage-paths yes/);
    assert.equal(sps(w).length, 1);
    const no = await run(w, ["plan", "mirror", "--storage-paths", "no"]);
    assert.equal(no.code, 0, no.err);
    assert.equal(loadSettings(w.paths).storage_paths, "no");
    assert.deepEqual(sps(w), [mine]);
    const ok = await run(w, ["plan", "mirror", "--storage-paths", "yes"]);
    assert.equal(ok.code, 0, ok.err);
    assert.ok(spNamed(w, "Letters"));
    assert.deepEqual(w.pl.state.storagePaths.get(mine.id), mine);
    // What it says counts the storage paths it made, not the page with them.
    const made = sps(w).length - 1;
    assert.ok(ok.out.includes(`Paperless: ${made} storage paths for your folders and "To sort" (${made} made now, 0 levelled). The "To sort" page: `), ok.out);
    assert.match(ok.out, /The "To sort" page: http\S+\/view\/\d+/);
  } finally { await w.close(); }
});
