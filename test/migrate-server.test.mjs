import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { parse, sameFiles, remoteCode, migrate } from "../scripts/migrate-server.mjs";
import { phoneWords } from "../lib/install/install.mjs";

const args = parse(["--apply", "--source", "old", "--target", "new"]);
const source = { count: 2, ids: [2, 7], documents: [[2, "a", "x"], [7, "b", "y"]], user: "owner", version: "3.3.3", active: true };
const target = { count: 0, version: "3.3.3", free: 10_000_000_000, staged: false };
const exported = { count: 2, ids: [2, 7], documents: source.documents, version: "3.3.3", manifest: "abc", files: [["manifest.json", 10, "a"], ["originals/2.pdf", 100, "b"]] };
const scanned = { version: exported.version, manifest: exported.manifest, files: exported.files };

test("arguments require distinct SSH aliases and keep staging on the server's private disk", () => {
  assert.equal(args["source-state"], "/var/lib/godspeed/clerk");
  assert.throws(() => parse(["--apply", "--source", "old", "--target", "old"]), /distinct/);
  assert.throws(() => parse(["--apply", "--source", "old;rm", "--target", "new"]), /SSH aliases/);
  assert.throws(() => parse(["--apply", "--source", "old", "--target", "new", "--staging", "/etc"]), /staging/);
});

test("the remote code sent over SSH remains valid JavaScript", () => {
  const code = remoteCode({ action: "source-preflight", source: "old", state: "/var/lib/godspeed/clerk", compose: "/opt/paperless-ngx/docker-compose.yml" });
  const check = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: code, encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
});

test("every copied file and the Paperless version must match", () => {
  assert.equal(sameFiles(exported, scanned), true);
  assert.equal(sameFiles(exported, { ...scanned, files: [["originals/2.pdf", 100, "wrong"]] }), false);
  assert.equal(sameFiles(exported, { ...scanned, version: "3.3.2" }), false);
});

test("preflight reads both servers and changes neither", async () => {
  const actions = [];
  const result = await migrate({ ...args, mode: "--check" }, {
    remote: (_, cfg) => { actions.push(cfg.action); return cfg.action === "source-preflight" ? source : target; },
    copy: () => { throw new Error("copy should not run"); }, log: () => {},
  });
  assert.deepEqual(actions, ["source-preflight", "target-preflight"]);
  assert.equal(result.source.count, 2);
});

test("a version mismatch stops before either worker is paused", async () => {
  const actions = [];
  await assert.rejects(migrate(args, {
    remote: (_, cfg) => { actions.push(cfg.action); return cfg.action === "source-preflight" ? source : { ...target, version: "3.2.1" }; },
    log: () => {},
  }), /versions differ/);
  assert.deepEqual(actions, ["source-preflight", "target-preflight"]);
});

test("a failed transfer resumes the old worker and never imports", async () => {
  const actions = [];
  await assert.rejects(migrate(args, {
    remote: (_, cfg) => {
      actions.push(cfg.action);
      if (cfg.action === "source-preflight") return source;
      if (cfg.action === "target-preflight") return target;
      if (cfg.action === "source-export") return exported;
      return {};
    },
    copy: () => { throw new Error("transfer cut off"); }, log: () => {},
  }), /transfer cut off/);
  assert.equal(actions.at(-1), "resume-source");
  assert.equal(actions.includes("target-apply"), false);
});

test("a complete move reconciles notebook links and leaves the old worker paused", async () => {
  const actions = [], copies = [];
  const result = await migrate(args, {
    remote: (_, cfg) => {
      actions.push(cfg.action);
      if (cfg.action === "source-preflight") return source;
      if (cfg.action === "target-preflight") return { ...target, serviceActive: true };
      if (cfg.action === "source-export") return exported;
      if (cfg.action === "target-scan") return scanned;
      if (cfg.action === "target-apply") return { count: 2 };
      if (cfg.action === "reconcile") return { notes: 2, items: 2 };
      return {};
    },
    copy: (...params) => { copies.push(params); }, log: () => {},
  });
  assert.equal(result.notebook.items, 2);
  assert.equal(copies.length, 2);
  assert.deepEqual(actions.slice(-3), ["reconcile", "source-preflight", "resume-target"]);
  assert.equal(actions.includes("stop-target"), true);
  assert.equal(actions.includes("resume-source"), false);
});

test("a scan reaching old Paperless during notebook reconciliation prevents a success report", async () => {
  const actions = [];
  let reads = 0;
  await assert.rejects(migrate(args, {
    remote: (_, cfg) => {
      actions.push(cfg.action);
      if (cfg.action === "source-preflight") return ++reads === 3 ? { ...source, count: 3, ids: [2, 7, 9], documents: [...source.documents, [9, "c", "z"]] } : source;
      if (cfg.action === "target-preflight") return { ...target, serviceActive: true };
      if (cfg.action === "source-export") return exported;
      if (cfg.action === "target-scan") return scanned;
      if (cfg.action === "target-apply") return { count: 2 };
      if (cfg.action === "reconcile") return { notes: 2, items: 2 };
      return {};
    }, copy: () => {}, log: () => {},
  }), /source papers changed during notebook reconciliation/);
  assert.deepEqual(actions.slice(-2), ["resume-source", "resume-target"]);
});

test("a migrated phone login uses the imported account, not the empty install's temporary password", () => {
  const words = phoneWords({ address: "https://new.example:48444", user: "owner" }, { user: "owner", address: "https://new.example:48444", migrated_at: "2026-11-10" });
  assert.match(words, /with your Paperless password/);
  assert.doesNotMatch(words, /undefined|setup key:/);
});
