// The second review round of batch 4: the status line of an installed Paperless, update messages
// only while true and once, a cut-off update that changed nothing is tried again, the plan guard
// with a few new scans, and the smaller findings.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { kitWorld } from "./kit-world.mjs";
import { readJson, writeJson } from "../lib/core/files.mjs";
import { statusReport } from "../lib/core/status.mjs";
import { recoverUpdate } from "../lib/install/keep.mjs";
import { Host } from "../lib/install/host.mjs";
import { freshStartWarning } from "../lib/commands/plan.mjs";
import crypto from "node:crypto";
import { cli, installedVersion } from "./helpers.mjs";
import { copyStep } from "../lib/core/restore.mjs";

test("REVIEW C: status of an installed Paperless says it runs, never that it is being installed", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    writeJson(w.paths.installed, { stage: "done", version: "3.3.3", address: "https://srv1.example.test:48444" });
    const s = statusReport(w.paths);
    assert.match(s, /Installed by the Clerk: Paperless 3\.3\.3/);
    assert.ok(!/being installed/.test(s), s);
    writeJson(w.paths.installed, { stage: "account", version: "3.3.3" });
    assert.match(statusReport(w.paths), /being installed \(stopped at: account\)/);
  } finally { await w.close(); }
});

test("REVIEW D: a failed update is told once, and only while Paperless still runs the old version", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    await w.runUntilQuiet();
    writeJson(w.paths.installed, { stage: "done", version: "3.2.1" });
    const c = w.context();
    for (let i = 0; i < 3; i++) c.outbox({ kind: "update-failed", to: "3.3.3", from: "3.2.1", rolled_back: true });
    await w.run();
    const said = w.messages.filter((m) => /could not be updated/.test(m));
    assert.equal(said.length, 1);
    assert.equal((said[0].match(/could not be updated/g) || []).length, 1, "one line, not three");
    // Later the update worked; an old notice about it is no longer true.
    writeJson(w.paths.installed, { stage: "done", version: "3.3.3" });
    w.context().outbox({ kind: "update-failed", to: "3.3.3", from: "3.2.1", rolled_back: true, attempt: "again" });
    const n = w.messages.length;
    await w.run();
    assert.equal(w.messages.length, n, "not said: 3.3.3 runs");
  } finally { await w.close(); }
});

test("a cut-off update that changed nothing is neither remembered as failed nor told, so the night tries it again", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-r2-"));
  const paths = { installed: path.join(dir, "installed.json"), state: path.join(dir, "state.json"), paperless: path.join(dir, "paperless.json") };
  fs.writeFileSync(path.join(dir, "compose.yaml"), "    image: ghcr.io/paperless-ngx/paperless-ngx:3.2.1@sha256:old\n");
  const rec = { dir, project: "p", port: 8010, version: "3.2.1", stage: "done", update: { to: "3.3.3", from: "3.2.1", image_from: "ghcr.io/paperless-ngx/paperless-ngx:3.2.1@sha256:old", image_to: "x", backup: path.join(dir, "none"), docs: 0, stage: "stopping" } };
  const out = [];
  const host = new Host(rec, { run: () => ({ status: 0, stdout: "" }), save: (r) => writeJson(paths.installed, r) });
  const r = await recoverUpdate({ paths, outbox: (n) => out.push(n), log: () => {} }, host);
  assert.equal(r.outcome, "old");
  assert.deepEqual(out, []);
  assert.equal(readJson(paths.state, {}).update, undefined);
});

test("REVIEW: the plan guard also stops a new Paperless that got a few scans before the plan, with what to do", () => {
  const found = { restore: { made_at: "2026-10-23T22:28:50.000Z", documents: 7 } };
  const w = freshStartWarning({ rec: { stage: "done" }, plan: { status: "proposed" }, count: 2, found });
  assert.match(w, /already holds 2 paper/);
  assert.match(w, /godspeed-clerk restore/);
  assert.match(w, /--start-fresh/);
});

