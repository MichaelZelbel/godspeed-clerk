// The commands, end to end against the pretend Paperless, Drive and AI: connecting writes
// nothing into Paperless (F1, the connect path), the folder plan is proposed and confirmed, runs
// never overlap, and the worker's service starts `godspeed-clerk worker`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "./helpers.mjs";
import { startFakePaperless } from "./fakes/paperless.mjs";
import { startFakeDrive, TEST_CLIENT } from "./fakes/drive.mjs";
import { kitWorld, KIT } from "./kit-world.mjs";
import { statePaths } from "../lib/core/paths.mjs";
import { loadSettings } from "../lib/core/settings.mjs";
import { readJson, writeJson } from "../lib/core/files.mjs";
import { acquire } from "../lib/core/lock.mjs";
import { systemdUnit, launchAgentPlist, windowsTaskXml } from "../lib/setup/service.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_MODEL = path.join(HERE, "fakes", "model.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "clerk-cmd-"));
const workspace = () => { const d = tmp(); fs.writeFileSync(path.join(d, "AGENTS.md"), "x"); return d; };

function modelEnv(extra = {}) {
  const d = tmp();
  const answers = path.join(d, "answers.json");
  fs.copyFileSync(path.join(HERE, "kit", "answers.json"), answers);
  return { GODSPEED_MODEL_COMMAND: FAKE_MODEL, GODSPEED_CLERK_FAKE_ANSWERS: answers, GODSPEED_CLERK_FAKE_PROMPTS: path.join(d, "prompts.jsonl"), ...extra };
}

test("F1: connecting to an existing Paperless writes nothing into it and shows what it found", async () => {
  const pl = await startFakePaperless({ tags: [{ id: 1, name: "Inbox", is_inbox_tag: true }], types: [{ id: 1, name: "Invoice" }], docs: [{ id: 1, tags: [1] }, { id: 2, tags: [] }, { id: 3, owner: 3 }] });
  try {
    const dir = tmp();
    const before = pl.snapshot();
    const r = await cli(["setup", "--paperless", pl.url, "--user", "alex", "--godspeed", workspace(), "--no-service", "--no-copy", "--state", dir], { env: { ...modelEnv(), PAPERLESS_PASSWORD: "pw" } });
    assert.equal(r.code, 0, r.err);
    assert.equal(pl.snapshot(), before);
    assert.deepEqual(pl.writes.map((w) => `${w.method} ${w.path}`), ["POST /api/token/"]);
    assert.match(r.out, /Paperless 3\.3\.3/);
    assert.match(r.out, /2 documents of yours/);
    assert.match(r.out, /1 waiting in the inbox/);
    assert.match(r.out, /test-provider/);
    const s = loadSettings(statePaths(dir));
    assert.equal(s.active, false);
    assert.deepEqual(s.approved_ai, ["test-provider"]);
    const conn = readJson(statePaths(dir).paperless);
    assert.equal(conn.token, "tok-alex");
    assert.equal(JSON.stringify(conn).includes("pw\""), false);
  } finally { await pl.close(); }
});

test("running setup again reuses the token it has and signs in to nothing", async () => {
  const pl = await startFakePaperless({ tags: [{ id: 1, name: "Inbox", is_inbox_tag: true }] });
  try {
    const dir = tmp();
    const args = ["setup", "--paperless", pl.url, "--user", "alex", "--godspeed", workspace(), "--no-service", "--no-copy", "--state", dir];
    assert.equal((await cli(args, { env: { ...modelEnv(), PAPERLESS_PASSWORD: "pw" } })).code, 0);
    assert.equal((await cli(args, { env: { ...modelEnv(), PAPERLESS_PASSWORD: "" } })).code, 0);
    assert.deepEqual(pl.writes.map((w) => w.path), ["/api/token/"]);
  } finally { await pl.close(); }
});

