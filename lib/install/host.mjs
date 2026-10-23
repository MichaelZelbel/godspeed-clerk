// The Paperless the Clerk installed (F1, F3, F9): its folder, its programs in Docker, and what only
// the Clerk may do with a Paperless it installed itself: make the person's account, switch the
// second factor on, keep it running, update it, export it, rebuild it. A Paperless the Clerk did
// not install is never reached this way: there is no record of it (installed.json), so none of this
// runs, and the Clerk reaches it only through its API (paperless.mjs).
//
// THE FOLDER (/opt/godspeed-clerk/paperless, root only): compose.yaml and paperless.env
// (stack.mjs), data/pg (the database), data/paperless (its search index and settings), data/media
// (the documents), export/ (the nightly export), backups/ (what an update keeps).
//
// AN UPDATE (F3), only to a tested version: the caller has taken a fresh restore copy; the new
// image is pulled while the old one runs; then Paperless stops, the database folder, the search
// index folder, compose.yaml, paperless.env and the version are copied aside; the new version
// starts and runs its migrations. Healthy means: its API answers with the new version, sees as
// many documents as before, and a document downloads. Not healthy within ten minutes: it stops,
// everything copied aside is put back, the old version starts and is checked the same way.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { PROJECT, composeText, envText, newSecrets } from "./stack.mjs";
import { imageFor, versionOfImage } from "./versions.mjs";
import { starterTags } from "./starter.mjs";
import { newSecret, totp } from "./totp.mjs";

export const INSTALL_DIR = "/opt/godspeed-clerk/paperless";
const MIN = 60000;

export function sh(cmd, args, { input, timeoutMs = 30 * MIN } = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", input, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.error ? 127 : r.status, stdout: r.stdout || "", stderr: r.stderr || (r.error ? r.error.message : "") };
}

