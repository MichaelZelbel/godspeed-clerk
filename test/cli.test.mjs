import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
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

const manifestVersion = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;

test("version and --version print exactly one line with the installed version", async () => {
  const line = `godspeed-clerk ${manifestVersion(new URL("..", import.meta.url).pathname)}`;
  for (const argv of [["version"], ["--version"]]) {
    const r = await cli([...argv, "--state", tmp()]);
    assert.equal(r.code, 0);
    assert.equal(r.out, line);
  }
});

test("help gains only the version line at its end", async () => {
  const line = `godspeed-clerk ${manifestVersion(new URL("..", import.meta.url).pathname)}`;
  const h = await cli(["help", "--state", tmp()]);
  assert.ok(h.out.endsWith(`\n\n${line}`));
  assert.doesNotMatch(h.out, /^ {2}version /m);
});

test("--version is still an ordinary value for a setting", async () => {
  const dir = tmp();
  const r = await cli(["settings", "tags.check", "--version", "--state", dir]);
  assert.equal(r.code, 0);
  assert.equal(loadSettings(statePaths(dir)).tags.check, "--version");
});

test("the version is read from the package.json next to the running code", () => {
  const root = new URL("..", import.meta.url).pathname;
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-copy-"));
  fs.cpSync(path.join(root, "lib"), path.join(copy, "lib"), { recursive: true });
  fs.cpSync(path.join(root, "bin"), path.join(copy, "bin"), { recursive: true });
  fs.writeFileSync(path.join(copy, "package.json"), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")), version: "9.8.7-test" }));
  for (const arg of ["version", "--version"]) {
    const r = spawnSync(process.execPath, [path.join(copy, "bin", "godspeed-clerk.mjs"), arg, "--state", tmp()], { encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "godspeed-clerk 9.8.7-test\n");
  }
});
