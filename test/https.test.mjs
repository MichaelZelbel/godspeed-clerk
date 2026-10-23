// F1, section 5: Paperless gets its HTTPS address the way Godspeed's installer gives the notebook
// its address: on the server's own name, through the Caddy that already holds ports 80 and 443
// (Godspeed's own, or the server's), with a site file of the Clerk's and one import line.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findFront, serverName, siteText, publish, heal, freePort, SITE_FILE_NAME } from "../lib/install/https.mjs";

const GODSPEED_CADDYFILE = "{\n\tadmin off\n}\n\n# The Godspeed Mission Control notebook's web address. Its installer writes this file.\nsrv1.example.test {\n\treverse_proxy 127.0.0.1:47833\n}\n";

function machine({ kind = "own", caddyActive = kind === "caddy", reloadFails = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-https-"));
  const f = (p) => path.join(root, p);
  const calls = [];
  const ws = "/root/godspeed/.godspeed/integrated-runtime";
  if (kind === "own") {
    fs.mkdirSync(f("etc/systemd/system"), { recursive: true });
    fs.writeFileSync(f("etc/systemd/system/godspeed-https.service"), `[Unit]\nDescription=Godspeed Mission Control web address\n[Service]\nUser=root\nGroup=root\nExecStart=${ws}/runtime/caddy-2.11.4/caddy run --config ${ws}/https/Caddyfile --adapter caddyfile\n`);
    fs.mkdirSync(f(`${ws}/https`), { recursive: true });
    fs.writeFileSync(f(`${ws}/https/Caddyfile`), GODSPEED_CADDYFILE);
  }
  if (kind === "caddy") {
    fs.mkdirSync(f("etc/caddy"), { recursive: true });
    fs.writeFileSync(f("etc/caddy/Caddyfile"), "srv1.example.test {\n\treverse_proxy 127.0.0.1:3100\n}\n\nimport /etc/caddy/godspeed-notebook.caddy\n");
    fs.writeFileSync(f("etc/caddy/godspeed-notebook.caddy"), "# The Godspeed Mission Control notebook's web address. Its installer writes this file.\nsrv1.example.test:48443 {\n\treverse_proxy 127.0.0.1:47833\n}\n");
  }
  const run = (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    if (cmd === "systemctl" && args[0] === "is-active") return { status: args.includes("caddy") && caddyActive ? 0 : 3, stdout: "" };
    if (cmd === "systemctl" && (args[0] === "reload" || args[0] === "restart") && reloadFails) return { status: 1, stdout: "", stderr: "Error: adapting config" };
    if (cmd === "ss") return { status: 0, stdout: "LISTEN 0 4096 127.0.0.1:47833 0.0.0.0:*\n" };
    if (cmd === "ufw" || cmd === "firewall-cmd") return { status: 127, stdout: "" }; // no firewall program on this machine
    return { status: 0, stdout: "" };
  };
  return { root, f, calls, run, ws };
}

test("finds Godspeed's own Caddy from its service, and the server's name from its Caddyfile", () => {
  const m = machine();
  const front = findFront({ root: m.root, run: m.run });
  assert.equal(front.kind, "own");
  assert.equal(front.caddyfile, `${m.ws}/https/Caddyfile`);
  assert.equal(front.unit, "godspeed-https.service");
  assert.equal(serverName(front, { root: m.root }), "srv1.example.test");
});

test("finds the server's own Caddy, and the name the notebook was given there", () => {
  const m = machine({ kind: "caddy" });
  const front = findFront({ root: m.root, run: m.run });
  assert.equal(front.kind, "caddy");
  assert.equal(serverName(front, { root: m.root }), "srv1.example.test");
});

test("no Caddy: nothing is guessed", () => {
  const m = machine({ kind: "none" });
  assert.equal(findFront({ root: m.root, run: m.run }).kind, "none");
});

test("the site: the server's name on the Clerk's port, handed to Paperless on this machine", () => {
  assert.equal(siteText({ host: "srv1.example.test", port: 48444, upstream: 8010 }), "# Paperless-ngx's web address. The Clerk (godspeed-clerk) writes this file and keeps it.\nsrv1.example.test:48444 {\n\treverse_proxy 127.0.0.1:8010\n}\n");
});

test("own Caddy: a site file beside Godspeed's Caddyfile, one import line, Caddy restarted; Godspeed's site untouched", async () => {
  const m = machine();
  const front = findFront({ root: m.root, run: m.run });
  const r = await publish({ front, host: "srv1.example.test", port: 48444, upstream: 8010, root: m.root, run: m.run });
  assert.equal(r.ok, true, r.why);
  const cf = fs.readFileSync(m.f(`${m.ws}/https/Caddyfile`), "utf8");
  const site = `${m.ws}/https/${SITE_FILE_NAME}`;
  assert.ok(cf.startsWith(GODSPEED_CADDYFILE), "Godspeed's part as it was");
  assert.equal(cf.split("\n").filter((l) => l === `import ${site}`).length, 1);
  assert.match(fs.readFileSync(m.f(site), "utf8"), /srv1\.example\.test:48444 \{/);
  assert.ok(m.calls.includes("systemctl restart godspeed-https.service"));
  const again = await publish({ front, host: "srv1.example.test", port: 48444, upstream: 8010, root: m.root, run: m.run });
  assert.equal(again.ok, true);
  assert.equal(fs.readFileSync(m.f(`${m.ws}/https/Caddyfile`), "utf8").split("\n").filter((l) => l === `import ${site}`).length, 1, "run again: still one line");
});

test("the server's Caddy: /etc/caddy/godspeed-clerk.caddy and a reload; refused, both files back as they were", async () => {
  const m = machine({ kind: "caddy" });
  const front = findFront({ root: m.root, run: m.run });
  const before = fs.readFileSync(m.f("etc/caddy/Caddyfile"), "utf8");
  const ok = await publish({ front, host: "srv1.example.test", port: 48444, upstream: 8010, root: m.root, run: m.run });
  assert.equal(ok.ok, true);
  assert.ok(m.calls.includes("systemctl reload caddy"));
  assert.match(fs.readFileSync(m.f("etc/caddy/Caddyfile"), "utf8"), /^import \/etc\/caddy\/godspeed-clerk\.caddy$/m);

  const bad = machine({ kind: "caddy", reloadFails: true });
  const fr = findFront({ root: bad.root, run: bad.run });
  const r = await publish({ front: fr, host: "srv1.example.test", port: 48444, upstream: 8010, root: bad.root, run: bad.run });
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(bad.f("etc/caddy/Caddyfile"), "utf8"), before, "the server's Caddyfile as it was");
  assert.ok(!fs.existsSync(bad.f("etc/caddy/godspeed-clerk.caddy")), "no site file left");
  assert.match(r.why, /journalctl -u caddy/);
});

test("a Godspeed update rewrote its Caddyfile: the line comes back, Caddy restarted once; nothing to do when it is there", async () => {
  const m = machine();
  const front = findFront({ root: m.root, run: m.run });
  await publish({ front, host: "srv1.example.test", port: 48444, upstream: 8010, root: m.root, run: m.run });
  fs.writeFileSync(m.f(`${m.ws}/https/Caddyfile`), GODSPEED_CADDYFILE);
  m.calls.length = 0;
  const h = await heal({ host: "srv1.example.test", port: 48444, upstream: 8010, root: m.root, run: m.run });
  assert.equal(h.healed, true);
  assert.ok(fs.readFileSync(m.f(`${m.ws}/https/Caddyfile`), "utf8").includes(`import ${m.ws}/https/${SITE_FILE_NAME}`));
  assert.deepEqual(m.calls.filter((c) => /restart|reload/.test(c)), ["systemctl restart godspeed-https.service"]);
  m.calls.length = 0;
  assert.equal((await heal({ host: "srv1.example.test", port: 48444, upstream: 8010, root: m.root, run: m.run })).healed, false);
  assert.deepEqual(m.calls.filter((c) => /restart|reload/.test(c)), []);
});

test("the port: 48444 unless something already uses it", () => {
  assert.equal(freePort({ texts: [GODSPEED_CADDYFILE], run: () => ({ status: 0, stdout: "" }) }), 48444);
  assert.equal(freePort({ texts: ["x.example:48444 {\n}"], run: () => ({ status: 0, stdout: "" }) }), 48445);
  assert.equal(freePort({ texts: [], run: () => ({ status: 0, stdout: "LISTEN 0 4096 0.0.0.0:48444 0.0.0.0:*\n" }) }), 48445);
});
