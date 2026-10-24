// What the independent review of batch 4 found in the restore copy, as tests (F9): a new server's
// copy never overwrites another installation's; a file changed in the drive is noticed and sent
// again; restore.json is written only when every file the manifest names is in the drive as the
// manifest says; a forced copy always exports anew; a copy that keeps failing is tried again and
// told; a dropped connection is tried again; the copy is labelled with the version that made it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { kitWorld } from "./kit-world.mjs";
import { copyStep, copyDue, findRestoreCopy } from "../lib/core/restore.mjs";
import { Drive } from "../lib/core/drive.mjs";
import { buildContext } from "../lib/core/context.mjs";
import { statePaths } from "../lib/core/paths.mjs";
import { readJson, writeJson } from "../lib/core/files.mjs";
import { startFakeDrive, TEST_CLIENT } from "./fakes/drive.mjs";

const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");

// A Paperless the Clerk installed, as the copy sees it: an export with a manifest that names each
// file and its checksum, the way Paperless's exporter writes it.
function fakeHost({ owners = { alex: 2 }, docs = 2, version = "3.3.3", label = version } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-pl-"));
  const exp = path.join(dir, "export");
  const host = {
    dir, rec: { version: label, image: `ghcr.io/paperless-ngx/paperless-ngx:${label}` }, exports: 0, docs,
    owners: () => owners,
    exportNow() {
      if (host.fail) throw host.fail;
      host.exports++;
      fs.mkdirSync(path.join(exp, "originals"), { recursive: true });
      fs.mkdirSync(path.join(exp, "archive"), { recursive: true });
      const manifest = [];
      for (let i = 1; i <= host.docs; i++) {
        const o = `originals/2026-10-22 Scan ${i}.pdf`, a = `archive/2026-10-22 Scan ${i}-archive.pdf`;
        const ob = Buffer.from(`%PDF-1.4 original ${i}`), ab = Buffer.from(`%PDF-1.4 archive ${i}`);
        if (!fs.existsSync(path.join(exp, o))) fs.writeFileSync(path.join(exp, o), ob);
        if (!fs.existsSync(path.join(exp, a))) fs.writeFileSync(path.join(exp, a), ab);
        manifest.push({ model: "documents.document", pk: i, fields: { title: `Scan ${i}`, checksum: md5(fs.readFileSync(path.join(exp, o))), archive_checksum: md5(fs.readFileSync(path.join(exp, a))) }, __exported_file_name__: o, __exported_archive_name__: a });
      }
      fs.writeFileSync(path.join(exp, "manifest.json"), JSON.stringify(manifest));
      fs.writeFileSync(path.join(exp, "metadata.json"), JSON.stringify({ version }));
    },
  };
  return host;
}
const restoreFiles = (d) => d.files().filter((f) => /^The Clerk\/paperless\/[^/]+\/restore\.json$/.test(d.pathOf(f.id)));

test("REVIEW 1: a second installation on the same drive never overwrites the first one's restore copy", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    const a = fakeHost({ docs: 3 });
    await copyStep(w.context(), { host: a, user: "alex", force: true });
    const before = new Map(w.drive.files().filter((f) => w.drive.pathOf(f.id).startsWith("The Clerk/paperless/")).map((f) => [f.id, f.md5Checksum]));
    // A new server, its own Clerk, the same drive: an empty Paperless, and its first copy.
    const paths = statePaths(fs.mkdtempSync(path.join(os.tmpdir(), "clerk-new-")));
    writeJson(paths.drive, readJson(w.paths.drive));
    writeJson(paths.settings, { active: true });
    const b = fakeHost({ docs: 0 });
    await copyStep(buildContext(paths, { env: w.env }), { host: b, user: "alex", force: true });
    for (const [id, sum] of before) assert.equal(w.drive.state.files.get(id).md5Checksum, sum, `${w.drive.pathOf(id)} is as the first server left it`);
    assert.equal(restoreFiles(w.drive).length, 2, "two copies, one per installation");
    const found = await findRestoreCopy(new Drive({ creds: readJson(w.paths.drive), env: w.env }));
    assert.equal(found.restore.documents, 3, "a rebuild is offered the copy that holds papers");
  } finally { await w.close(); }
});

test("REVIEW 1: a file of the restore copy changed in the drive is noticed by the next copy and sent again", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    const host = fakeHost();
    await copyStep(w.context(), { host, user: "alex", force: true });
    const f = w.drive.files().find((x) => /originals\/2026-10-22 Scan 1\.pdf$/.test(w.drive.pathOf(x.id)));
    Object.assign(f, { content: Buffer.from("something else"), md5Checksum: md5(Buffer.from("something else")), size: "14" });
    const w0 = w.drive.writes.length;
    await copyStep(w.context(), { host, user: "alex", force: true });
    assert.ok(w.drive.writes.slice(w0).some((x) => x.id === f.id), "sent again");
    assert.equal(w.drive.state.files.get(f.id).md5Checksum, md5(Buffer.from("%PDF-1.4 original 1")));
  } finally { await w.close(); }
});