test("connect with a token makes no request that is not a read", async () => {
  const pl = await startFakePaperless({ tags: [{ id: 1, name: "Inbox", is_inbox_tag: true }] });
  try {
    const dir = tmp();
    const r = await cli(["connect", "--paperless", pl.url, "--user", "alex", "--token", "tok-alex", "--state", dir]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(pl.writes, []);
    const bad = await cli(["connect", "--paperless", pl.url, "--user", "alex", "--token", "wrong", "--state", tmp()]);
    assert.equal(bad.code, 1);
    assert.match(bad.err, /401/);
  } finally { await pl.close(); }
});

test("ai approve records what Godspeed's connection names, and status shows it", async () => {
  const dir = tmp();
  writeJson(statePaths(dir).settings, { workspace: workspace() });
  const r = await cli(["ai", "approve", "--state", dir], { env: modelEnv({ GODSPEED_CLERK_FAKE_BACKUP: "backup-provider" }) });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(loadSettings(statePaths(dir)).approved_ai, ["test-provider", "backup-provider"]);
  assert.match((await cli(["status", "--state", dir])).out, /test-provider, backup-provider/);
});

test("plan propose, then confirm: the plan in plain words, then To sort made", async () => {
  const pl = await startFakePaperless({ tags: [{ id: 1, name: "Inbox", is_inbox_tag: true }], types: KIT.paperless.types.map((name, i) => ({ id: i + 1, name })), correspondents: KIT.paperless.correspondents.map((name, i) => ({ id: i + 1, name })) });
  const drive = await startFakeDrive({ tree: KIT.drive.tree });
  try {
    const dir = tmp();
    const p = statePaths(dir);
    writeJson(p.paperless, { url: pl.url, user: "alex", token: "tok-alex" });
    writeJson(p.settings, { workspace: workspace(), approved_ai: ["test-provider"] });
    writeJson(p.drive, { client_id: TEST_CLIENT.id, client_secret: TEST_CLIENT.secret, refresh_token: drive.issue(), account: "alex@example.test", root: { id: drive.idOf("Paperwork"), name: "Paperwork" } });
    const env = { ...drive.env, ...modelEnv() };
    const prop = await cli(["plan", "propose", "--state", dir], { env });
    assert.equal(prop.code, 0, prop.err);
    assert.match(prop.out, /"Invoice" papers go to Invoices\/<sender>\./);
    assert.match(prop.out, /"Certificate" papers go to Taxes\/<year>\./);
    assert.match(prop.out, /stays in "To sort"/);
    assert.deepEqual(drive.writes, []);
    assert.equal(readJson(p.plan).status, "proposed");
    const run = await cli(["run", "--state", dir], { env });
    assert.match(run.out + run.err, /paused/i);
    const conf = await cli(["plan", "confirm", "--state", dir], { env });
    assert.equal(conf.code, 0, conf.err);
    assert.equal(readJson(p.plan).status, "confirmed");
    assert.deepEqual(drive.writes.map((w) => `${w.op} ${drive.pathOf(w.id)}`), ["create-folder Paperwork/To sort"]);
    assert.match(conf.out, /godspeed-clerk resume/);
  } finally { await pl.close(); await drive.close(); }
});

test("a second run while one holds the lock does nothing", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    const held = acquire(w.paths);
    assert.ok(held);
    const r = await cli(["run", "--state", w.paths.root], { env: w.drive.env });
    assert.equal(r.code, 0);
    assert.match(r.out, /another run is still going/);
    assert.deepEqual(w.pl.state.requests, []);
    held.release();
    assert.ok(acquire(w.paths));
  } finally { await w.close(); }
});

test("a lock left by a run that died is taken over", () => {
  const p = statePaths(tmp());
  fs.mkdirSync(p.root, { recursive: true });
  fs.writeFileSync(p.lock, JSON.stringify({ pid: 2147483646, at: new Date().toISOString() }));
  const l = acquire(p);
  assert.ok(l);
  l.release();
  assert.equal(fs.existsSync(p.lock), false);
});

test("the services start godspeed-clerk worker, as the right account", () => {
  const p = { node: "/usr/bin/node", script: "/usr/local/lib/godspeed-clerk/bin/godspeed-clerk.mjs", stateDir: "/var/lib/godspeed/clerk", version: "0.1.0", path: "/usr/local/bin:/usr/bin", home: "/root" };
  const unit = systemdUnit(p, { system: true });
  assert.match(unit, /ExecStart="\/usr\/bin\/node" "\/usr\/local\/lib\/godspeed-clerk\/bin\/godspeed-clerk\.mjs" "worker" "--state" "\/var\/lib\/godspeed\/clerk"/);
  assert.match(unit, /Restart=always/);
  assert.match(unit, /UMask=0077/);
  // systemd takes WorkingDirectory as a plain absolute path; a quoted one is a fatal unit error.
  assert.ok(unit.split("\n").includes("WorkingDirectory=/var/lib/godspeed/clerk"), unit);
  assert.ok(systemdUnit({ ...p, stateDir: "/srv/my docs/100%" }, { system: true }).split("\n").includes("WorkingDirectory=/srv/my\\x20docs/100%%"));
  assert.match(launchAgentPlist(p), /<string>worker<\/string>/);
  assert.match(windowsTaskXml({ ...p, user: "PC\\alex", conhost: "" }), /worker/);
});