// The smaller findings of round 2.
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
function exportingHost(docs = 3) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-r2pl-"));
  const exp = path.join(dir, "export");
  return {
    dir, rec: { version: "3.3.3", image: "ghcr.io/paperless-ngx/paperless-ngx:3.3.3", host: "srv1.example.test" },
    owners: () => ({ alex: docs }),
    exportNow() {
      fs.mkdirSync(path.join(exp, "originals"), { recursive: true });
      const manifest = [];
      for (let i = 1; i <= docs; i++) {
        const o = `originals/Scan ${i}.pdf`, b = Buffer.from(`%PDF-1.4 scan ${i}`);
        fs.writeFileSync(path.join(exp, o), b);
        manifest.push({ model: "documents.document", pk: i, fields: { title: `Scan ${i}`, checksum: sha256(b) }, __exported_file_name__: o });
      }
      fs.writeFileSync(path.join(exp, "manifest.json"), JSON.stringify(manifest));
      fs.writeFileSync(path.join(exp, "metadata.json"), JSON.stringify({ version: "3.3.3" }));
    },
  };
}

test("REVIEW: restore --check on the server that made the copy lists its own copy too, marked as its own", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    await copyStep(w.context(), { host: exportingHost(3), user: "alex", force: true });
    const r = await cli(["restore", "--check", "--state", w.paths.root], { env: w.env });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /3 documents, Paperless 3\.3\.3, from srv1\.example\.test \(this server's own copy\)/);
    assert.ok(!/drive holds no restore copy/.test(r.out), r.out);
  } finally { await w.close(); }
});

test("REVIEW: run again during a rebuild that was cut off, the install line points to the rebuild, not to the first steps", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    const st = w.paths.root;
    writeJson(w.paths.settings, { ...readJson(w.paths.settings), active: false });
    writeJson(w.paths.installed, { dir: os.tmpdir(), project: "x", port: 8010, version: "3.2.1", stage: "done", user: "alex", host: "srv1.example.test", https_port: 48444, address: "https://srv1.example.test:48444", rebuild: { made_at: "2026-10-23T22:28:50.000Z", stage: "wiped", copy_id: "a1" } });
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-ws-"));
    fs.writeFileSync(path.join(ws, "AGENTS.md"), "x");
    installedVersion(ws);
    const r = await cli(["setup", "--godspeed", ws, "--no-service", "--no-copy", "--state", st], { env: w.env });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /godspeed-clerk restore/);
    assert.ok(!/plan propose/.test(r.out), r.out);
    assert.ok(!/drive connect/.test(r.out), r.out);
  } finally { await w.close(); }
});

test("REVIEW: an export folder deleted on the server is made again, with Paperless started afresh to see it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-r2ex-"));
  fs.writeFileSync(path.join(dir, "compose.yaml"), "    image: ghcr.io/paperless-ngx/paperless-ngx:3.3.3@sha256:x\n");
  const calls = [];
  let sees = false; // the container sees the server's export folder only once it was started afresh
  const run = (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    if (args.includes("--force-recreate")) sees = true;
    if (args.includes("document_exporter") && sees) fs.writeFileSync(path.join(dir, "export", "manifest.json"), "[]");
    return { status: 0, stdout: "", stderr: "" };
  };
  const host = new Host({ dir, project: "p", port: 8010, version: "3.3.3" }, { run, fetchImpl: async () => new Response("{}", { status: 401 }), wait: async () => {} });
  await host.exportNow();
  assert.ok(fs.existsSync(path.join(dir, "export", "manifest.json")), "the export is there");
  assert.equal(calls.filter((c) => /--force-recreate/.test(c)).length, 1);
  // Deleted and made again by hand while Paperless ran: the container still writes into the old one.
  fs.rmSync(path.join(dir, "export"), { recursive: true });
  fs.mkdirSync(path.join(dir, "export"));
  sees = false;
  await host.exportNow();
  assert.ok(fs.existsSync(path.join(dir, "export", "manifest.json")));
  assert.equal(calls.filter((c) => /--force-recreate/.test(c)).length, 2, "noticed by the missing manifest, started afresh, exported again");
});

test("REVIEW: a failing restore copy is told in plain words, without the error's insides", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    await w.runUntilQuiet();
    const st = readJson(w.paths.state);
    st.copy = { phase: "failed", fails: 3, fail_since: "2026-10-24T02:10:00.000Z", last_error: "ENOENT: no such file or directory, open '/opt/godspeed-clerk/paperless/export/manifest.json'" };
    writeJson(w.paths.state, st);
    w.context().outbox({ kind: "copy-failed", at: "2026-10-24T04:10:00.000Z", why: st.copy.last_error });
    await w.run();
    const m = w.messages.at(-1);
    assert.match(m, /failed three times in a row/);
    assert.ok(!/ENOENT|\/opt\//.test(m), m);
  } finally { await w.close(); }
});
