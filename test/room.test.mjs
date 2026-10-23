// F1: the size check comes first. On a machine below the minimum the installer stops before it
// installs anything and names what is missing, in plain words.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { roomCheck, NEED, measure, cgroupAvailable } from "../lib/install/room.mjs";

const fine = { platform: "linux", root: true, arch: "x64", mem_available_mb: 6144, disk_free_gb: 40, docker: "27.5.1", compose: "2.32.4", docker_running: true };

test("a server with room passes, and says what it measured", () => {
  const r = roomCheck(fine);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
  assert.match(r.summary, /6\.0 GB of memory free, 40 GB of disk free, Docker 27\.5\.1/);
});

test("too little memory and disk: both named, with what is needed", () => {
  const r = roomCheck({ ...fine, mem_available_mb: 900, disk_free_gb: 3.2 });
  assert.equal(r.ok, false);
  assert.equal(r.missing.length, 2);
  assert.match(r.missing[0], /0\.9 GB of memory free/);
  assert.match(r.missing[0], new RegExp(`${(NEED.memory_mb / 1024).toFixed(1)} GB`));
  assert.match(r.missing[1], /3\.2 GB of disk free/);
  assert.match(r.missing[1], new RegExp(`${NEED.disk_gb} GB`));
});

test("no Docker, Docker not running, no Compose: each said with the step that fixes it", () => {
  assert.match(roomCheck({ ...fine, docker: null, docker_running: false, compose: null }).missing.join("\n"), /Docker is not installed.*get\.docker\.com/s);
  assert.match(roomCheck({ ...fine, docker_running: false }).missing[0], /Docker is installed but not running.*systemctl start docker/);
  assert.match(roomCheck({ ...fine, compose: null }).missing[0], /Docker Compose/);
});

test("not Linux, not root, another processor: said, nothing else asked of the machine", () => {
  assert.match(roomCheck({ ...fine, platform: "darwin" }).missing[0], /Linux server.*setup --paperless/);
  assert.match(roomCheck({ ...fine, root: false }).missing[0], /administrator.*sudo/);
  assert.match(roomCheck({ ...fine, arch: "ia32" }).missing[0], /64-bit/);
});

test("no em or en dashes in anything it says", () => {
  const all = [roomCheck({ platform: "darwin", root: false, arch: "ia32", mem_available_mb: 1, disk_free_gb: 0.1, docker: null, compose: null, docker_running: false }).missing.join(" ")];
  assert.ok(!/[\u2013\u2014]/.test(all.join(" ")));
});

test("memory free is the smaller of the machine's and its container's limit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-cg-"));
  const cg = path.join(dir, "sys", "fs", "cgroup");
  fs.mkdirSync(path.join(cg, "system.slice", "docker-abc.scope", "init.scope"), { recursive: true });
  fs.writeFileSync(path.join(cg, "system.slice", "docker-abc.scope", "memory.max"), String(1024 * 1024 * 1024));
  fs.writeFileSync(path.join(cg, "system.slice", "docker-abc.scope", "memory.current"), String(300 * 1024 * 1024));
  fs.writeFileSync(path.join(cg, "system.slice", "docker-abc.scope", "init.scope", "memory.max"), "max");
  fs.writeFileSync(path.join(dir, "cgroup"), "0::/system.slice/docker-abc.scope/init.scope\n");
  assert.equal(cgroupAvailable({ cgroupFile: path.join(dir, "cgroup"), root: cg }), 724);
  fs.writeFileSync(path.join(dir, "cgroup"), "0::/\n");
  assert.equal(cgroupAvailable({ cgroupFile: path.join(dir, "cgroup"), root: cg }), null, "no limit");
});

test("measure reads this machine without changing it", () => {
  const m = measure({ dir: os.tmpdir(), run: () => ({ status: 1, stdout: "" }) });
  assert.equal(typeof m.disk_free_gb, "number");
  assert.equal(m.docker, null);
  assert.equal(m.arch, process.arch);
});