test("REVIEW 4: restore.json is written only when every file the manifest names is in the drive with the manifest's checksum", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    const host = fakeHost();
    host.exportNow();
    // The exporter's own output does not match its manifest (a file changed on disk underneath).
    fs.writeFileSync(path.join(host.dir, "export", "originals", "2026-10-22 Scan 2.pdf"), "a different file");
    host.exportNow = () => { host.exports++; };
    await assert.rejects(copyStep(w.context(), { host, user: "alex", force: true }), /does not match its manifest/);
    assert.equal(restoreFiles(w.drive).length, 0, "no restore.json");
  } finally { await w.close(); }
});

test("REVIEW 7: a forced copy always exports anew, never finishes an old export", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    const host = fakeHost({ docs: 0 });
    host.exportNow();
    const st = readJson(w.paths.state, {});
    writeJson(w.paths.state, { ...st, copy: { phase: "upload", export_at: new Date().toISOString(), version: "3.3.3" } });
    host.docs = 2;
    await copyStep(w.context(), { host, user: "alex", force: true });
    assert.equal(host.exports, 2);
    assert.equal(JSON.parse(restoreFiles(w.drive)[0].content.toString()).documents, 2);
  } finally { await w.close(); }
});

test("REVIEW 8: a copy that keeps failing is tried again within the hour, and the person hears it once", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    const host = fakeHost();
    host.fail = Object.assign(new Error("ENOENT: no such file or directory, open '/opt/godspeed-clerk/paperless/export/manifest.json'"), { code: "ENOENT" });
    let t = Date.parse("2026-10-24T02:10:00");
    const ctx = () => w.context({ clock: () => t });
    await assert.rejects(copyStep(ctx(), { host, user: "alex" }));
    assert.equal(copyDue(readJson(w.paths.state), readJson(w.paths.settings), t + 30 * 60000), false, "not again at once");
    assert.equal(copyDue(readJson(w.paths.state), readJson(w.paths.settings), t + 61 * 60000), true, "again within the hour");
    for (let i = 0; i < 4; i++) { t += 61 * 60000; await assert.rejects(copyStep(ctx(), { host, user: "alex" })); }
    const outbox = fs.readFileSync(w.paths.outbox, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((n) => n.kind === "copy-failed");
    assert.equal(outbox.length, 1, "told once for the stretch");
    assert.match(outbox[0].why, /ENOENT|manifest/);
    host.fail = null;
    t += 61 * 60000;
    assert.equal((await copyStep(ctx(), { host, user: "alex" })).done, true, "and whole again once it can");
  } finally { await w.close(); }
});

test("the copy: the first one as soon as it can, then once a night in its hours, or when one was missed", () => {
  const at = (h, day = 24) => new Date(2026, 9, day, h, 30).getTime();
  const s = { copy_hour: 2 };
  assert.equal(copyDue({}, s, at(14)), true, "the first copy, now");
  const done = { copy: { day: "2026-10-23", last_ok_at: new Date(2026, 9, 23, 2, 40).toISOString(), phase: "done" } };
  assert.equal(copyDue(done, s, at(1)), false);
  assert.equal(copyDue(done, s, at(2)), true);
  assert.equal(copyDue(done, s, at(5)), true);
  assert.equal(copyDue(done, s, at(14)), false, "not in daytime");
  assert.equal(copyDue({ copy: { ...done.copy, last_ok_at: new Date(2026, 9, 22, 2, 40).toISOString() } }, s, at(14)), true, "missed a night: at once");
});

test("the copy is labelled with the version that made the export, not the one the Clerk believes runs", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    await copyStep(w.context(), { host: fakeHost({ version: "3.3.3", label: "3.2.1" }), user: "alex", force: true });
    assert.equal(JSON.parse(restoreFiles(w.drive)[0].content.toString()).paperless_version, "3.3.3");
  } finally { await w.close(); }
});

test("REVIEW 9: a connection Google dropped while the Clerk waited is tried again, for an upload too", async () => {
  const fake = await startFakeDrive({ tree: { Paperwork: {} } });
  try {
    let dropped = 0;
    const fetchImpl = async (url, opts) => {
      if (opts?.method === "POST" && /upload/.test(String(url)) && dropped === 0) { dropped++; throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) }); }
      return fetch(url, opts);
    };
    const drive = new Drive({ creds: { client_id: TEST_CLIENT.id, client_secret: TEST_CLIENT.secret, refresh_token: fake.issue() }, env: fake.env, fetchImpl });
    const f = await drive.upload({ name: "x.json", parentId: fake.idOf("Paperwork"), bytes: Buffer.from("{}"), contentType: "application/json", appProperties: { clerkCopy: "1" } });
    assert.equal(dropped, 1);
    assert.equal(fake.pathOf(f.id), "Paperwork/x.json");
  } finally { await fake.close(); }
});
