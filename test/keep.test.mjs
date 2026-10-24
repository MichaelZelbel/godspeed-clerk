// F2: the phone's first scan is reported. F3: a stopped Paperless is running again on the next
// check; down for half an hour, a nearly full disk, a failed update, a shared Paperless: one
// message each, never twice. With pretend Docker and Paperless; the fresh machines do it for real.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { kitWorld, ANSWERS } from "./kit-world.mjs";
import { cli } from "./helpers.mjs";
import { readJson, writeJson } from "../lib/core/files.mjs";
import { hostStep } from "../lib/install/keep.mjs";

const PDF = "%PDF-1.4 a made-up scan";

test("F2: after the phone step, the first scan that arrives is reported as connected, once, with its link", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    writeJson(w.paths.installed, { dir: os.tmpdir(), project: "x", port: 8010, version: "3.3.3", stage: "done", user: "alex", host: "srv1.example.test", https_port: 48444, address: "https://srv1.example.test:48444" });
    writeJson(w.paths.login, { user: "alex", password: "abcd-efgh-jkmn-pqrs-tuvw", secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", recovery: ["11111111"], otpauth: "otpauth://totp/x", address: "https://srv1.example.test:48444" });
    const shown = await cli(["phone", "--state", w.paths.root]);
    assert.equal(shown.code, 0, shown.err);
    assert.match(shown.out, /Swift Paperless/);
    assert.match(shown.out, /https:\/\/srv1\.example\.test:48444/);
    assert.match(shown.out, /abcd-efgh-jkmn-pqrs-tuvw/);
    assert.match(shown.out, /GEZD GNBV GY3T QOJQ/);
    assert.match(shown.out, /recovery codes/);
    assert.ok(!/[\u2013\u2014]/.test(shown.out));
    await w.runUntilQuiet();
    assert.ok(!w.messages.some((m) => /phone is connected/.test(m)), "the paper from before the phone step does not count");
    w.setAnswers([{ match: ["77001"], answer: { title: "Electricity invoice October 2026", correspondent: "Brightwater Utilities", document_type: "Invoice", tags: ["Home"], created: "2026-10-20", folder: "Invoices/{sender}", confident: true, summary: "An electricity invoice. 12.00 EUR are due.", key_facts: [] } }, ...ANSWERS]);
    w.pl.addDoc({ id: 50, content: "Brightwater Utilities\nInvoice 77001\nAmount due 12.00 EUR", title: "Scan 2026-10-23 09-00-00", original_file_name: "Scan 2026-10-23 09-00-00.pdf", tags: [1], owner: 2, created: "2026-10-23", added: new Date(Date.now() + 1000).toISOString() });
    await w.run();
    await w.run();
    const said = w.messages.filter((m) => /phone is connected/.test(m));
    assert.equal(said.length, 1, JSON.stringify(w.messages));
    assert.match(said[0], /\/documents\/50\/details/);
    assert.match((await cli(["status", "--state", w.paths.root])).out, /Phone: connected/);
    const forgot = await cli(["phone", "--forget", "--state", w.paths.root]);
    assert.equal(forgot.code, 0);
    assert.deepEqual(Object.keys(readJson(w.paths.login)).sort(), ["address", "forgotten_at", "user"]);
  } finally { await w.close(); }
});

function keepWorld() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-keep-"));
  const state = path.join(dir, "state");
  fs.mkdirSync(state);
  const paths = { root: state, installed: path.join(state, "installed.json"), state: path.join(state, "state.json"), log: path.join(state, "clerk.log"), outbox: path.join(state, "outbox.jsonl") };
  writeJson(paths.installed, { dir, project: "godspeed-clerk-paperless", port: 8010, version: "3.3.3", stage: "done", user: "alex", host: "srv1.example.test", https_port: 48444 });
  let t = Date.parse("2026-10-23T10:00:00Z");
  const out = [], logs = [], calls = [];
  const w = { up: true, calls, out, logs, advance: (min) => { t += min * 60000; }, ctxPaths: paths };
  const ctx = { paths, clock: () => t, log: (l) => logs.push(l), outbox: (n) => out.push(n) };
  const run = (cmd, args) => { calls.push([cmd, ...args].join(" ")); if (cmd === "docker" && args.includes("up")) w.up = true; return { status: 0, stdout: "", stderr: "" }; };
  const fetchImpl = async () => { if (!w.up) throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }); return new Response("{}", { status: 401 }); };
  // A machine with no Caddy at all, so the hourly look at the address only says so.
  w.disk = { gb: 40, pct: 60 };
  w.step = (o = {}) => hostStep(ctx, { run, fetchImpl, root: dir, disk: () => w.disk, ...o });
  return w;
}

test("F3: a stopped Paperless is running again on the next check; still down after half an hour, one message", async () => {
  const w = keepWorld();
  assert.equal((await w.step()).up, true);
  w.up = false;
  const r = await w.step();
  assert.equal(r.restarted, true);
  assert.equal(w.calls.filter((c) => / up -d/.test(c)).length, 1);
  assert.equal((await w.step()).up, true, "running again at the next check");
  // It stops again and starting it does not help (docker answers, Paperless does not).
  w.up = false;
  const stuck = { run: (cmd, args) => { w.calls.push([cmd, ...args].join(" ")); return { status: 0, stdout: "" }; } };
  await w.step(stuck);
  w.advance(5); await w.step(stuck);
  assert.equal(w.calls.filter((c) => / up -d/.test(c)).length, 2, "not again within ten minutes");
  w.advance(10); await w.step(stuck);
  w.advance(20); await w.step(stuck);
  w.advance(10); await w.step(stuck);
  assert.deepEqual(w.out.map((n) => n.kind), ["paperless-down"], "one message for the whole stretch");
});

