// Commands an existing installation needs for the person's language (F16): the To sort folder
// renamed by its id, a setting taken back to its default; and the run's "to check" count.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "./helpers.mjs";
import { kitWorld } from "./kit-world.mjs";
import { readJson } from "../lib/core/files.mjs";
import { loadSettings, DEFAULTS } from "../lib/core/settings.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "clerk-plan-"));
function envFor(w) {
  const d = tmp();
  fs.writeFileSync(path.join(d, "AGENTS.md"), "A made-up Godspeed folder.\n");
  const file = path.join(d, "answers.json");
  fs.copyFileSync(path.join(HERE, "kit", "answers.json"), file);
  return { ...w.env, GODSPEED_WORKSPACE: d, GODSPEED_MODEL_COMMAND: path.join(HERE, "fakes", "model.mjs"), GODSPEED_CLERK_FAKE_ANSWERS: file };
}
const run = (w, args, env) => cli([...args, "--state", w.paths.root], { env });

test("plan to-sort: the To sort folder is renamed by its id, its papers stay in it, the plan and the settings follow", async () => {
  const w = await kitWorld({ only: ["blurry-scan"] });
  try {
    await w.runUntilQuiet();
    const id = readJson(w.paths.plan).to_sort.id;
    const r = await run(w, ["plan", "to-sort", "Waiting room"], envFor(w));
    assert.equal(r.code, 0, r.err);
    assert.equal(w.drive.pathOf(id), "Paperwork/Waiting room");
    assert.match(w.pathOf("blurry-scan"), /^Paperwork\/Waiting room\//);
    assert.equal(readJson(w.paths.plan).to_sort.name, "Waiting room");
    assert.equal(loadSettings(w.paths).to_sort, "Waiting room");
    assert.deepEqual(w.drive.writes.filter((x) => x.op === "create-folder").map((x) => x.name), [], "no second folder");
    await w.runUntilQuiet();
    assert.match(w.pathOf("blurry-scan"), /^Paperwork\/Waiting room\//);
    const item = w.nb.rows("collection_items").find((i) => i.source_id === w.record("blurry-scan").sum);
    assert.equal(item.data.folder, "Waiting room");
    const taken = await run(w, ["plan", "to-sort", "Letters"], envFor(w));
    assert.notEqual(taken.code, 0);
    assert.match(taken.err, /already a folder "Letters"/);
  } finally { await w.close(); }
});

test("settings reset: a setting goes back to its default", async () => {
  const w = await kitWorld({ only: [], settings: { texts: { message_head: "Der Clerk:" } } });
  try {
    assert.equal(loadSettings(w.paths).texts.message_head, "Der Clerk:");
    const r = await run(w, ["settings", "reset", "texts"], envFor(w));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(loadSettings(w.paths).texts, DEFAULTS.texts);
    assert.equal((await run(w, ["settings", "reset", "nonsense"], envFor(w))).code, 1);
  } finally { await w.close(); }
});

test("the run's \"to check\" count counts papers still to check, not one the person resolved by hand", async () => {
  const w = await kitWorld({ only: ["blurry-scan"] });
  try {
    assert.equal((await w.runUntilQuiet()).at(-1).to_check, 1);
    const d = w.doc("blurry-scan");
    const letter = [...w.pl.state.types.values()].find((t) => t.name === "Letter").id;
    const check = [...w.pl.state.tags.values()].find((t) => t.name === "Check this").id;
    Object.assign(d, { document_type: letter, created: "2025-08-20", tags: d.tags.filter((t) => t !== check), modified: new Date().toISOString() });
    assert.equal((await w.runUntilQuiet()).at(-1).to_check, 0);
  } finally { await w.close(); }
});
