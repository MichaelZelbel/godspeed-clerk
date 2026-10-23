// F3: an update forced to fail after it has changed the database ends on the previous version with
// the previous database. Here with a pretend Docker whose "migrations" change a file in the
// database folder; the fresh machines (test/machine) do it with real Paperless 3.2.1 and 3.3.3.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Host, newPassword, newRecord } from "../lib/install/host.mjs";
import { imageFor } from "../lib/install/versions.mjs";
import { ocrFor } from "../lib/install/stack.mjs";

function world({ from = "3.2.1", docs = 3, broken = [], pullFails = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-host-"));
  const rec = newRecord({ dir, version: from, port: 8010, host: "srv1.example.test", httpsPort: 48444, front: "own", language: "English", user: "alex", clerkVersion: "0.4.0", timezone: "UTC" });
  const calls = [];
  const st = { running: false, version: null };
  const marker = () => path.join(dir, "data", "pg", "migrated");
  const run = (cmd, args) => {
    calls.push([cmd, ...args.filter((a) => !a.includes(dir) || a.startsWith(dir + path.sep + "data") || a.startsWith(dir + path.sep + "backups")).map((a) => a.replace(dir, "<dir>"))].join(" "));
    if (cmd === "docker" && args[0] === "pull") return pullFails.includes(args.at(-1)) ? { status: 1, stdout: "", stderr: "manifest unknown" } : { status: 0, stdout: "" };
    if (cmd === "docker" && args[0] === "compose") {
      const sub = args[5];
      if (sub === "stop" || sub === "down") { st.running = false; return { status: 0, stdout: "" }; }
      if (sub === "up") {
        const image = fs.readFileSync(path.join(dir, "compose.yaml"), "utf8").match(/image: (ghcr\S+)/)[1];
        st.version = image.match(/:(\d+\.\d+\.\d+)/)[1];
        st.running = true;
        // The new version's migrations change the database before anything can go wrong.
        fs.writeFileSync(marker(), st.version);
        return { status: 0, stdout: "" };
      }
    }
    if (cmd === "cp") { fs.cpSync(args[1], args[2], { recursive: true }); return { status: 0, stdout: "" }; }
    if (cmd === "rm") { fs.rmSync(args[1], { recursive: true, force: true }); return { status: 0, stdout: "" }; }
    return { status: 0, stdout: "" };
  };
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  const fetchImpl = async (url) => {
    if (!st.running || broken.includes(st.version)) throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    if (/ui_settings/.test(url)) return json({ settings: { version: st.version } });
    if (/documents\/\?/.test(url)) return json({ count: docs, results: [{ id: docs }] });
    if (/download/.test(url)) return new Response("%PDF-1.4 a made-up scan");
    return json({}, 404);
  };
  let now = Date.parse("2026-10-23T22:00:00Z");
  const host = new Host(rec, { run, fetchImpl, wait: async (ms) => { now += ms; }, clock: () => now });
  host.writeFiles({ image: imageFor(from), port: 8010, url: "https://srv1.example.test:48444", host: "srv1.example.test", ocr: ocrFor("English"), timezone: "UTC", clerkVersion: "0.4.0", secrets: { secretKey: "k".repeat(60), dbPass: "p".repeat(48) } });
  run("docker", ["compose", "-f", "x", "-p", "y", "up", "-d"]);
  calls.length = 0;
  return { dir, rec, host, calls, st, marker };
}

test("an update that works: the new version runs, the copy of the old database is kept", async () => {
  const w = world();
  const r = await w.host.update({ to: "3.3.3", token: "t" });
  assert.equal(r.ok, true, r.why);
  assert.equal(w.rec.version, "3.3.3");
  assert.match(fs.readFileSync(path.join(w.dir, "compose.yaml"), "utf8"), /paperless-ngx:3\.3\.3@sha256:dba0242c/);
  assert.equal(fs.readFileSync(w.marker(), "utf8"), "3.3.3");
  assert.equal(fs.readFileSync(path.join(r.backup, "pg", "migrated"), "utf8"), "3.2.1", "the database as 3.2.1 left it, copied aside");
  assert.equal(JSON.parse(fs.readFileSync(path.join(r.backup, "version.json"), "utf8")).version, "3.2.1");
});

test("F3: forced to fail after the new version started and changed the database, everything is put back", async () => {
  const w = world();
  const env0 = fs.readFileSync(path.join(w.dir, "paperless.env"), "utf8"), compose0 = fs.readFileSync(path.join(w.dir, "compose.yaml"), "utf8");
  const r = await w.host.update({ to: "3.3.3", token: "t", failAfterStart: true });
  assert.equal(r.ok, false);
  assert.equal(r.rolledBack, true);
  assert.equal(w.rec.version, "3.2.1", "the version it ran");
  assert.equal(w.st.version, "3.2.1", "running the old program");
  assert.equal(fs.readFileSync(w.marker(), "utf8"), "3.2.1", "the old database, not the one the new version migrated");
  assert.equal(fs.readFileSync(path.join(w.dir, "compose.yaml"), "utf8"), compose0);
  assert.equal(fs.readFileSync(path.join(w.dir, "paperless.env"), "utf8"), env0);
  const order = w.calls.map((c) => c.split(" ").slice(0, 7).join(" ")).map((c) => (/^docker pull/.test(c) ? "pull" : /compose .* stop/.test(c) ? "stop" : /compose .* up/.test(c) ? "up" : /compose .* down/.test(c) ? "down" : /^cp/.test(c) ? "cp" : /^rm/.test(c) ? "rm" : c));
  assert.deepEqual(order, ["pull", "stop", "cp", "cp", "up", "down", "rm", "cp", "rm", "cp", "up"]);
});

test("F3: a new version that never answers is put back the same way", async () => {
  const w = world({ broken: ["3.3.3"] });
  const r = await w.host.update({ to: "3.3.3", token: "t", timeoutMs: 60000 });
  assert.equal(r.ok, false);
  assert.equal(r.rolledBack, true);
  assert.equal(fs.readFileSync(w.marker(), "utf8"), "3.2.1");
  assert.match(r.why, /does not answer/);
});

test("a download that fails changes nothing; a Paperless not healthy before is not updated", async () => {
  const w = world({ pullFails: [imageFor("3.3.3")] });
  const r = await w.host.update({ to: "3.3.3", token: "t" });
  assert.equal(r.ok, false);
  assert.match(r.why, /nothing was changed/);
  assert.ok(!w.calls.some((c) => /stop|cp /.test(c)), w.calls.join("\n"));
  const v = world({ broken: ["3.2.1"] });
  const r2 = await v.host.update({ to: "3.3.3", token: "t" });
  assert.match(r2.why, /not healthy before the update/);
  assert.ok(!v.calls.some((c) => /pull|stop/.test(c)));
});

test("an update keeps the copies of the last two updates", async () => {
  const w = world();
  for (const n of ["before-3.3.3-a", "before-3.3.3-b", "before-3.3.3-c"]) fs.mkdirSync(path.join(w.dir, "backups", n), { recursive: true });
  w.host.pruneBackups();
  assert.deepEqual(fs.readdirSync(path.join(w.dir, "backups")).sort(), ["before-3.3.3-b", "before-3.3.3-c"]);
});

test("a password a person can type on a phone", () => {
  const p = newPassword();
  assert.match(p, /^[a-z2-9]{4}(-[a-z2-9]{4}){4}$/);
  assert.notEqual(p, newPassword());
  assert.ok(!/[01ilo]/.test(p));
});