test("F3: a nearly full disk is said once per low stretch", async () => {
  const w = keepWorld();
  w.disk = { gb: 2.1, pct: 4 };
  await w.step();
  w.advance(61); await w.step();
  assert.deepEqual(w.out.map((n) => [n.kind, n.free]), [["disk-low", 2.1]]);
  w.disk = { gb: 30, pct: 50 };
  w.advance(61); await w.step();
  w.disk = { gb: 1.5, pct: 3 };
  w.advance(61); await w.step();
  assert.deepEqual(w.out.map((n) => n.kind), ["disk-low", "disk-low"], "again after it had room in between");
});

test("a Paperless the Clerk did not install is never started, stopped or checked", async () => {
  const ctx = { paths: { installed: path.join(os.tmpdir(), "no-such-installed.json") }, clock: Date.now, log: () => {}, outbox: () => {} };
  assert.equal(await hostStep(ctx, { run: () => { throw new Error("ran a command"); } }), null);
});

test("the new messages: each in plain words, once, while still true", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    await w.runUntilQuiet();
    // The update message is true only while Paperless still runs the version it went back to.
    writeJson(w.paths.installed, { dir: os.tmpdir(), project: "x", port: 8010, version: "3.2.1", stage: "done", user: "alex", host: "srv1.example.test", https_port: 48444, address: "https://srv1.example.test:48444" });
    const st = readJson(w.paths.state);
    st.host = { disk_low_since: "2026-10-23T03:00:00.000Z" };
    st.copy = { shared_since: "2026-10-23T02:30:00.000Z" };
    writeJson(w.paths.state, st);
    const c = w.context();
    c.outbox({ kind: "disk-low", since: "2026-10-23T03:00:00.000Z", free: 2.4 });
    c.outbox({ kind: "update-failed", to: "3.3.3", from: "3.2.1", rolled_back: true });
    c.outbox({ kind: "shared-paperless", since: "2026-10-23T02:30:00.000Z" });
    c.outbox({ kind: "paperless-down", since: "2026-10-22T01:00:00.000Z" }); // no longer down: not said
    await w.run();
    const m = w.messages.at(-1);
    assert.match(m, /disk is nearly full \(2\.4 GB free\)/);
    assert.match(m, /could not be updated to 3\.3\.3, so it runs 3\.2\.1 again, with every paper and setting as before/);
    assert.match(m, /another account/);
    assert.ok(!/has not answered/.test(m));
    assert.ok(!/[\u2013\u2014]/.test(m));
    const n = w.messages.length;
    await w.run();
    assert.equal(w.messages.length, n, "said once");
  } finally { await w.close(); }
});

test("REVIEW 2: the keep-running step finishes an update that was cut off, and tells only what is true", async () => {
  const w = keepWorld();
  const rec = readJson(w.ctxPaths.installed);
  fs.writeFileSync(path.join(rec.dir, "compose.yaml"), "services:\n  webserver:\n    image: ghcr.io/paperless-ngx/paperless-ngx:3.2.1@sha256:old\n");
  writeJson(w.ctxPaths.installed, { ...rec, version: "3.2.1", update: { to: "3.3.3", from: "3.2.1", image_from: "ghcr.io/paperless-ngx/paperless-ngx:3.2.1@sha256:old", image_to: "ghcr.io/paperless-ngx/paperless-ngx:3.3.3@sha256:new", backup: path.join(rec.dir, "backups", "none"), docs: 0, stage: "stopping" } });
  w.up = false;
  const r = await w.step();
  assert.equal(r.recovered.outcome, "old");
  assert.equal(readJson(w.ctxPaths.installed).update, undefined, "the journal is cleared");
  assert.ok(w.calls.some((c) => / up -d/.test(c)), "the old version is started again");
  assert.deepEqual(w.out, [], "cut off before the new version started: nothing changed, nothing to tell (round 2)");
  // Cut off after the new version started: that is a real failed update, and it is told.
  const s = keepWorld();
  const rs = readJson(s.ctxPaths.installed);
  fs.writeFileSync(path.join(rs.dir, "compose.yaml"), "services:\n  webserver:\n    image: ghcr.io/paperless-ngx/paperless-ngx:3.3.3@sha256:new\n");
  const copy = path.join(rs.dir, "backups", "before-3.3.3");
  fs.mkdirSync(copy, { recursive: true });
  fs.writeFileSync(path.join(copy, "compose.yaml"), "services:\n  webserver:\n    image: ghcr.io/paperless-ngx/paperless-ngx:3.2.1@sha256:old\n");
  fs.writeFileSync(path.join(copy, "paperless.env"), "PAPERLESS_URL=https://srv1.example.test:48444\n");
  writeJson(s.ctxPaths.installed, { ...rs, version: "3.2.1", update: { to: "3.3.3", from: "3.2.1", image_from: "ghcr.io/paperless-ngx/paperless-ngx:3.2.1@sha256:old", image_to: "ghcr.io/paperless-ngx/paperless-ngx:3.3.3@sha256:new", backup: copy, docs: 0, stage: "started" } });
  s.up = false;
  // Every look at Paperless takes eleven minutes here, so neither version answers in time.
  const slow = async () => { s.advance(11); return new Response("{}", { status: 401 }); };
  const r2 = await s.step({ fetchImpl: slow });
  assert.equal(r2.recovered.outcome, "old");
  assert.deepEqual(s.out.map((n) => n.kind), ["update-failed"], "told once");
});
