// F9: the restore copy in the Clerk's own folder of the drive, and what a rebuild takes back. With a
// pretend Paperless export; the fresh machines (test/machine) do it with real Paperless.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { kitWorld, text, KIT } from "./kit-world.mjs";
import { copyStep, copyDue, takeRecordsBack, recordsBundle, findRestoreCopy } from "../lib/core/restore.mjs";
import { Drive } from "../lib/core/drive.mjs";
import { readJson, writeJson } from "../lib/core/files.mjs";
import { statePaths } from "../lib/core/paths.mjs";
import { rebuild } from "../lib/install/rebuild.mjs";

const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");

// A Paperless the Clerk installed, as far as the copy sees it: its export folder and its owners.
function fakeHost({ owners = { alex: 2 }, docs = 2 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-pl-"));
  const exp = path.join(dir, "export");
  const host = {
    dir, rec: { version: "3.3.3", image: "ghcr.io/paperless-ngx/paperless-ngx:3.3.3@sha256:x" }, exports: 0,
    owners: () => owners,
    exportNow() {
      host.exports++;
      fs.mkdirSync(path.join(exp, "originals"), { recursive: true });
      fs.mkdirSync(path.join(exp, "archive"), { recursive: true });
      for (let i = 1; i <= docs; i++) {
        const f = path.join(exp, "originals", `2026-10-22 Scan ${i}.pdf`);
        if (!fs.existsSync(f)) fs.writeFileSync(f, `%PDF-1.4 original ${i}`);
        const a = path.join(exp, "archive", `2026-10-22 Scan ${i}-archive.pdf`);
        if (!fs.existsSync(a)) fs.writeFileSync(a, `%PDF-1.4 archive ${i}`);
      }
      fs.writeFileSync(path.join(exp, "manifest.json"), JSON.stringify(Array.from({ length: docs }, (_, i) => ({ model: "documents.document", pk: i + 1, fields: { title: `Scan ${i + 1}` } }))));
      fs.writeFileSync(path.join(exp, "metadata.json"), JSON.stringify({ version: "3.3.3" }));
    },
  };
  return host;
}
const ownFiles = (w) => w.drive.files().filter((f) => w.drive.pathOf(f.id).startsWith("The Clerk/") && f.mimeType !== "application/vnd.google-apps.folder");
const writesIn = (w, from) => w.drive.writes.slice(from).map((x) => w.drive.pathOf(x.id));

test("F9: on a Paperless the Clerk installed, its export and the Clerk's records go to the Clerk's own folder, restore.json last", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "council-letter"] });
  try {
    await w.runUntilQuiet();
    const host = fakeHost();
    const before = w.drive.writes.length;
    const r = await copyStep(w.context(), { host, user: "alex", force: true });
    assert.equal(r.done, true);
    const paths = ownFiles(w).map((f) => w.drive.pathOf(f.id)).sort();
    assert.deepEqual(paths, ["The Clerk/paperless/archive/2026-10-22 Scan 1-archive.pdf", "The Clerk/paperless/archive/2026-10-22 Scan 2-archive.pdf", "The Clerk/paperless/clerk-records.json", "The Clerk/paperless/manifest.json", "The Clerk/paperless/metadata.json", "The Clerk/paperless/originals/2026-10-22 Scan 1.pdf", "The Clerk/paperless/originals/2026-10-22 Scan 2.pdf", "The Clerk/paperless/restore.json", "The Clerk/records/clerk-records.json"]);
    const order = writesIn(w, before);
    assert.ok(order.every((p) => p.startsWith("The Clerk")), "nothing written outside the Clerk's own folder");
    assert.equal(order.at(-1), "The Clerk/paperless/restore.json", "restore.json last: the copy is whole only then");
    assert.ok(order.indexOf("The Clerk/paperless/manifest.json") > order.indexOf("The Clerk/paperless/originals/2026-10-22 Scan 2.pdf"));
    const restore = JSON.parse(w.drive.byPath("The Clerk/paperless/restore.json").content.toString());
    assert.equal(restore.paperless_version, "3.3.3");
    assert.equal(restore.documents, 2);
    assert.equal(restore.user, "alex");
    assert.equal(restore.manifest_md5, md5(fs.readFileSync(path.join(host.dir, "export", "manifest.json"))));
    const own = w.drive.byPath("The Clerk");
    assert.equal(own.appProperties.clerkOwn, "1");
    assert.ok(ownFiles(w).every((f) => f.appProperties.clerkCopy === "1"), "every file carries the Clerk's mark");
    // F14: the Clerk's records hold no text of a document.
    const bundle = w.drive.byPath("The Clerk/records/clerk-records.json").content.toString();
    // (Lines that are the person's own address are in their profile setting, `about`, not the paper's.)
    for (const line of text("utility-invoice").split("\n").filter((l) => l.trim().length > 12 && !KIT.profile.includes(l.trim()))) assert.ok(!bundle.includes(line.trim()), `no "${line.trim()}" in the records`);
    assert.equal(JSON.parse(bundle).records.length, 2);
  } finally { await w.close(); }
});

