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
