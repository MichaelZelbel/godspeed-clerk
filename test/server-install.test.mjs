// The gaps observed on the fresh public beta.6 Docker and native installs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { dockerInstallation, findDockerInstallation, dockerFetch, dockerFront, execArgs } from "../lib/core/docker.mjs";
import { findMissionControl } from "../lib/core/paths.mjs";
import { resolveCredentials } from "../lib/channels/telegram.mjs";
import { supportedVersion, godspeedVersion, UPDATE_GODSPEED } from "../lib/install/godspeed.mjs";
import { publish } from "../lib/install/https.mjs";
import { cli, installedVersion } from "./helpers.mjs";
import { startFakePaperless } from "./fakes/paperless.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "clerk-public-server-"));
function installedDocker() {
  const home = tmp();
  fs.mkdirSync(path.join(home, ".godspeed"));
  fs.writeFileSync(path.join(home, ".godspeed", "model-host.json"), JSON.stringify({ format: 1, kind: "godspeed-docker", service: "godspeed", workspace: "/opt/data/full-candidate/workspace" }));
  fs.writeFileSync(path.join(home, ".godspeed", "model.mjs"), "// installed public model launcher\n");
  fs.writeFileSync(path.join(home, "compose.yaml"), "name: godspeed-mission-control\n");
  fs.writeFileSync(path.join(home, ".env"), "GODSPEED_HOST=notebook.example.test\n");
  return dockerInstallation(home);
}

test("finds the official Docker host workspace from its service label, without guessing another workspace", () => {
  const install = installedDocker();
  const found = findDockerInstallation({ run: (cmd, args) => {
    assert.equal(cmd, "docker"); assert.ok(args.includes("label=com.docker.compose.service=godspeed"));
    return { status: 0, stdout: install.root + "\n" };
  } });
  assert.equal(found.root, install.root);
  const nowhere = tmp();
  assert.equal(findMissionControl({ cwd: nowhere, userHome: nowhere, env: {}, dockerFind: () => found }), found.root);
  assert.equal(findMissionControl({ arg: nowhere, env: {}, dockerFind: () => found }), null, "an explicit other workspace never falls back to Docker");
});

test("the notebook relay uses only the actual fixed service and private loopback door", async () => {
  const install = installedDocker();
  let payload, command;
  const fetchImpl = dockerFetch(install, { spawnImpl: (exe, args) => {
    command = [exe, ...args];
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    let input = ""; child.stdin.on("data", x => input += x);
    child.stdin.on("finish", () => { payload = JSON.parse(input); child.stdout.write(JSON.stringify({ status: 200, body: JSON.stringify({ data: [{ timezone: "Europe/Berlin" }] }) })); child.emit("close", 0); });
    return child;
  } });
  const r = await fetchImpl("http://127.0.0.1:47832/api/query", { method: "POST", body: JSON.stringify({ table: "profiles", operation: "select" }) });
  assert.equal((await r.json()).data[0].timezone, "Europe/Berlin");
  assert.deepEqual(command.slice(0, -1), ["docker", ...execArgs(install, ["node", "--input-type=module", "-e"])]);
  assert.match(command.at(-1), /http:\/\/127\.0\.0\.1:47832/);
  assert.equal(payload.path, "/api/query");
  await assert.rejects(fetchImpl("http://example.test/api/query", { method: "POST" }), /unknown private notebook/);
  await assert.rejects(fetchImpl("http://127.0.0.1:47832/api/auth/setup", { method: "POST" }), /unknown private notebook/);
});

test("Docker Telegram reads the real verified assistant home, with no host fallback or credential copy", () => {
  const install = installedDocker();
  const result = resolveCredentials({ settings: { workspace: install.root }, run: (cmd, args) => {
    assert.equal(cmd, "docker"); assert.ok(args.includes("hermes")); assert.ok(args.includes(install.workspace));
    assert.ok(args.some(x => x.includes("assistant.json") && x.includes("d.verified")));
    return { status: 0, stdout: "TELEGRAM_BOT_TOKEN=999:made-up\nTELEGRAM_HOME_CHANNEL=1001\n" };
  } });
  assert.deepEqual(result, { token: "999:made-up", chat: "1001" });
  assert.equal(resolveCredentials({ settings: { workspace: install.root }, run: () => ({ status: 1, stdout: "" }) }), null);
  assert.equal(fs.existsSync(path.join(install.root, ".godspeed", "telegram.env")), false);
});

test("Docker HTTPS shares the installed Caddy certificate volume and listens on its own port", async () => {
  const install = installedDocker(), calls = [];
  const inspected = { State: { Running: true }, Config: { Image: "caddy:2.10.2-alpine@sha256:test" }, Mounts: [{ Destination: "/data", Type: "volume", Name: "godspeed-certificates" }] };
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args.includes("ps")) return { status: 0, stdout: "a".repeat(64) + "\n" };
    if (args[0] === "inspect" && args[1] !== "godspeed-clerk-https") return { status: 0, stdout: JSON.stringify([inspected]) };
    if (args[0] === "inspect") return { status: 1, stdout: "" };
    return { status: 0, stdout: "" };
  };
  const front = dockerFront(install, { run });
  front.caddyfile = path.join(tmp(), "Caddyfile");
  const before = fs.readFileSync(install.compose, "utf8");
  const r = await publish({ front, host: front.host, port: 48444, upstream: 8010, run });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(install.compose, "utf8"), before);
  const launch = calls.find(c => c[1] === "run");
  assert.ok(launch.includes("type=volume,src=godspeed-certificates,dst=/data"));
  assert.ok(launch.includes("host"));
  assert.ok(!launch.includes("-p"), "no private API port is published");
  assert.match(fs.readFileSync(front.caddyfile, "utf8"), /auto_https disable_redirects/);
  assert.match(fs.readFileSync(front.caddyfile, "utf8"), /notebook\.example\.test:48444/);
});

test("requires beta.6 or newer, with numeric beta comparison and the actual installed native receipt", async () => {
  for (const v of ["2.0.0-beta.6", "2.0.0-beta.10", "2.0.0-rc.1", "2.0.0", "2.1.0", "3.0.0"]) assert.equal(supportedVersion(v), true, v);
  for (const v of [null, "unknown", "1.9.0", "2.0.0-beta.5", "2.0.0-beta.2", "2.0.0-alpha.9"]) assert.equal(supportedVersion(v), false, v);
  const home = installedVersion(tmp());
  assert.equal(await godspeedVersion(home), "2.0.0-beta.6");
});

test("an older Godspeed stops setup before Paperless, settings or service changes", async () => {
  const home = installedVersion(tmp(), "2.0.0-beta.5"), state = path.join(tmp(), "state");
  fs.writeFileSync(path.join(home, "AGENTS.md"), "made up\n");
  const pl = await startFakePaperless();
  try {
    const r = await cli(["setup", "--godspeed", home, "--paperless", pl.url, "--user", "alex", "--state", state, "--no-service", "--no-copy"]);
    assert.equal(r.code, 1); assert.equal(r.err, UPDATE_GODSPEED);
    assert.equal(pl.state.requests.length, 0);
    assert.equal(fs.existsSync(state), false);
  } finally { await pl.close(); }
});
