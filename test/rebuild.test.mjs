// F9's rebuild, and what the independent review of batch 4 found in it: every file is checked
// against the export's own manifest before anything is wiped; a rebuild cut off after the import is
// finished by running it again; the login of the empty installation is not handed out afterwards;
// thumbnails are made again; a failed rebuild never says it was rebuilt. With a pretend Docker; the
// fresh machines rebuild real Paperless (test/machine).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { kitWorld } from "./kit-world.mjs";
import { copyStep } from "../lib/core/restore.mjs";
import { buildContext } from "../lib/core/context.mjs";
import { statePaths } from "../lib/core/paths.mjs";
import { readJson, writeJson } from "../lib/core/files.mjs";
import { rebuild } from "../lib/install/rebuild.mjs";

const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");

function exportOf(dir, docs) {
  const exp = path.join(dir, "export");
  fs.mkdirSync(path.join(exp, "originals"), { recursive: true });
  fs.mkdirSync(path.join(exp, "archive"), { recursive: true });
  const manifest = [{ model: "auth.user", pk: 2, fields: { username: "kim" } }];
  for (let i = 1; i <= docs; i++) {
    const o = `originals/2026-10-22 Scan ${i}.pdf`, a = `archive/2026-10-22 Scan ${i}-archive.pdf`;
    fs.writeFileSync(path.join(exp, o), `%PDF-1.4 original ${i}`);
    fs.writeFileSync(path.join(exp, a), `%PDF-1.4 archive ${i}`);
    manifest.push({ model: "documents.document", pk: i, fields: { title: `Paper ${i}`, checksum: md5(fs.readFileSync(path.join(exp, o))), archive_checksum: md5(fs.readFileSync(path.join(exp, a))) }, __exported_file_name__: o, __exported_archive_name__: a });
  }
  fs.writeFileSync(path.join(exp, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(exp, "metadata.json"), JSON.stringify({ version: "3.3.3" }));
}

// The old server made a whole copy of 3 papers; the new one (state `b`) has an empty Paperless.
async function world() {
  const w = await kitWorld({ only: ["utility-invoice"] });
  const old = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-old-"));
  const host = { dir: old, rec: { version: "3.3.3", host: "srv-a.example.test" }, owners: () => ({ kim: 3 }), exportNow: () => exportOf(old, 3) };
  await copyStep(w.context(), { host, user: "kim", force: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-new-"));
  const b = statePaths(path.join(dir, "state"));
  writeJson(b.drive, readJson(w.paths.drive));
  writeJson(b.settings, { workspace: "/root/godspeed", paperless_web: "https://srv-b.example.test:48444" });
  const pdir = path.join(dir, "paperless");
  fs.mkdirSync(pdir, { recursive: true });
  fs.writeFileSync(path.join(pdir, "compose.yaml"), "services:\n  webserver:\n    image: ghcr.io/paperless-ngx/paperless-ngx:3.3.3@sha256:x\n");
  writeJson(b.installed, { dir: pdir, project: "godspeed-clerk-paperless", port: 8010, version: "3.3.3", image: "ghcr.io/paperless-ngx/paperless-ngx:3.3.3@sha256:x", stage: "done", user: "me", host: "srv-b.example.test", https_port: 48444, address: "https://srv-b.example.test:48444" });
  writeJson(b.login, { user: "me", password: "aaaa-bbbb-cccc-dddd-eeee", secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", recovery: ["1"] });
  const pd = { docs: 0, calls: [], importFails: false };
  const run = (cmd, args, { input } = {}) => {
    const line = [cmd, ...args].join(" ");
    pd.calls.push(line.replace(pdir, "<dir>"));
    if (/manage\.py shell/.test(line)) {
      if (/owner__username/.test(line)) return { status: 0, stdout: `CLERK ${JSON.stringify(pd.docs ? { kim: pd.docs } : {})}\n` };
      if (/Token\.objects/.test(line)) return /^kim\n/.test(input || "") && pd.docs ? { status: 0, stdout: 'CLERK {"token":"tok-b","id":2}\n' } : { status: 1, stdout: "", stderr: "User matching query does not exist" };
    }
    if (/document_importer/.test(line)) { if (pd.importFails) return { status: 1, stdout: "", stderr: "the import broke" }; pd.docs = 3; }
    return { status: 0, stdout: "" };
  };
  const fetchImpl = async () => new Response("{}", { status: 401 });
  const ctx = () => buildContext(b, { env: w.env });
  return { w, b, pd, run, fetchImpl, ctx, pdir, close: () => w.close() };
}

test("REVIEW 4: a file of the copy that is not what the export's manifest says stops the rebuild before anything is wiped", async () => {
  const x = await world();
  try {
    const f = x.w.drive.files().find((y) => /originals\/2026-10-22 Scan 2\.pdf$/.test(x.w.drive.pathOf(y.id)));
    Object.assign(f, { content: Buffer.from("another letter"), md5Checksum: md5(Buffer.from("another letter")), size: "14" });
    const r = await rebuild(x.ctx(), { run: x.run, fetchImpl: x.fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.why, /1 paper\(s\) in the restore copy do not match what the export says/);
    assert.match(r.why, /Paper 2/);
    assert.ok(!x.pd.calls.some((c) => / down|rm -rf <dir>\/data|document_importer/.test(c)), x.pd.calls.join("\n"));
  } finally { await x.close(); }
});

test("F9: a rebuild brings the papers back, the Clerk's records, a fresh connection, and thumbnails", async () => {
  const x = await world();
  try {
    const r = await rebuild(x.ctx(), { run: x.run, fetchImpl: x.fetchImpl });
    assert.equal(r.ok, true, r.why);
    const i = x.pd.calls.findIndex((c) => /document_importer/.test(c)), t = x.pd.calls.findIndex((c) => /document_thumbnails/.test(c));
    assert.ok(i > 0 && t > i, "REVIEW 6: the thumbnails are made again after the import");
    const rec = readJson(x.b.installed);
    assert.equal(rec.user, "kim", "the account of the copy");
    assert.ok(rec.rebuilt_from && !rec.rebuild, "rebuilt, the journal cleared");
    assert.deepEqual(readJson(x.b.paperless), { ...readJson(x.b.paperless), user: "kim", token: "tok-b" });
    const login = readJson(x.b.login);
    assert.equal(login.user, "kim");
    assert.equal(login.password, undefined, "REVIEW 5: the empty installation's password is not handed out any more");
    assert.equal(login.secret, undefined);
    assert.ok(fs.existsSync(path.join(x.b.records, "1.json")) || readJson(x.b.settings).copy_id, "the Clerk's records are back");
    assert.equal(readJson(x.b.settings).copy_id, readJson(x.w.paths.settings).copy_id, "it goes on in the old server's copy folder");
  } finally { await x.close(); }
});

test("REVIEW 3: a rebuild cut off after the import is finished by running it again, nothing imported twice", async () => {
  const x = await world();
  try {
    x.pd.docs = 3; // the import ran to its end inside Paperless; the Clerk was cut off before its records
    const rec = readJson(x.b.installed);
    const found = readJson(x.w.paths.settings).copy_id;
    const restore = JSON.parse(x.w.drive.files().find((f) => x.w.drive.pathOf(f.id) === `The Clerk/paperless/${found}/restore.json`).content.toString());
    writeJson(x.b.installed, { ...rec, rebuild: { stage: "importing", copy_id: found, made_at: restore.made_at, documents: 3, user: "kim", version: "3.3.3" } });
    const r = await rebuild(x.ctx(), { run: x.run, fetchImpl: x.fetchImpl });
    assert.equal(r.ok, true, r.why);
    assert.ok(!x.pd.calls.some((c) => /document_importer| down/.test(c)), "no second import, nothing wiped");
    assert.equal(readJson(x.b.paperless).token, "tok-b");
    assert.equal(readJson(x.b.installed).rebuild, undefined);
  } finally { await x.close(); }
});

test("REVIEW 10: a rebuild that fails never says it was rebuilt; running it again finishes it", async () => {
  const x = await world();
  try {
    x.pd.importFails = true;
    const r = await rebuild(x.ctx(), { run: x.run, fetchImpl: x.fetchImpl });
    assert.equal(r.ok, false);
    const rec = readJson(x.b.installed);
    assert.equal(rec.rebuilt_from, undefined);
    assert.ok(rec.rebuild, "the journal says a rebuild is unfinished");
    x.pd.importFails = false;
    const again = await rebuild(x.ctx(), { run: x.run, fetchImpl: x.fetchImpl });
    assert.equal(again.ok, true, again.why);
    assert.ok(readJson(x.b.installed).rebuilt_from);
  } finally { await x.close(); }
});

test("REVIEW 1: confirming a plan on a new, empty Paperless while the drive holds a restore copy is stopped, with the way to rebuild", async () => {
  const { freshStartWarning } = await import("../lib/commands/plan.mjs");
  const found = { restore: { made_at: "2026-10-23T22:28:50.000Z", documents: 7 } };
  const rec = { stage: "done" };
  assert.match(freshStartWarning({ rec, plan: { status: "proposed" }, count: 0, found }), /restore copy.*7 papers.*godspeed-clerk restore.*--start-fresh/s);
  assert.equal(freshStartWarning({ rec, plan: { status: "proposed" }, count: 2, found }), null, "this Paperless has papers: not a new one");
  assert.equal(freshStartWarning({ rec: { ...rec, rebuilt_from: "x" }, plan: { status: "proposed" }, count: 0, found }), null, "rebuilt already");
  assert.equal(freshStartWarning({ rec, plan: { status: "confirmed" }, count: 0, found }), null, "a plan confirmed before");
  assert.equal(freshStartWarning({ rec: null, plan: { status: "proposed" }, count: 0, found }), null, "a Paperless the Clerk did not install");
  assert.equal(freshStartWarning({ rec, plan: { status: "proposed" }, count: 0, found: { restore: null } }), null, "no copy");
  assert.equal(freshStartWarning({ rec, plan: { status: "proposed" }, count: 0, found, startFresh: true }), null, "the person said so");
});
