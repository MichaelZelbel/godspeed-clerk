// The third review round of batch 4 (verdict yes, these left to fix): a half-written archive file is
// noticed when a cut-off rebuild is finished; papers in Paperless's trash are named; with copies of
// two servers in the drive the one holding the newest paper is taken, and the person is asked when
// both copied in the same week; an export folder made again by hand; thumbnails; long imports; the
// old copy is mentioned after a rebuild.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { kitWorld } from "./kit-world.mjs";
import { copyStep, findRestoreCopy } from "../lib/core/restore.mjs";
import { buildContext } from "../lib/core/context.mjs";
import { statePaths } from "../lib/core/paths.mjs";
import { Drive } from "../lib/core/drive.mjs";
import { readJson, writeJson } from "../lib/core/files.mjs";
import { Host, badFiles } from "../lib/install/host.mjs";
import { freshStartWarning } from "../lib/commands/plan.mjs";
import { doneWords } from "../lib/commands/restore.mjs";

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

test("REVIEW 3.1: a paper whose archive file is not what its checksum says counts as without its files", () => {
  const ok = [1, "s1", "s1", true, "a1", "a1"];
  assert.deepEqual(badFiles([ok]), []);
  assert.deepEqual(badFiles([[2, "s2", "s2", true, "half", "a2"]]), [[2, "archive"]], "a half-written archive");
  assert.deepEqual(badFiles([[3, "s3", "s3", true, null, "a3"]]), [[3, "archive"]], "no archive at all");
  assert.deepEqual(badFiles([[4, null, "s4", false, null, null]]), [[4, "original"]]);
  assert.deepEqual(badFiles([[5, "x", "s5", false, null, null]]), [[5, "checksum"]]);
  assert.deepEqual(badFiles([[6, "s6", "s6", false, null, null]]), [], "a paper without an archive version");
});

test("REVIEW 3.2: the plan guard's advice names Paperless's trash, which a rebuild needs empty too", () => {
  const found = { restore: { made_at: "2026-10-23T22:28:50.000Z", documents: 7 } };
  const w = freshStartWarning({ rec: { stage: "done" }, plan: { status: "proposed" }, count: 1, found });
  assert.match(w, /empty (its|Paperless's) trash/);
});

// A server's export with papers added on the given days.
function exportWith(dir, added) {
  const exp = path.join(dir, "export");
  fs.mkdirSync(path.join(exp, "originals"), { recursive: true });
  const manifest = [];
  added.forEach((day, i) => {
    const o = `originals/${dir.slice(-6)} ${i + 1}.pdf`, b = Buffer.from(`%PDF-1.4 ${dir} ${i}`);
    fs.writeFileSync(path.join(exp, o), b);
    manifest.push({ model: "documents.document", pk: i + 1, fields: { title: `Paper ${i + 1}`, checksum: sha256(b), added: `${day}T10:00:00Z` }, __exported_file_name__: o });
  });
  fs.writeFileSync(path.join(exp, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(exp, "metadata.json"), JSON.stringify({ version: "3.3.3" }));
}
function server(w, name, added) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `clerk-${name}-`));
  const paths = statePaths(path.join(dir, "state"));
  writeJson(paths.drive, readJson(w.paths.drive));
  writeJson(paths.settings, { active: true });
  const host = { dir, rec: { version: "3.3.3", host: `${name}.example.test` }, owners: () => ({ kim: added.length }), exportNow: () => exportWith(dir, added) };
  return { paths, copy: () => copyStep(buildContext(paths, { env: w.env }), { host, user: "kim", force: true }), id: () => readJson(paths.settings).copy_id };
}

test("REVIEW 3.3: with copies of two servers in the drive, the one holding the newest paper is the one to rebuild from", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    const rebuilt = server(w, "srv-u", ["2026-10-01", "2026-10-24"]); // rebuilt, and a scan made there since
    const old = server(w, "srv-r", ["2026-10-01"]); // the old server, still copying
    await rebuilt.copy();
    await old.copy(); // copied last
    const found = await findRestoreCopy(new Drive({ creds: readJson(w.paths.drive), env: w.env }));
    assert.equal(found.id, rebuilt.id(), "the newest paper, not the newest copy");
    assert.equal(found.restore.newest_added.slice(0, 10), "2026-10-24");
  } finally { await w.close(); }
});

