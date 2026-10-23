import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stateDir, statePaths } from "../lib/core/paths.mjs";
import { DEFAULTS, loadSettings, saveSettings, setSetting } from "../lib/core/settings.mjs";
import { writePrivate, readJson } from "../lib/core/files.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "clerk-settings-"));

test("the state folder: environment first, root on Linux, else the home folder", () => {
  assert.equal(stateDir({ env: { GODSPEED_CLERK_STATE: "/x/y" }, platform: "linux", root: true, home: "/h" }), path.resolve("/x/y"));
  assert.equal(stateDir({ env: {}, platform: "linux", root: true, home: "/h" }), "/var/lib/godspeed/clerk");
  assert.equal(stateDir({ env: {}, platform: "linux", root: false, home: "/h" }), path.join("/h", ".godspeed", "clerk"));
});

test("an empty folder gives the defaults: paused, Godspeed sorts, English names", () => {
  const p = statePaths(tmp());
  const s = loadSettings(p);
  assert.equal(s.active, false);
  assert.equal(s.sorting, "godspeed");
  assert.equal(s.tags.check, "Check this");
  assert.equal(s.tags.tax_prefix, "Tax");
  assert.equal(s.tags.not_in_notebook, "Not in notebook");
  assert.equal(s.tags.important, "Important");
  assert.equal(s.to_sort, "To sort");
  assert.equal(s.batch_size, 10);
  assert.deepEqual(DEFAULTS.approved_ai, []);
});

test("a setting is checked before it is kept", () => {
  const s = loadSettings(statePaths(tmp()));
  assert.throws(() => setSetting(s, "sorting", "sometimes"), /godspeed, paperless or nobody/);
  assert.throws(() => setSetting(s, "batch_size", "0"), /a whole number of 1 or more/);
  assert.throws(() => setSetting(s, "no_such_thing", "1"), /no setting/);
  assert.equal(setSetting(s, "sorting", "nobody").sorting, "nobody");
  assert.equal(setSetting(s, "batch_size", "2").batch_size, 2);
  assert.equal(setSetting(s, "tags.check", "Prüfen").tags.check, "Prüfen");
  assert.equal(setSetting(s, "active", "true").active, true);
});

test("saved settings come back, with defaults for what was never set", () => {
  const p = statePaths(tmp());
  saveSettings(p, { sorting: "paperless", tags: { check: "Look at me" } });
  const s = loadSettings(p);
  assert.equal(s.sorting, "paperless");
  assert.equal(s.tags.check, "Look at me");
  assert.equal(s.tags.tax_prefix, "Tax");
});

test("private files are written whole and readable by their owner only", { skip: process.platform === "win32" }, () => {
  const dir = path.join(tmp(), "deep", "er");
  const f = path.join(dir, "x.json");
  writePrivate(f, JSON.stringify({ a: 1 }));
  assert.deepEqual(readJson(f, null), { a: 1 });
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(readJson(path.join(dir, "missing.json"), "fallback"), "fallback");
});

test("settings: batch 2 defaults and the new settings", () => {
  const s = loadSettings(statePaths(tmp()));
  assert.equal(s.notebook, true);
  assert.equal(s.notebook_folder, "Documents");
  assert.equal(s.collection, "Documents");
  assert.equal(s.note_batch, 50);
  assert.equal(s.notebook_down_hours, 6);
  assert.equal(s.texts.kept_out_title, "Document kept out of the notebook");
  assert.equal(s.texts.yours, "Your notes");
  assert.equal(s.talk, null);
  const t = setSetting(s, "texts.kept_out_title", "Kept out");
  assert.equal(t.texts.kept_out_title, "Kept out");
  assert.equal(t.texts.yours, "Your notes");
  assert.deepEqual(setSetting(s, "talk", "[\"telegram\"]").talk, ["telegram"]);
  assert.throws(() => setSetting(s, "talk", "[\"pigeon\"]"), /telegram or desktop/);
  assert.throws(() => setSetting(s, "note_batch", "0"), /a whole number of 1 or more/);
  assert.equal(setSetting(s, "notebook", "false").notebook, false);
  assert.throws(() => setSetting(s, "texts.nonsense", "x"), /no setting/);
});

test("under node --test the default notebook door and real channels are never used", async () => {
  const { buildContext } = await import("../lib/core/context.mjs");
  const ctx = buildContext(statePaths(tmp()), { env: {} });
  assert.equal(ctx.notebook, null);
  assert.equal((await ctx.tell("a message")).delivered, false);
  const named = buildContext(statePaths(tmp()), { env: { GODSPEED_CLERK_NOTEBOOK: "http://127.0.0.1:9" } });
  assert.equal(named.notebook.base, "http://127.0.0.1:9");
});

test("settings: batch 3 texts, and the clock a test may set", async () => {
  const { loadSettings } = await import("../lib/core/settings.mjs");
  const { buildContext } = await import("../lib/core/context.mjs");
  const { statePaths } = await import("../lib/core/paths.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-settings-"));
  try {
    const s = loadSettings(statePaths(dir));
    assert.equal(s.texts.deadlines, "Deadlines");
    assert.equal(s.texts.deadline_title_check, "{ask} (check the date)");
    assert.equal(s.texts.deadline_title_kept, "{title}, {date}");
    assert.match(s.texts.message_deadline_check, /\{list\}/);
    assert.match(s.texts.message_nodate, /\{list\}/);
    // The clock: only in test mode, and only a real day.
    const day = (env) => { const t = buildContext(statePaths(dir), { env }).today; return t.toISOString().slice(0, 10); };
    assert.equal(day({ GODSPEED_CLERK_TEST: "1", GODSPEED_CLERK_TODAY: "2026-10-22" }), "2026-10-22");
    assert.equal(day({ GODSPEED_CLERK_TODAY: "2026-10-22" }), new Date().toISOString().slice(0, 10), "outside test mode the real day");
    assert.equal(day({ GODSPEED_CLERK_TEST: "1", GODSPEED_CLERK_TODAY: "2026-02-30" }), new Date().toISOString().slice(0, 10), "not a real day: the real day");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
