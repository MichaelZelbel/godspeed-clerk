// F1, the install path, its decisions before anything is installed: a Paperless already running is
// offered instead of a second one; a machine without room, or without the web address Godspeed's
// installer gives a server, gets nothing installed. (The whole install runs on the fresh machines of
// test/machine.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findExisting, installPaperless, phoneWords } from "../lib/install/install.mjs";
import { statePaths } from "../lib/core/paths.mjs";

test("a Paperless already running here, not the Clerk's own, is found with its port", () => {
  const ps = "godspeed-clerk-paperless-webserver-1|ghcr.io/paperless-ngx/paperless-ngx:3.3.3|127.0.0.1:8010->8000/tcp|godspeed-clerk-paperless\npaperless-webserver-1|ghcr.io/paperless-ngx/paperless-ngx:3.3.3|127.0.0.1:8011->8000/tcp|paperless\n";
  assert.deepEqual(findExisting({ run: () => ({ status: 0, stdout: ps }) }), { name: "paperless-webserver-1", port: 8011 });
  assert.equal(findExisting({ run: () => ({ status: 0, stdout: ps.split("\n")[0] }) }), null, "the Clerk's own is not someone else's");
  assert.equal(findExisting({ run: () => ({ status: 127, stdout: "" }) }), null, "no Docker");
});

function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-inst-"));
  const paths = statePaths(path.join(dir, "state"));
  const calls = [];
  return { dir, paths, calls, ctx: { paths, env: { GODSPEED_CLERK_PAPERLESS_DIR: path.join(dir, "paperless") }, log: () => {} } };
}

test("F1: on a machine without Docker, nothing is installed and what is missing is named", async () => {
  if (process.platform !== "linux") return; // the size check speaks of Linux servers only
  const w = world();
  const run = (cmd, args) => { w.calls.push([cmd, ...args].join(" ")); return { status: 127, stdout: "" }; };
  const r = await installPaperless(w.ctx, { user: "alex" }, { run, root: w.dir });
  assert.equal(r.ok, false);
  assert.match(r.missing.join(" "), /Docker is not installed/);
  assert.ok(!fs.existsSync(path.join(w.dir, "paperless")), "no folder");
  assert.ok(!fs.existsSync(w.paths.installed), "no record");
  assert.ok(!w.calls.some((c) => /compose -f|pull|up -d/.test(c)), w.calls.join("\n"));
});

test("F1: a server without the web address Godspeed's installer gives it gets nothing installed, and is told why", async () => {
  const w = world();
  const run = (cmd, args) => {
    w.calls.push([cmd, ...args].join(" "));
    if (cmd === "docker" && args[0] === "version") return { status: 0, stdout: "27.5.1\n" };
    if (cmd === "docker" && args[0] === "--version") return { status: 0, stdout: "Docker version 27.5.1\n" };
    if (cmd === "docker" && args[0] === "compose") return { status: 0, stdout: "2.32.4\n" };
    if (cmd === "docker" && args[0] === "info") return { status: 0, stdout: w.dir };
    return { status: 3, stdout: "" }; // no caddy, no systemd units
  };
  const r = await installPaperless(w.ctx, { user: "alex" }, { run, root: w.dir });
  if (process.platform !== "linux" || !(typeof process.getuid === "function" && process.getuid() === 0)) {
    assert.equal(r.ok, false, "not a Linux server run as root: stopped at the size check");
    return;
  }
  assert.equal(r.ok, false);
  assert.match(r.missing.join(" "), /no web address yet/);
  assert.ok(!fs.existsSync(path.join(w.dir, "paperless")));
});

test("F2: the phone's words name the app, the address, the login and the second factor, without dashes", () => {
  const t = phoneWords({ address: "https://srv1.example.test:48444", user: "alex" }, { user: "alex", password: "abcd-efgh-jkmn-pqrs-tuvw", secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", otpauth: "otpauth://totp/x", recovery: ["12345678"] });
  for (const want of ["Swift Paperless", "https://srv1.example.test:48444", "alex", "abcd-efgh-jkmn-pqrs-tuvw", "GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ", "12345678", "authenticator"]) assert.ok(t.includes(want), want);
  assert.ok(!/[\u2013\u2014]/.test(t));
  const forgotten = phoneWords({ address: "https://srv1.example.test:48444", user: "alex" }, { user: "alex" });
  assert.ok(!/undefined|null/.test(forgotten), forgotten);
});

test("Paperless keeps the person's time zone from their Godspeed notebook, else this server's", async () => {
  const { personsTimezone } = await import("../lib/install/install.mjs");
  const http = await import("node:http");
  let tz = "Europe/Berlin";
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ data: JSON.parse(b).table === "profiles" ? [{ timezone: tz }] : [] })); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const env = { GODSPEED_CLERK_NOTEBOOK: `http://127.0.0.1:${srv.address().port}` };
  try {
    assert.equal(await personsTimezone({ env }), "Europe/Berlin");
    tz = "Not/AZone";
    assert.equal(await personsTimezone({ env }), null, "not a time zone");
    tz = "UTC";
    assert.equal(await personsTimezone({ env }), null, "the notebook's default says nothing about the person");
    assert.equal(await personsTimezone({ env: { GODSPEED_CLERK_NOTEBOOK: "http://127.0.0.1:9" } }), null, "no notebook");
  } finally { srv.close(); }
});
