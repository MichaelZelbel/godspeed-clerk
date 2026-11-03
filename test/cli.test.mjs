import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cli } from "./helpers.mjs";
import { statePaths } from "../lib/core/paths.mjs";
import { loadSettings } from "../lib/core/settings.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "clerk-cli-"));

test("help lists the commands", async () => {
  const r = await cli(["help", "--state", tmp()]);
  assert.equal(r.code, 0);
  assert.match(r.out, /settings/);
});

test("settings: one value is set, checked and kept; a wrong one changes nothing", async () => {
  const dir = tmp();
  assert.equal((await cli(["settings", "sorting", "nobody", "--state", dir])).code, 0);
  assert.equal(loadSettings(statePaths(dir)).sorting, "nobody");
  const bad = await cli(["settings", "sorting", "sometimes", "--state", dir]);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /godspeed, paperless or nobody/);
  assert.equal(loadSettings(statePaths(dir)).sorting, "nobody");
  const shown = await cli(["settings", "--state", dir]);
  assert.match(shown.out, /"sorting": "nobody"/);
});

test("pause and resume switch the work off and on", async () => {
  const dir = tmp();
  await cli(["resume", "--state", dir]);
  assert.equal(loadSettings(statePaths(dir)).active, true);
  await cli(["pause", "--state", dir]);
  assert.equal(loadSettings(statePaths(dir)).active, false);
});

test("version, --version and the last line of help all say the installed version", async () => {
  const line = `godspeed-clerk ${JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version}`;
  for (const argv of [["version"], ["--version"]]) {
    const r = await cli([...argv, "--state", tmp()]);
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), line);
  }
  const h = await cli(["help", "--state", tmp()]);
  assert.equal(h.out.trim().split("\n").at(-1), line);
});
