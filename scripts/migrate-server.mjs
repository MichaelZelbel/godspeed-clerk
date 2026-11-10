#!/usr/bin/env node
// Run on an operator's computer that can SSH as root to the old and new servers.
// Paperless and Clerk stay on the old server; only the old Clerk worker is paused
// during --apply. The new Clerk must have been installed normally and left paused.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REMOTE = String.raw`
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
const cfg = __CONFIG__;
if (process.getuid?.() !== 0) throw new Error("migration needs root SSH on both servers");
const state = cfg.state;
const app = "/usr/local/lib/godspeed-clerk";
if (!fs.existsSync(app + "/lib/install/host.mjs")) throw new Error("The Clerk is not installed on this server; use its existing installer first");
const { Host } = await import(app + "/lib/install/host.mjs");
const { imageFor, isTested } = await import(app + "/lib/install/versions.mjs");
const { MANIFEST_FILES, hashLike } = await import(app + "/lib/core/restore.mjs");
const read = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
const write = (p, value) => { fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }); };
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 12 * 60 * 1000, maxBuffer: 16 * 1024 * 1024, ...opts });
  if (r.error || r.status !== 0) throw new Error(cmd + " failed (exit " + (r.status ?? "error") + ")");
  return r.stdout.trim();
};
const service = () => spawnSync("systemctl", ["is-active", "--quiet", "godspeed-clerk.service"]).status === 0;
const compose = (args) => run("docker", ["compose", "-f", cfg.compose, ...args]);
const paperlessCounts = () => {
  const code = 'import json\nfrom django.db.models import Count\nfrom documents.models import Document\nrows = Document.global_objects.values("owner__username").annotate(n=Count("id"))\ndocs = Document.global_objects.order_by("id").values_list("id", "modified", "checksum")\nprint("MIGRATION " + json.dumps({"count": Document.global_objects.count(), "owners": { (r["owner__username"] or ""): r["n"] for r in rows }, "documents": [[i, m.isoformat(), c] for i, m, c in docs] }))';
  const out = compose(["exec", "-T", "webserver", "python3", "manage.py", "shell", "-c", code]);
  const line = out.split("\n").find((s) => s.startsWith("MIGRATION "));
  if (!line) throw new Error("Paperless did not report document counts");
  return JSON.parse(line.slice(10));
};
const host = () => {
  const installed = read(path.join(state, "installed.json"));
  if (!installed?.dir || !installed?.port || !installed?.address) throw new Error("target has no Clerk-managed Paperless; use the existing Clerk installer first");
  return new Host(installed, { save: (rec) => write(path.join(state, "installed.json"), rec) });
};
const targetIds = (h) => h.shell('import json\nfrom documents.models import Document\nprint("CLERK " + json.dumps(list(Document.global_objects.order_by("id").values_list("id", flat=True))))');
const walk = (dir, prefix = "") => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const rel = prefix ? prefix + "/" + e.name : e.name;
  if (e.isSymbolicLink()) throw new Error("export contains a symbolic link");
  return e.isDirectory() ? walk(path.join(dir, e.name), rel) : e.isFile() ? [rel] : [];
});
const digest = (p, algorithm = "sha256") => {
  const h = crypto.createHash(algorithm);
  const fd = fs.openSync(p, "r"), buf = Buffer.alloc(1024 * 1024);
  try { for (;;) { const n = fs.readSync(fd, buf, 0, buf.length, null); if (!n) break; h.update(buf.subarray(0, n)); } }
  finally { fs.closeSync(fd); }
  return h.digest("hex");
};
const scan = (dir) => {
  const metadata = read(path.join(dir, "metadata.json"));
  const manifest = read(path.join(dir, "manifest.json"));
  if (!metadata?.version || !Array.isArray(manifest)) throw new Error("Paperless export has no complete metadata and manifest");
  const named = MANIFEST_FILES(manifest);
  for (const [rel, sum] of named) {
    const full = path.resolve(dir, rel);
    if (!full.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(full) || hashLike(fs.readFileSync(full), sum) !== sum) throw new Error("Paperless export file does not match its manifest");
  }
  const files = walk(dir).sort().map((rel) => [rel, fs.statSync(path.join(dir, rel)).size, digest(path.join(dir, rel))]);
  return { version: String(metadata.version).replace(/^v/, ""), files, manifest: digest(path.join(dir, "manifest.json")) };
};
const stage = cfg.stage || "/var/lib/godspeed/clerk-migration";
const marker = path.join(stage, "migration.json");
const validStage = () => {
  if (!stage.startsWith("/var/lib/godspeed/") || stage === "/var/lib/godspeed/") throw new Error("staging must be a private directory under /var/lib/godspeed");
  if (fs.existsSync(stage) && fs.lstatSync(stage).isSymbolicLink()) throw new Error("staging cannot be a symbolic link");
  const m = read(marker);
  if (fs.existsSync(stage) && (!m || m.source !== cfg.source)) throw new Error("staging directory belongs to another task");
  return m;
};
let out;
if (cfg.action === "source-preflight") {
  const conn = read(path.join(state, "paperless.json"));
  if (!conn?.user || !conn?.token) throw new Error("source has no Clerk Paperless connection");
  if (!fs.existsSync(cfg.compose)) throw new Error("source Paperless Compose file is missing");
  walk(state); // only regular files may cross the SSH boundary
  const counts = paperlessCounts();
  const others = Object.entries(counts.owners).filter(([name, n]) => n && name !== conn.user);
  if (others.length) throw new Error("source Paperless has documents belonging to another or no account");
  const { Paperless } = await import(app + "/lib/core/paperless.mjs");
  const me = await new Paperless({ url: conn.url, token: conn.token }).me();
  out = { count: counts.count, ids: counts.documents.map((d) => d[0]), documents: counts.documents, user: conn.user, version: me.version, active: service() };
} else if (cfg.action === "target-preflight") {
  const h = host(), conn = read(path.join(state, "paperless.json"));
  if (read(path.join(state, "settings.json"), {}).active !== false) throw new Error("new Clerk is not paused; use godspeed-clerk pause first");
  const prior = validStage();
  let n;
  try { n = Object.values(h.owners()).reduce((a, b) => a + b, 0); }
  catch (e) { if (prior?.phase !== "importing") throw e; n = 0; }
  const disk = fs.statfsSync(h.dir);
  out = { count: n, version: h.rec.version, address: h.rec.address, free: disk.bavail * disk.bsize, staged: !!prior, serviceActive: service() };
  if (n && !out.staged) throw new Error("new Paperless is not empty");
  if (!conn?.token) throw new Error("new Clerk installation has no Paperless token");
} else if (cfg.action === "stop-source") {
  if (service()) run("systemctl", ["stop", "godspeed-clerk.service"]);
  out = { active: service() };
} else if (cfg.action === "resume-source") {
  if (!service()) run("systemctl", ["start", "godspeed-clerk.service"]);
  out = { active: service() };
} else if (cfg.action === "stop-target") {
  if (read(path.join(state, "settings.json"), {}).active !== false) throw new Error("new Clerk is not paused");
  if (service()) run("systemctl", ["stop", "godspeed-clerk.service"]);
  out = { active: service() };
} else if (cfg.action === "resume-target") {
  if (read(path.join(state, "settings.json"), {}).active !== false) throw new Error("new Clerk is not paused");
  if (!service()) run("systemctl", ["start", "godspeed-clerk.service"]);
  out = { active: service() };
} else if (cfg.action === "source-export") {
  if (service()) throw new Error("old Clerk worker must be paused before final export");
  compose(["exec", "-T", "webserver", "document_exporter", "/usr/src/paperless/export", "--no-progress-bar", "-d", "-c", "-nt", "-p"]);
  const s = scan(cfg.exportDir), counts = paperlessCounts();
  out = { ...s, count: counts.count, ids: counts.documents.map((d) => d[0]), documents: counts.documents };
} else if (cfg.action === "scan-export") {
  out = scan(cfg.exportDir);
} else if (cfg.action === "prepare-stage") {
  const old = validStage();
  fs.mkdirSync(stage, { recursive: true, mode: 0o700 }); fs.chmodSync(stage, 0o700);
  if (!old) write(marker, { source: cfg.source, phase: "staging" });
  for (const name of ["export", "state"]) {
    if (fs.existsSync(path.join(stage, name)) && fs.lstatSync(path.join(stage, name)).isSymbolicLink()) throw new Error("staging contains a symbolic link");
    fs.rmSync(path.join(stage, name), { recursive: true, force: true });
    fs.mkdirSync(path.join(stage, name), { recursive: true, mode: 0o700 });
  }
  out = { prepared: true };
} else if (cfg.action === "target-scan") {
  validStage(); out = scan(path.join(stage, "export"));
} else if (cfg.action === "target-apply") {
  const m = validStage(), h = host();
  if (service()) throw new Error("new Clerk worker is active");
  const s = scan(path.join(stage, "export"));
  if (s.manifest !== cfg.manifest || s.version !== cfg.version || JSON.stringify(s.files) !== JSON.stringify(cfg.files)) throw new Error("staged export changed after verification");
  if (!isTested(s.version) || h.rec.version !== s.version) throw new Error("Paperless version mismatch; install the tested matching version");
  walk(path.join(stage, "state"));
  let held;
  try { held = Object.values(h.owners()).reduce((a, b) => a + b, 0); }
  catch (e) { if (m.phase !== "importing") throw e; held = 0; }
  if (held && !(m.phase === "importing" || m.phase === "imported" || m.phase === "complete") ) throw new Error("new Paperless is not empty");
  if (held && (!Array.isArray(m.ids) || targetIds(h).some((id) => !m.ids.includes(id)))) throw new Error("new Paperless has a paper outside this migration; it will not be reset");
  if (m.phase === "complete" && m.manifest === s.manifest && held === cfg.count && h.filesCheck().bad.length === 0) { out = { count: held, resumed: true }; }
  else {
    if (!fs.existsSync(path.join(stage, "original-state"))) fs.cpSync(state, path.join(stage, "original-state"), { recursive: true, force: false });
    write(marker, { source: cfg.source, phase: "importing", manifest: s.manifest, ids: cfg.ids });
    h.must(h.down(), "stopping the empty new Paperless");
    for (const name of ["pg", "paperless", "media", "redis"]) {
      fs.rmSync(h.file("data", name), { recursive: true, force: true });
      fs.mkdirSync(h.file("data", name), { recursive: true });
    }
    // postgres:18 runs as uid 999 and cannot initialize a root-owned 0700 directory.
    run("chown", ["999:999", h.file("data", "pg")]);
    fs.rmSync(h.file("export"), { recursive: true, force: true });
    fs.cpSync(path.join(stage, "export"), h.file("export"), { recursive: true });
    run("chown", ["-R", "1000:1000", h.file("export")]);
    h.setImage(imageFor(s.version)); h.up();
    if (!(await h.waitUp({ timeoutMs: 15 * 60 * 1000 }))) throw new Error("new Paperless did not start");
    h.importNow();
    const check = h.filesCheck();
    if (check.n !== cfg.count || check.bad.length) throw new Error("imported document count or files differ from source");
    const ids = targetIds(h);
    if (JSON.stringify(ids) !== JSON.stringify(cfg.ids)) throw new Error("imported document IDs differ from source");
    if (h.reindex().status !== 0) throw new Error("Paperless search index could not be rebuilt");
    if (h.thumbnails().status !== 0) throw new Error("Paperless document previews could not be rebuilt");
    write(marker, { source: cfg.source, phase: "imported", manifest: s.manifest, ids: cfg.ids });
    const from = path.join(stage, "state");
    for (const name of ["records", "settings.json", "plan.json", "mirror.json", "links.json", "drive-tree.json", "drive-tree-position.json", "drive.json", "google-client.json", "state.json", "outbox.jsonl", "restore-index.json"]) {
      const p = path.join(from, name), to = path.join(state, name);
      if (fs.existsSync(p)) {
        fs.rmSync(to, { recursive: true, force: true });
        fs.cpSync(p, to, { recursive: true });
        if (fs.statSync(to).isFile()) fs.chmodSync(to, 0o600);
      }
    }
    fs.chmodSync(state, 0o700);
    const sourcePaperless = read(path.join(from, "paperless.json"));
    if (!sourcePaperless?.user) throw new Error("staged Clerk state has no Paperless user");
    const original = read(path.join(stage, "original-state", "settings.json"), {});
    const settings = read(path.join(state, "settings.json"), {});
    for (const key of ["workspace", "telegram_env", "talk"]) if (original[key] !== undefined) settings[key] = original[key];
    settings.paperless_web = h.rec.address;
    settings.copy_id = original.copy_id || null;
    settings.active = false;
    write(path.join(state, "settings.json"), settings);
    const runState = read(path.join(state, "state.json"), {});
    runState.phone = { shown_at: new Date().toISOString() };
    write(path.join(state, "state.json"), runState);
    const tok = h.token(sourcePaperless.user);
    write(path.join(state, "paperless.json"), { url: "http://127.0.0.1:" + h.rec.port, user: sourcePaperless.user, token: tok.token, user_id: tok.id, version: s.version, connected_at: new Date().toISOString() });
    write(path.join(state, "login.json"), { user: sourcePaperless.user, address: h.rec.address, migrated_at: new Date().toISOString() });
    h.rec.user = sourcePaperless.user; h.rec.version = s.version; h.rec.image = imageFor(s.version); h.save(h.rec);
    write(marker, { source: cfg.source, phase: "complete", manifest: s.manifest, ids: cfg.ids });
    out = { count: check.n, resumed: false };
  }
} else if (cfg.action === "reconcile") {
  const m = validStage(), h = host();
  if (m.phase !== "complete" || service()) throw new Error("import is incomplete or new Clerk worker is active");
  const { statePaths } = await import(app + "/lib/core/paths.mjs");
  const { buildContext } = await import(app + "/lib/core/context.mjs");
  const { runOnce } = await import(app + "/lib/core/run.mjs");
  const paths = statePaths(state);
  const existing = () => fs.readdirSync(paths.records).filter((n) => n.endsWith(".json")).map((n) => read(path.join(paths.records, n))).filter(Boolean);
  const deadlineKeys = (r) => (r.asks?.items || []).filter((i) => i.made).map((i) => [r.sum, i.n]);
  const before = new Map(existing().map((r) => [r.id, { note: r.note?.id || null, item: r.item?.id || null, deadlines: deadlineKeys(r) }]));
  let last = null;
  let settled = false;
  for (let i = 0; i < 20; i++) {
    const ctx = buildContext(paths, { steps: ["note"] });
    ctx.settings.active = true; // one run only; the saved setting and service stay paused
    last = await runOnce(ctx);
    if (last.notes.some((s) => /notebook.*(not answer|stopped answering|wait)/i.test(s))) throw new Error("the new Godspeed notebook did not answer; old Clerk remains the fallback");
    if (last.noted === 0 && last.items === 0 && last.deadlines === 0 && last.notes_waiting === 0) { settled = true; break; }
  }
  if (!settled) throw new Error("notebook reconciliation did not finish; rerun --apply after checking the notebook");
  const after = existing();
  for (const r of after) {
    const was = before.get(r.id);
    if (!was) continue;
    if (was.note && r.note?.id !== was.note) throw new Error("an existing note changed identity");
    if (was.item && r.item?.id !== was.item) throw new Error("an existing Documents item changed identity");
    if (was.deadlines.some((old) => !deadlineKeys(r).some((now) => JSON.stringify(now) === JSON.stringify(old)))) throw new Error("an existing deadline changed identity");
  }
  const ctx = buildContext(paths, { steps: ["note"] });
  let checkedNotes = 0, checkedItems = 0;
  for (const r of after) {
    if (r.note?.id && !r.note.deleted && !r.note.kept_out) {
      const note = await ctx.notebook.note(r.note.id);
      if (!note || !note.content?.includes(h.rec.address + "/documents/")) throw new Error("an existing note does not link to the new Paperless");
      checkedNotes++;
    }
    if (r.item?.id && r.sum) {
      const coll = read(paths.state, {}).collection?.id;
      if (coll) {
        const item = await ctx.notebook.item(coll, r.sum);
        if (!item || item.id !== r.item.id) throw new Error("an existing Documents item changed identity");
        if (!item.data?.paperless?.startsWith(h.rec.address + "/documents/")) throw new Error("a Documents item still links to the old Paperless");
        checkedItems++;
      }
    }
  }
  out = { count: after.length, notes: checkedNotes, items: checkedItems, waiting: last?.notes_waiting || 0 };
} else throw new Error("unknown remote action");
process.stdout.write("MIGRATION " + JSON.stringify(out) + "\n");
`;

export function parse(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check" || a === "--apply") { if (args.mode) throw new Error("choose --check or --apply"); args.mode = a; continue; }
    if (!["--source", "--target", "--source-compose", "--source-state", "--source-export", "--target-state", "--staging"].includes(a) || !argv[i + 1]) throw new Error("unknown or incomplete argument: " + a);
    args[a.slice(2)] = argv[++i];
  }
  if (!args.mode || !args.source || !args.target || args.source === args.target) throw new Error("use --check or --apply with distinct --source and --target SSH aliases");
  for (const host of [args.source, args.target]) if (!/^[a-zA-Z0-9._-]+$/.test(host)) throw new Error("SSH aliases may contain only letters, digits, dots, dashes and underscores");
  args["source-compose"] ||= "/opt/paperless-ngx/docker-compose.yml";
  args["source-state"] ||= "/var/lib/godspeed/clerk";
  args["source-export"] ||= "/opt/paperless-ngx/export";
  args["target-state"] ||= "/var/lib/godspeed/clerk";
  args.staging ||= "/var/lib/godspeed/clerk-migration";
  for (const key of ["source-compose", "source-state", "source-export", "target-state", "staging"]) if (!/^\/[a-zA-Z0-9_./-]+$/.test(args[key]) || args[key].includes("..")) throw new Error("unsafe path for " + key);
  if (!args.staging.startsWith("/var/lib/godspeed/") || args.staging === "/var/lib/godspeed/") throw new Error("staging must be under /var/lib/godspeed");
  return args;
}

export function sameFiles(a, b) {
  return a.version === b.version && a.manifest === b.manifest && JSON.stringify(a.files) === JSON.stringify(b.files);
}

export const remoteCode = (cfg) => REMOTE.replace("__CONFIG__", JSON.stringify(cfg));

function ssh(host, cfg, timeout = 12 * 60 * 1000) {
  const code = remoteCode(cfg);
  const r = spawnSync("ssh", ["-T", "-o", "BatchMode=yes", host, "node --input-type=module -"], { input: code, encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    const lines = (r.stderr || "remote command failed").trim().split("\n").filter(Boolean);
    throw new Error(host + ": " + (lines.find((s) => /^Error: /.test(s)) || lines.slice(0, 3).join(" ")).slice(0, 350));
  }
  const line = r.stdout.split("\n").find((s) => s.startsWith("MIGRATION "));
  if (!line) throw new Error(host + " gave no migration result");
  return JSON.parse(line.slice(10));
}

function quote(s) { return "'" + s.replace(/'/g, "'\\''") + "'"; }
async function transfer(source, from, target, to) {
  const reader = spawn("ssh", ["-T", "-o", "BatchMode=yes", source, `tar -C ${quote(from)} -cf - .`], { stdio: ["ignore", "pipe", "pipe"] });
  const writer = spawn("ssh", ["-T", "-o", "BatchMode=yes", target, `tar -C ${quote(to)} -xf -`], { stdio: ["pipe", "ignore", "pipe"] });
  reader.stderr.resume(); writer.stderr.resume();
  // A failed destination closes stdin before the reader finishes. Drain the
  // stream error so the migration can report the failed transfer and resume.
  writer.stdin.on("error", () => {});
  reader.stdout.pipe(writer.stdin);
  const done = (p) => new Promise((resolve, reject) => { p.on("error", reject); p.on("close", resolve); });
  const [readCode, writeCode] = await Promise.all([done(reader), done(writer)]);
  if (readCode !== 0 || writeCode !== 0) throw new Error("secure transfer was interrupted; rerun --apply to start the stage again");
}

export async function migrate(args, { remote = ssh, copy = transfer, log = console.log } = {}) {
  const source = { source: args.source, state: args["source-state"], compose: args["source-compose"], exportDir: args["source-export"] };
  const target = { source: args.source, state: args["target-state"], stage: args.staging };
  const before = remote(args.source, { ...source, action: "source-preflight" });
  const dest = remote(args.target, { ...target, action: "target-preflight" });
  if (before.version !== dest.version) throw new Error("source and new Paperless versions differ; no server was changed");
  if (dest.count && !dest.staged) throw new Error("new Paperless is not empty");
  if (args.mode === "--check") {
    log(`Ready to stage ${before.count} papers; new Paperless has ${dest.count}. Old Clerk ${before.active ? "active" : "paused"}; new Clerk paused.`);
    return { source: before, target: dest };
  }
  let stopped = false;
  let stoppedTarget = false;
  try {
    if (dest.serviceActive) { remote(args.target, { ...target, action: "stop-target" }); stoppedTarget = true; }
    if (before.active) { remote(args.source, { ...source, action: "stop-source" }); stopped = true; }
    const exported = remote(args.source, { ...source, action: "source-export" });
    if (exported.count !== before.count || JSON.stringify(exported.documents) !== JSON.stringify(before.documents)) throw new Error("source changed during export; old Clerk will be resumed");
    if (!exported.version || exported.version !== dest.version) throw new Error("Paperless versions differ; no import was started");
    const bytes = exported.files.reduce((n, f) => n + f[1], 0);
    if (dest.free < bytes * 2 + 1024 * 1024 * 1024) throw new Error("new server has insufficient free space for the export and import");
    remote(args.target, { ...target, action: "prepare-stage" });
    await copy(args.source, args["source-export"], args.target, path.posix.join(args.staging, "export"));
    await copy(args.source, args["source-state"], args.target, path.posix.join(args.staging, "state"));
    const staged = remote(args.target, { ...target, action: "target-scan" });
    if (!sameFiles(exported, staged)) throw new Error("copied export differs from source; no import was started");
    const imported = remote(args.target, { ...target, action: "target-apply", manifest: exported.manifest, version: exported.version, files: exported.files, count: exported.count, ids: exported.ids }, 30 * 60 * 1000);
    const after = remote(args.source, { ...source, action: "source-preflight" });
    if (after.count !== exported.count || JSON.stringify(after.documents) !== JSON.stringify(exported.documents)) throw new Error("source papers changed during the move; keep the new Clerk paused and rerun the move");
    const reconciled = remote(args.target, { ...target, action: "reconcile" }, 30 * 60 * 1000);
    const finalSource = remote(args.source, { ...source, action: "source-preflight" });
    if (finalSource.count !== exported.count || JSON.stringify(finalSource.documents) !== JSON.stringify(exported.documents)) throw new Error("source papers changed during notebook reconciliation; keep the new Clerk paused and rerun the move");
    if (stoppedTarget) { remote(args.target, { ...target, action: "resume-target" }); stoppedTarget = false; }
    log(`Moved and checked ${imported.count} papers, ${reconciled.notes} notes and ${reconciled.items} Documents links. The old Clerk is paused; the new Clerk remains paused. Verify one phone scan before retiring the VPS.`);
    return { source: finalSource, target: imported, notebook: reconciled };
  } catch (error) {
    if (stopped) { try { remote(args.source, { ...source, action: "resume-source" }); } catch { /* report original error, and operator checks source worker */ } }
    if (stoppedTarget) { try { remote(args.target, { ...target, action: "resume-target" }); } catch { /* original error remains primary */ } }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await migrate(parse(process.argv.slice(2))); }
  catch (e) { console.error(`Migration stopped: ${e.message}`); process.exitCode = 1; }
}