// A password a person can type on a phone: five groups of four small letters and digits, no
// letters that look alike (about 99 bits).
export function newPassword() {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = crypto.randomBytes(20);
  return Array.from({ length: 5 }, (_, g) => Array.from({ length: 4 }, (_, i) => a[b[g * 4 + i] % a.length]).join("")).join("-");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Host {
  // rec: installed.json ({ dir, project, port, version, image, ... }).
  constructor(rec, { run = sh, fetchImpl = globalThis.fetch, wait = sleep, log = () => {}, clock = Date.now } = {}) {
    this.rec = rec;
    this.run = run;
    this.fetch = fetchImpl;
    this.wait = wait;
    this.log = log;
    this.clock = clock;
  }
  get dir() { return this.rec.dir; }
  get base() { return `http://127.0.0.1:${this.rec.port}/api`; }
  file(...p) { return path.join(this.dir, ...p); }

  dc(args, opts) { return this.run("docker", ["compose", "-f", this.file("compose.yaml"), "-p", this.rec.project || PROJECT, ...args], opts); }
  must(r, what) { if (r.status !== 0) throw new HostError(`${what} failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ")}`); return r; }

  // Python inside Paperless (manage.py shell), the answer on a line "CLERK <json>". What it needs
  // that must not be on a command line (a password) goes in on standard input.
  shell(code, input = "") {
    const r = this.must(this.dc(["exec", "-T", "webserver", "python3", "manage.py", "shell", "-c", code], { input }), "Paperless's shell");
    const line = r.stdout.split("\n").reverse().find((l) => l.startsWith("CLERK "));
    if (!line) throw new HostError("Paperless's shell gave no answer");
    return JSON.parse(line.slice(6));
  }

  // ---------------------------------------------------------------- the files
  writeFiles({ image, port, url, host, ocr, timezone, clerkVersion, secrets }) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.dir, 0o700);
    for (const d of ["data/pg", "data/paperless", "data/media", "data/redis", "export", "consume", "backups"]) fs.mkdirSync(this.file(d), { recursive: true });
    fs.writeFileSync(this.file("compose.yaml"), composeText({ image, port, url, host, ocr, timezone, clerkVersion }), { mode: 0o600 });
    if (secrets) {
      fs.writeFileSync(this.file("paperless.env"), envText(secrets), { mode: 0o600 });
      fs.chmodSync(this.file("paperless.env"), 0o600);
    }
  }
  setImage(image) {
    const p = this.file("compose.yaml");
    const t = fs.readFileSync(p, "utf8");
    const next = t.replace(/^(    image: )ghcr\.io\/paperless-ngx\/paperless-ngx:\S+$/m, `$1${image}`);
    if (next === t && !t.includes(image)) throw new HostError("compose.yaml names no Paperless image");
    fs.writeFileSync(p, next, { mode: 0o600 });
  }
  imageInFile() { return (fs.readFileSync(this.file("compose.yaml"), "utf8").match(/^    image: (ghcr\.io\/paperless-ngx\/paperless-ngx:\S+)$/m) || [])[1] || null; }

  // ---------------------------------------------------------------- running
  pull(image) { return this.must(this.run("docker", ["pull", "-q", image]), `downloading ${image}`); }
  up() { return this.must(this.dc(["up", "-d", "--remove-orphans"]), "starting Paperless"); }
  stop() { return this.must(this.dc(["stop"]), "stopping Paperless"); }
  down() { return this.dc(["down", "--remove-orphans"]); }

  async status(token) {
    try {
      const r = await this.fetch(`${this.base}/ui_settings/`, { headers: token ? { Authorization: `Token ${token}`, Accept: "application/json" } : { Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(15000) });
      if (!token) return { up: r.status === 401 || r.status === 403 };
      if (!r.ok) return { up: r.status === 401 || r.status === 403, status: r.status };
      const j = await r.json();
      return { up: true, version: String(j.settings?.version || "").replace(/^v/i, "") };
    } catch (e) { return { up: false, why: e.cause?.code || e.message }; }
  }
  async waitUp({ timeoutMs = 10 * MIN, everyMs = 3000 } = {}) {
    const until = this.clock() + timeoutMs;
    for (;;) {
      if ((await this.status()).up) return true;
      if (this.clock() > until) return false;
      await this.wait(everyMs);
    }
  }
  async count(token) {
    const r = await this.fetch(`${this.base}/documents/?page_size=1&fields=id&ordering=-id`, { headers: { Authorization: `Token ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new HostError(`Paperless answered ${r.status} to the document list`);
    const j = await r.json();
    return { n: j.count ?? 0, last: j.results?.[0]?.id ?? null };
  }
  // Healthy: the API answers with this version, sees `docs` documents, and a document downloads.
  async healthy({ token, version, docs }) {
    const s = await this.status(token);
    if (!s.up || s.version !== version) return { ok: false, why: s.up ? `it answers as ${s.version || "an unknown version"}` : "it does not answer" };
    const c = await this.count(token);
    if (c.n !== docs) return { ok: false, why: `it sees ${c.n} documents, not ${docs}` };
    if (c.last) {
      const d = await this.fetch(`${this.base}/documents/${c.last}/download/`, { headers: { Authorization: `Token ${token}` }, signal: AbortSignal.timeout(60000) });
      const b = d.ok ? Buffer.from(await d.arrayBuffer()) : null;
      if (!b?.length) return { ok: false, why: `document ${c.last} does not download (${d.status})` };
    }
    return { ok: true };
  }
  async waitHealthy(want, { timeoutMs = 10 * MIN, everyMs = 5000 } = {}) {
    const until = this.clock() + timeoutMs;
    let last = { ok: false, why: "not checked" };
    for (;;) {
      try { last = await this.healthy(want); } catch (e) { last = { ok: false, why: e.message }; }
      if (last.ok || this.clock() > until) return last;
      await this.wait(everyMs);
    }
  }

  // ---------------------------------------------------------------- the account
  account(user, password) {
    return this.shell(`import sys, json
from django.contrib.auth.models import User
name = sys.stdin.readline().strip(); pw = sys.stdin.readline().rstrip("\\n")
u, made = User.objects.get_or_create(username=name)
if made:
    u.is_superuser = True; u.is_staff = True; u.set_password(pw); u.save()
print("CLERK " + json.dumps({"id": u.id, "made": made}))`, `${user}\n${password}\n`);
  }
  setPassword(user, password) {
    return this.shell(`import sys, json
from django.contrib.auth.models import User
u = User.objects.get(username=sys.stdin.readline().strip()); u.set_password(sys.stdin.readline().rstrip("\\n")); u.save()
print("CLERK " + json.dumps({"id": u.id}))`, `${user}\n${password}\n`);
  }
  // The account's one token: the one it has, made only when it has none, so a phone already
  // signed in stays signed in (PRD section 12).
  token(user) {
    return this.shell(`import sys, json
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
u = User.objects.get(username=sys.stdin.readline().strip())
t, made = Token.objects.get_or_create(user=u)
print("CLERK " + json.dumps({"token": t.key, "id": u.id}))`, `${user}\n`);
  }
  // Who owns the documents, by account name ("" for none), the bin included (F9).
  owners() {
    return this.shell(`import json
from django.db.models import Count
from documents.models import Document
rows = Document.global_objects.values("owner__username").annotate(n=Count("id"))
print("CLERK " + json.dumps({ (r["owner__username"] or ""): r["n"] for r in rows }))`);
  }

  async api(method, p, token, body) {
    const r = await this.fetch(`${this.base}/${p}`, { method, headers: { Authorization: `Token ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    let j = null;
    try { j = t ? JSON.parse(t) : null; } catch { /* below */ }
    if (!r.ok) throw new HostError(`Paperless answered ${r.status} to ${method} ${p}: ${t.slice(0, 160)}`);
    return j;
  }

  // The second factor, switched on by the installer itself: a new secret, the code it gives now,
  // Paperless checks it and answers with recovery codes. Nothing when it is on already.
  async secondFactor(token) {
    const p = await this.api("GET", "profile/", token);
    if (p?.is_mfa_enabled) return { already: true };
    for (let attempt = 0; attempt < 2; attempt++) {
      const secret = newSecret();
      const r = await this.api("POST", "profile/totp/", token, { secret, code: totp(secret, { time: this.clock() }) });
      if (r?.success) return { secret, recovery: r.recovery_codes || [] };
      await this.wait(2000); // a code made on the edge of its 30 seconds
    }
    throw new HostError("Paperless did not accept the second factor's code");
  }

  // The starter set, only into a Paperless that has no documents; what is there already stays.
  async starter(token, s, year) {
    const have = async (p) => new Set((await this.api("GET", `${p}?page_size=1000&fields=name`, token)).results.map((x) => x.name.toLowerCase()));
    const types = await have("document_types/"), tags = await have("tags/");
    let made = 0;
    for (const name of s.types) if (!types.has(name.toLowerCase())) { await this.api("POST", "document_types/", token, { name, matching_algorithm: 0 }); made++; }
    for (const t of starterTags(s, year)) if (!tags.has(t.name.toLowerCase())) { await this.api("POST", "tags/", token, { name: t.name, matching_algorithm: 0, is_inbox_tag: !!t.is_inbox_tag }); made++; }
    return made;
  }

  // ---------------------------------------------------------------- export and import (F9)
  exportNow() {
    return this.must(this.dc(["exec", "-T", "webserver", "document_exporter", "/usr/src/paperless/export", "--no-progress-bar", "-d", "-c", "-nt", "-p"]), "Paperless's export");
  }
  importNow() {
    return this.must(this.dc(["exec", "-T", "webserver", "document_importer", "/usr/src/paperless/export", "--no-progress-bar"]), "Paperless's import");
  }

  // ---------------------------------------------------------------- an update (F3)
  copyAside(to) {
    fs.mkdirSync(to, { recursive: true, mode: 0o700 });
    for (const d of ["pg", "paperless"]) this.must(this.run("cp", ["-a", this.file("data", d), path.join(to, d)]), `copying ${d} aside`);
    for (const f of ["compose.yaml", "paperless.env"]) fs.copyFileSync(this.file(f), path.join(to, f));
    fs.writeFileSync(path.join(to, "version.json"), JSON.stringify({ version: this.rec.version, image: this.rec.image, at: new Date(this.clock()).toISOString() }) + "\n", { mode: 0o600 });
  }
  putBack(from) {
    for (const d of ["pg", "paperless"]) {
      this.must(this.run("rm", ["-rf", this.file("data", d)]), `removing the new ${d}`);
      this.must(this.run("cp", ["-a", path.join(from, d), this.file("data", d)]), `putting ${d} back`);
    }
    for (const f of ["compose.yaml", "paperless.env"]) { fs.copyFileSync(path.join(from, f), this.file(f)); fs.chmodSync(this.file(f), 0o600); }
  }
  pruneBackups(keep = 2) {
    let names = [];
    try { names = fs.readdirSync(this.file("backups")).filter((n) => n.startsWith("before-")).sort(); } catch { return; }
    for (const n of names.slice(0, Math.max(0, names.length - keep))) this.run("rm", ["-rf", this.file("backups", n)]);
  }

  // Returns { ok, from, to, why, backup, rolledBack }. `failAfterStart` (tests only) declares the new
  // version unhealthy after it started and ran its migrations.
  async update({ to, image = imageFor(to), token, failAfterStart = false, timeoutMs = 10 * MIN }) {
    const from = this.rec.version;
    let docs;
    try { docs = (await this.count(token)).n; } catch (e) { return { ok: false, from, to, why: `Paperless ${from} is not healthy before the update (${e.cause?.code || e.message}); nothing was changed` }; }
    const before = await this.waitHealthy({ token, version: from, docs }, { timeoutMs: 2 * MIN });
    if (!before.ok) return { ok: false, from, to, why: `Paperless ${from} is not healthy before the update (${before.why}); nothing was changed` };
    this.log(`update: downloading Paperless ${to}`);
    try { this.pull(image); } catch (e) { return { ok: false, from, to, why: `${e.message}; nothing was changed` }; }
    const backup = this.file("backups", `before-${to}-${new Date(this.clock()).toISOString().replace(/[:.]/g, "-")}`);
    this.stop();
    try { this.copyAside(backup); } catch (e) { this.up(); return { ok: false, from, to, why: `${e.message}; Paperless ${from} runs on unchanged` }; }
    this.log(`update: Paperless ${from} stopped and copied aside (${backup}); starting ${to}`);
    let result;
    try {
      this.setImage(image);
      this.up();
      result = await this.waitHealthy({ token, version: to, docs }, { timeoutMs });
      if (result.ok && failAfterStart) result = { ok: false, why: "the test made this update fail after the new version had started" };
    } catch (e) { result = { ok: false, why: e.message }; }
    if (result.ok) {
      Object.assign(this.rec, { version: to, image, updated_at: new Date(this.clock()).toISOString() });
      this.pruneBackups();
      this.log(`update: Paperless ${to} runs, ${docs} documents`);
      return { ok: true, from, to, backup };
    }
    this.log(`update: Paperless ${to} is not healthy (${result.why}); putting ${from} back`);
    this.down();
    this.putBack(backup);
    this.up();
    const back = await this.waitHealthy({ token, version: from, docs }, { timeoutMs });
    this.log(back.ok ? `update: Paperless ${from} runs again as before, ${docs} documents` : `update: Paperless ${from} did not come back (${back.why}); the copy is in ${backup}`);
    return { ok: false, from, to, why: result.why, backup, rolledBack: back.ok, back: back.why };
  }
}

export class HostError extends Error {
  constructor(message) { super(message); this.name = "HostError"; }
}

export const versionOf = (rec) => rec.version || versionOfImage(rec.image);

// What the installer writes before the first start, and every value it decided.
export function newRecord({ dir = INSTALL_DIR, version, port, host, httpsPort, front, language, chatLanguage, user, clerkVersion, timezone }) {
  return { format: 1, dir, project: PROJECT, version, image: imageFor(version), port, host, https_port: httpsPort, address: `https://${host}:${httpsPort}`, front, language, chat_language: chatLanguage, user, timezone, clerk_version: clerkVersion, installed_at: new Date().toISOString(), stage: "files" };
}

export { newSecrets };