test("F9: the next night only what changed is uploaded", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    const host = fakeHost();
    await copyStep(w.context(), { host, user: "alex", force: true });
    const before = w.drive.writes.length;
    await copyStep(w.context(), { host, user: "alex", force: true });
    const again = writesIn(w, before);
    assert.ok(!again.some((p) => /originals|archive|manifest|metadata/.test(p)), `unchanged files are not sent again: ${again.join(", ")}`);
    fs.writeFileSync(path.join(host.dir, "export", "originals", "2026-10-22 Scan 2.pdf"), "%PDF-1.4 original 2, changed");
    const b2 = w.drive.writes.length;
    await copyStep(w.context(), { host, user: "alex", force: true });
    assert.deepEqual(writesIn(w, b2).filter((p) => /originals|archive/.test(p)), ["The Clerk/paperless/originals/2026-10-22 Scan 2.pdf"]);
    assert.equal(ownFiles(w).filter((f) => /Scan 2\.pdf$/.test(f.name)).length, 1, "the same file, its content replaced");
  } finally { await w.close(); }
});

test("F9: a Paperless where another account keeps documents is never exported; nothing of theirs reaches the drive; said once", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "second-account-letter"] });
  try {
    await w.runUntilQuiet();
    const host = fakeHost({ owners: { alex: 1, sam: 1 } });
    host.exportNow = () => { throw new Error("exported a shared Paperless"); };
    const r = await copyStep(w.context(), { host, user: "alex", force: true });
    assert.equal(r.shared, true);
    await copyStep(w.context(), { host, user: "alex", force: true });
    assert.equal(w.drive.byPath("The Clerk/paperless"), null, "no export folder");
    assert.ok(w.drive.byPath("The Clerk/records/clerk-records.json"), "the Clerk's own records still go");
    assert.equal(w.fileOf("second-account-letter").length, 0, "the other account's paper is not in the drive");
    await w.run();
    await w.run();
    const said = w.messages.filter((m) => /another account/.test(m));
    assert.equal(said.length, 1, JSON.stringify(w.messages));
    const own = fakeHost({ owners: { alex: 1 } }); // the other account's paper gone again
    const back = await copyStep(w.context(), { host: own, user: "alex", force: true });
    assert.equal(back.done, true, "every document the person's again: the export goes on");
  } finally { await w.close(); }
});

test("F9: pointed at a Paperless it did not install, the Clerk never runs the export: only its own records", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    await w.runUntilQuiet();
    const r = await copyStep(w.context(), { host: null, user: "alex", force: true });
    assert.equal(r.done, true);
    assert.equal(r.exported, false);
    assert.deepEqual(ownFiles(w).map((f) => w.drive.pathOf(f.id)), ["The Clerk/records/clerk-records.json"]);
  } finally { await w.close(); }
});