test("REVIEW 3.4: an export folder deleted and made again by hand, where Paperless's exporter itself fails, is made afresh", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-r3ex-"));
  fs.writeFileSync(path.join(dir, "compose.yaml"), "    image: ghcr.io/paperless-ngx/paperless-ngx:3.3.3@sha256:x\n");
  fs.mkdirSync(path.join(dir, "export"));
  const calls = [];
  let sees = false;
  const run = (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    if (args.includes("--force-recreate")) sees = true;
    if (args.includes("document_exporter")) {
      if (!sees) return { status: 1, stdout: "", stderr: "FileNotFoundError: [Errno 2] No such file or directory: '/usr/src/paperless/export/manifest.json'" };
      fs.writeFileSync(path.join(dir, "export", "manifest.json"), "[]");
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  const host = new Host({ dir, project: "p", port: 8010, version: "3.3.3" }, { run, fetchImpl: async () => new Response("{}", { status: 401 }), wait: async () => {} });
  await host.exportNow();
  assert.ok(fs.existsSync(path.join(dir, "export", "manifest.json")));
  assert.ok(calls.some((c) => /chown 1000:1000/.test(c)), "the folder is Paperless's again");
});

test("REVIEW 3: the import, the export, the index and the thumbnails may take hours on a big archive", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-r3t-"));
  fs.mkdirSync(path.join(dir, "export"));
  fs.writeFileSync(path.join(dir, "export", "manifest.json"), "[]");
  const limits = {};
  const run = (cmd, args, o = {}) => { for (const k of ["document_importer", "document_index", "document_thumbnails"]) if (args.includes(k)) limits[k] = o.timeoutMs; return { status: 0, stdout: "", stderr: "" }; };
  const host = new Host({ dir, project: "p", port: 8010, version: "3.3.3" }, { run });
  host.importNow(); host.reindex(); host.thumbnails();
  for (const k of ["document_importer", "document_index", "document_thumbnails"]) assert.ok(limits[k] >= 6 * 3600e3, `${k}: ${limits[k]}`);
});

test("REVIEW 3: after a rebuild the person hears that the old copy stays in the drive, and where", () => {
  const t = doneWords({ r: { documents: 7, version: "3.3.3", user: "kim", fromCopy: "c1651f7740a", fromHost: "srv-r.example.test" }, rec: { address: "https://srv-u.example.test:48444" } });
  assert.match(t, /The Clerk\/paperless\/c1651f7740a/);
  assert.match(t, /stays in your drive/);
  assert.ok(!/[\u2013\u2014]/.test(t));
});

test("the second factor's first code is never made in the last seconds of its 30, so it cannot expire on the way", async () => {
  let t = Date.parse("2026-10-24T04:58:59.500Z"); // half a second before the next 30 seconds begin
  const waits = [], sent = [];
  const fetchImpl = async (url, o) => {
    if (/profile\/totp/.test(url)) { const b = JSON.parse(o.body); sent.push({ ...b, at: t }); return new Response(JSON.stringify({ success: true, recovery_codes: ["1"] }), { status: 200 }); }
    return new Response(JSON.stringify({ is_mfa_enabled: false }), { status: 200 });
  };
  const host = new Host({ dir: os.tmpdir(), port: 8010 }, { fetchImpl, clock: () => t, wait: async (ms) => { waits.push(ms); t += ms; } });
  const r = await host.secondFactor("tok");
  assert.ok(waits[0] >= 500, `waited for the next 30 seconds (${waits})`);
  const { totp } = await import("../lib/install/totp.mjs");
  assert.equal(sent[0].code, totp(r.secret, { time: Date.parse("2026-10-24T04:59:00.000Z") + 1000 }), "the code of the new 30 seconds");
});