test("the copy is due once a night from copy_hour, and on every run while an upload goes on", () => {
  const at = (h, day = 23) => new Date(2026, 9, day, h, 30).getTime();
  assert.equal(copyDue({}, { copy_hour: 2 }, at(1)), false);
  assert.equal(copyDue({}, { copy_hour: 2 }, at(2)), true);
  assert.equal(copyDue({ copy: { day: "2026-10-23" } }, { copy_hour: 2 }, at(14)), false);
  assert.equal(copyDue({ copy: { day: "2026-10-23" } }, { copy_hour: 2 }, at(3, 24)), true);
  assert.equal(copyDue({ copy: { day: "2026-10-23", phase: "upload" } }, { copy_hour: 2 }, at(14)), true);
});

test("a first night with many files uploads a few minutes per run and is whole only at the end", async () => {
  const w = await kitWorld({ only: ["utility-invoice"], settings: { copy_minutes: 1 } });
  try {
    const host = fakeHost({ docs: 6 });
    let t = Date.parse("2026-10-23T02:30:00Z");
    const clock = () => { t += 15000; return t; }; // every look at the clock: 15 seconds later
    const r1 = await copyStep(w.context({ clock }), { host, user: "alex" });
    assert.equal(r1.done, false);
    assert.equal(w.drive.byPath("The Clerk/paperless/restore.json"), null, "not whole yet");
    assert.equal(readJson(w.paths.state).copy.phase, "upload");
    let n = 0;
    while (!readJson(w.paths.state).copy.last_ok_at && n++ < 10) await copyStep(w.context({ clock }), { host, user: "alex" });
    assert.ok(w.drive.byPath("The Clerk/paperless/restore.json"), "whole");
    assert.equal(host.exports, 1, "one export for the night");
    assert.equal(ownFiles(w).filter((f) => /\.pdf$/.test(f.name)).length, 12);
  } finally { await w.close(); }
});

test("F9: a rebuild takes the Clerk's records back and keeps this machine's own settings", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "council-letter"] });
  try {
    await w.runUntilQuiet();
    const bundle = recordsBundle(w.paths);
    const fresh = statePaths(fs.mkdtempSync(path.join(os.tmpdir(), "clerk-new-")));
    writeJson(fresh.settings, { workspace: "/root/new-godspeed", paperless_web: "https://srv2.example.test:48444" });
    const r = takeRecordsBack(fresh, JSON.parse(JSON.stringify(bundle)));
    assert.equal(r.records, 2);
    const s = readJson(fresh.settings);
    assert.equal(s.workspace, "/root/new-godspeed");
    assert.equal(s.paperless_web, "https://srv2.example.test:48444");
    assert.equal(s.sorting, readJson(w.paths.settings).sorting);
    assert.deepEqual(readJson(fresh.plan), readJson(w.paths.plan));
    assert.deepEqual(readJson(path.join(fresh.records, `${w.ids["council-letter"]}.json`)), w.record("council-letter"));
  } finally { await w.close(); }
});

test("F9: a rebuild goes only into an empty Paperless the Clerk installed; one that holds documents is left as it is", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    await copyStep(w.context(), { host: fakeHost(), user: "alex", force: true });
    assert.ok((await findRestoreCopy(new Drive({ creds: readJson(w.paths.drive), env: w.env }))).restore);
    const none = await rebuild(w.context(), {});
    assert.match(none.why, /has not installed a Paperless/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-pl-"));
    writeJson(w.paths.installed, { dir, project: "godspeed-clerk-paperless", port: 8010, version: "3.3.3", stage: "done", user: "alex" });
    const calls = [];
    const run = (cmd, args) => { calls.push([cmd, ...args].join(" ")); return { status: 0, stdout: "CLERK {\"alex\": 3}\n", stderr: "" }; };
    const r = await rebuild(w.context(), { run });
    assert.equal(r.ok, false);
    assert.match(r.why, /already holds 3 document/);
    assert.ok(!calls.some((c) => /down|rm -rf|importer/.test(c)), calls.join("\n"));
  } finally { await w.close(); }
});
