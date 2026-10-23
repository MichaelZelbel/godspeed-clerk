#!/usr/bin/env node
// The machine test (F1, F2, F3, F9 on fresh machines; test/machine/README.md). Every machine is a
// fresh Linux server with Docker (machine.sh), with a stand-in Godspeed on it (godspeed.sh), and the
// Clerk comes onto it the way a person adds it: the install line. What outlives a machine runs here
// on the test host: a pretend Google Drive, the real Godspeed notebook (a product checkout), a
// pretend Telegram, and the files the install line downloads.
//
//   A  all defaults: Paperless over HTTPS with a second factor, the starter set, the copy scheduled;
//      the drive and the plan; the phone signs in like Swift Paperless and uploads made-up scans,
//      which are sorted, filed, noted and reported; Godspeed's Caddyfile rewritten by an update and
//      put back; the restore copy; a second account's paper stops the export.
//   B  thrown-away A rebuilt on a fresh machine from the drive: same version first, every document,
//      title, tag and date, the plan; the phone signs in with the same login; no second file,
//      note, item or deadline.
//   C  Paperless 3.2.1, German: the German starter set; an update to 3.3.3 forced to fail after the
//      new version migrated the database ends on 3.2.1 with its database and every document
//      readable; then the update; a stopped Paperless runs again on the next check.
//   D  1 GB of memory: the installer stops before installing and names it.
//
//   GODSPEED_NOTEBOOK_CHECKOUT=<product checkout> node test/machine/e2e.mjs
//   E2E_ONLY=a,b   only those parts (b needs a);  E2E_KEEP=1   keep the last machine
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { startFakeDrive, TEST_CLIENT } from "../fakes/drive.mjs";
import { totp } from "../../lib/install/totp.mjs";
import { STARTERS } from "../../lib/install/starter.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MACHINE = path.join(ROOT, "test", "machine");
const WORK = path.join(MACHINE, ".work");
const PRODUCT = process.env.GODSPEED_NOTEBOOK_CHECKOUT;
if (!PRODUCT) { console.error("GODSPEED_NOTEBOOK_CHECKOUT: a checkout of the Godspeed product"); process.exit(2); }
const HOST = "10.89.0.1";
const ONLY = new Set((process.env.E2E_ONLY || "a,b,c,d").split(","));
const KIT = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "kit", "kit.json"), "utf8"));
const RENDERED = path.join(ROOT, "test", "kit", "rendered");
const expected = (slug) => JSON.parse(fs.readFileSync(path.join(ROOT, "test", "kit", "expected", `${slug}.json`), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");

let failures = 0, passes = 0;
function check(ok, what) { if (ok) { passes++; console.log(`  ok    ${what}`); } else { failures++; console.log(`  FAIL  ${what}`); } }
const section = (s) => console.log(`\n== ${s}`);
const note = (s) => console.log(`        ${s}`);

// Every command runs as a child process the event loop waits for, never synchronously: the
// services the machines talk to (the drive, the files, Telegram) live in this process and must
// keep answering while a machine works.
function sh(cmd, args, { env, input, timeout = 30 * 60000 } = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { env: env ? { ...process.env, ...env } : process.env });
    let out = "", err = "";
    c.stdout.setEncoding("utf8"); c.stderr.setEncoding("utf8");
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => c.kill("SIGKILL"), timeout);
    c.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? 1, out, err, all: `${out}\n${err}` }); });
    c.on("error", (e) => { clearTimeout(t); resolve({ code: 127, out, err: String(e), all: String(e) }); });
    c.stdin.on("error", () => {});
    c.stdin.end(input ?? "");
  });
}
const machine = (...a) => sh("bash", [path.join(MACHINE, "machine.sh"), ...a], { env: { GODSPEED_NOTEBOOK_CHECKOUT: PRODUCT } });
const IPS = { a: "10.89.0.10", b: "10.89.0.11", c: "10.89.0.12", d: "10.89.0.13" }; // as machine.sh gives them
const ipOf = (m) => IPS[m];
function inM(m, script, { env = {}, input, timeout } = {}) {
  const e = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return sh("docker", ["exec", "-i", ...e, `clerk-${m}`, "bash", "-lc", script], { input, timeout });
}

// ------------------------------------------------------------------ what outlives a machine
const S = {};
async function startServices() {
  fs.mkdirSync(WORK, { recursive: true });
  S.drives = {
    main: await startFakeDrive({ tree: KIT.drive.tree, account: KIT.drive.account, host: HOST, port: 48900 }),
    other: await startFakeDrive({ tree: { Papers: {} }, account: "kim@example.test", host: HOST, port: 48910 }),
  };
  // The notebook: the product's own, in a folder of its own, on the test network only.
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-e2e-notebook-")), home = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-e2e-home-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GODSPEED_|HERMES_)/i.test(k)));
  // On 127.0.0.1, its local door, as on a person's server; the machines reach it through a plain
  // forward on the test network (the notebook refuses any other address without an access token).
  Object.assign(env, { GODSPEED_WORKSPACE: ws, GODSPEED_PORT: "48911", GODSPEED_BIND: "127.0.0.1", GODSPEED_FOOD_TABLE: "off", HOME: home });
  const log = fs.openSync(path.join(home, "notebook.log"), "a");
  S.nbChild = spawn(process.execPath, [path.join(PRODUCT, "notebook", "server", "main.mjs")], { env, stdio: ["ignore", log, log] });
  // (As its local door sees a request from this computer: Host 127.0.0.1, which the door insists on.)
  S.fwd = http.createServer((req, res) => {
    const up = http.request({ host: "127.0.0.1", port: 48911, method: req.method, path: req.url, headers: { ...req.headers, host: "127.0.0.1:48911" } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on("error", (e) => { res.writeHead(502); res.end(String(e.message)); });
    req.pipe(up);
  });
  await new Promise((r) => S.fwd.listen(48901, HOST, r));
  S.nb = `http://${HOST}:48901`;
  for (const until = Date.now() + 90000; ;) {
    try { if ((await fetch(`${S.nb}/health`)).ok) break; } catch { /* not yet */ }
    if (Date.now() > until) throw new Error(`the notebook did not start: ${fs.readFileSync(path.join(home, "notebook.log"), "utf8").slice(-600)}`);
    await sleep(500);
  }
  S.query = async (body) => { const r = await fetch(`${S.nb}/api/query`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok || j.error) throw new Error(`notebook: ${j.error}`); return j.data; };
  S.notes = () => S.query({ table: "notes", operation: "select", filters: [["eq", "source_app", "godspeed-clerk"]] });
  S.items = async () => { const c = await S.query({ table: "collections", operation: "select", filters: [["eq", "source_app", "godspeed-clerk"]] }); return c.length ? S.query({ table: "collection_items", operation: "select", filters: [["eq", "collection_id", c[0].id]] }) : []; };
  S.deadlines = async () => { const r = await fetch(`${S.nb}/api/functions/addon-deadlines`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addon: "godspeed-clerk", action: "list" }) }); return (await r.json()).data.deadlines; };
  // Telegram, pretend.
  S.sent = [];
  S.tg = http.createServer((req, res) => { let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => { if (/\/sendMessage$/.test(req.url)) S.sent.push(JSON.parse(raw || "{}").text); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, result: { message_id: S.sent.length } })); }); });
  await new Promise((r) => S.tg.listen(48902, HOST, r));
  // The install line's files.
  S.files = http.createServer((req, res) => {
    const f = { "/install.sh": path.join(ROOT, "install.sh"), "/godspeed-clerk.tar.gz": path.join(WORK, "godspeed-clerk.tar.gz") }[req.url];
    if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200); res.end(fs.readFileSync(f));
  });
  await new Promise((r) => S.files.listen(48903, HOST, r));
}
const serviceEnv = (drive) => ({
  GODSPEED_CLERK_DRIVE_API: drive.url, GODSPEED_CLERK_GOOGLE_AUTH_URL: `${drive.url}/o/oauth2/v2/auth`, GODSPEED_CLERK_GOOGLE_TOKEN_URL: `${drive.url}/token`,
  GODSPEED_CLERK_NOTEBOOK: S.nb, GODSPEED_CLERK_TELEGRAM_API: `http://${HOST}:48902`, NODE_EXTRA_CA_CERTS: "/opt/clerk-test/pebble-root.pem",
  GODSPEED_CLERK_TEST: "1", GODSPEED_CLERK_TODAY: "2026-10-22",
});
// The pretend services a machine's Clerk talks to, in its service.env (the worker) and for each command.
async function wire(m, drive) {
  const env = serviceEnv(drive);
  const text = Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  await inM(m, "mkdir -p /var/lib/godspeed/clerk && chmod 700 /var/lib/godspeed/clerk && cat > /var/lib/godspeed/clerk/service.env && chmod 600 /var/lib/godspeed/clerk/service.env", { input: text });
  return env;
}
const clerk = (m, args, env, more = {}) => inM(m, `godspeed-clerk ${args}`, { env: { ...env, ...more } });

// ------------------------------------------------------------------ the phone, over HTTPS
const CA = () => fs.readFileSync(path.join(WORK, "pebble-root.pem"));
function phone(m) {
  const ip = ipOf(m), name = `srv-${m}.clerk.test`;
  const req = (method, p, { body, headers = {}, raw = false } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const r = https.request({ host: ip, port: 48444, servername: name, path: p, method, ca: CA(), headers: { Host: `${name}:48444`, Accept: "application/json", ...(payload && !Buffer.isBuffer(body) ? { "Content-Type": "application/json" } : {}), ...(payload ? { "Content-Length": payload.length } : {}), ...headers } }, (x) => {
      const cert = x.socket.getPeerCertificate();
      const chunks = []; x.on("data", (c) => chunks.push(c));
      x.on("end", () => { const b = Buffer.concat(chunks); resolve({ status: x.statusCode, cert, body: raw ? b : (() => { try { return JSON.parse(b.toString()); } catch { return b.toString(); } })() }); });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
  return {
    req,
    async signIn(user, password, secret) { const r = await req("POST", "/api/token/", { body: { username: user, password, ...(secret ? { code: totp(secret) } : {}) } }); return r; },
    // As Swift Paperless uploads: a multipart form, the scan named by its time, today's date.
    async upload(tok, file, name, created) {
      const b = `----clerk${crypto.randomBytes(6).toString("hex")}`;
      const part = (k, v, fn) => Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"${fn ? `; filename="${fn}"\r\nContent-Type: application/pdf` : ""}\r\n\r\n`), Buffer.isBuffer(v) ? v : Buffer.from(String(v)), Buffer.from("\r\n")]);
      const body = Buffer.concat([part("document", fs.readFileSync(file), name), part("created", created), Buffer.from(`--${b}--\r\n`)]);
      return req("POST", "/api/documents/post_document/", { body, headers: { Authorization: `Token ${tok}`, "Content-Type": `multipart/form-data; boundary=${b}` } });
    },
    async all(tok, p) { let r = await req("GET", p, { headers: { Authorization: `Token ${tok}` } }); const out = [...(r.body.results || [])]; while (r.body.next) { const n = new URL(r.body.next); r = await req("GET", `${n.pathname}${n.search}`, { headers: { Authorization: `Token ${tok}` } }); out.push(...(r.body.results || [])); } return out; },
    async waitTasks(tok, ids) {
      for (const id of ids) for (const until = Date.now() + 10 * 60000; ;) {
        const t = (await req("GET", `/api/tasks/?task_id=${id}`, { headers: { Authorization: `Token ${tok}` } })).body;
        const s = String((Array.isArray(t) ? t : t.results || [])[0]?.status || "").toLowerCase();
        if (s === "success") break;
        if (s === "failure" || Date.now() > until) throw new Error(`the upload ${id} was not read (${s})`);
        await sleep(2000);
      }
    },
  };
}
const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
async function uploadKit(p, tok, slugs, first = 1) {
  const ids = [];
  let n = first;
  for (const s of slugs) {
    const r = await p.upload(tok, path.join(RENDERED, `${s}.pdf`), `Scan ${today} 16-17-${String(n++).padStart(2, "0")}.pdf`, today);
    const id = typeof r.body === "string" ? r.body : r.body?.task_id;
    if (r.status !== 200 || !id) throw new Error(`the upload of ${s} was refused: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    ids.push(id);
  }
  await p.waitTasks(tok, ids);
}

// What the drive holds for the Clerk.
const filesOf = (drive) => drive.files().filter((f) => f.mimeType !== "application/vnd.google-apps.folder" && !f.trashed);
const markedFiles = (drive) => filesOf(drive).filter((f) => f.appProperties?.clerkDoc);
async function connectDrive(m, env) {
  const c = await clerk(m, `drive connect --client-id ${TEST_CLIENT.id} --client-secret ${TEST_CLIENT.secret}`, env);
  const link = (c.out.match(/(http\S+\/o\/oauth2\/v2\/auth\S+)/) || [])[1];
  if (!link) throw new Error(`no sign-in link: ${c.all}`);
  const landed = (await fetch(link, { redirect: "manual" })).headers.get("location");
  return clerk(m, `drive finish "${landed}"`, env);
}
async function waitFor(what, fn, { minutes = 8, every = 10000 } = {}) {
  const until = Date.now() + minutes * 60000;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) { note(`waited ${minutes} minutes for ${what}`); return null; }
    await sleep(every);
  }
}
const installLine = (m, args = "", env = {}) => inM(m, `curl -fsSL http://${HOST}:48903/install.sh | bash -s -- ${args}`, { env: { GODSPEED_CLERK_TARBALL: `http://${HOST}:48903/godspeed-clerk.tar.gz`, NODE_EXTRA_CA_CERTS: "/opt/clerk-test/pebble-root.pem", ...env }, timeout: 40 * 60000 });
const readIn = async (m, file) => { const r = await inM(m, `cat ${file}`); return r.code === 0 ? JSON.parse(r.out) : null; };

// ------------------------------------------------------------------ the test
// On an empty Paperless (no senders yet) the plan proposed for the kit's drive puts invoices into
// "Invoices" itself, letters into "Letters", pay slips into "Payslips/<year>"; the person says yes.
const A = { slugs: ["utility-invoice", "council-letter", "pay-slip", "water-invoice", "blurry-scan"],
  folders: { "utility-invoice": "Invoices", "council-letter": "Letters", "pay-slip": "Payslips/2025", "water-invoice": "Invoices" } };

async function partA() {
  section("A: a fresh server, the install line with all defaults (F1)");
  check((await machine("up", "a")).code === 0, "machine A: a fresh Ubuntu server with Docker and a stand-in Godspeed");
  const env = await wire("a", S.drives.main);
  const t0 = Date.now();
  const inst = await installLine("a");
  note(`the install line took ${Math.round((Date.now() - t0) / 1000)} s`);
  check(inst.code === 0, `the install line ends without an error${inst.code ? `: ${inst.all.slice(-800)}` : ""}`);
  check(/Paperless runs at https:\/\/srv-a\.clerk\.test:48444/.test(inst.out), "it says where Paperless runs");
  const login = await readIn("a", "/var/lib/godspeed/clerk/login.json");
  A.login = login;
  const p = phone("a");
  const u = await p.req("GET", "/api/ui_settings/");
  check(u.status === 401 && /DNS:srv-a\.clerk\.test/.test(u.cert.subjectaltname || "") && /Pebble/.test(u.cert.issuer?.CN || ""), `F1: Paperless answers over HTTPS on the server's own name, with a certificate from the ACME server (${u.cert.issuer?.CN})`);
  const noCode = await p.signIn(login.user, login.password);
  check(noCode.status === 400 && /MFA code is required/.test(JSON.stringify(noCode.body)), "section 5: the password alone does not sign in; the second factor is required");
  const s = await p.signIn(login.user, login.password, login.secret);
  check(s.status === 200 && s.body.token, `F1: the person's login with the second factor signs in (account "${login.user}")`);
  A.tok = s.body.token;
  const types = (await p.all(A.tok, "/api/document_types/?page_size=100")).map((x) => x.name).sort();
  const tags = await p.all(A.tok, "/api/tags/?page_size=100");
  check(JSON.stringify(types) === JSON.stringify([...STARTERS.english.types].sort()), `F1: the starter document types in English (${types.join(", ")})`);
  const y = new Date().getFullYear();
  check(tags.find((t) => t.name === "Inbox")?.is_inbox_tag && [`Tax ${y - 1}`, "Health", "Important", "Check this", "Not in notebook"].every((n) => tags.some((t) => t.name === n)), `F1: the starter tags, the inbox tag first (${tags.map((t) => t.name).join(", ")})`);
  const st = await clerk("a", "status", env);
  check(/Restore copy: every night after 02:00/.test(st.out), "F1: the nightly restore copy is scheduled");
  const img = (await inM("a", "docker inspect godspeed-clerk-paperless-webserver-1 --format '{{.Config.Image}} {{.HostConfig.Memory}}'")).out.trim();
  check(/paperless-ngx:3\.3\.3@sha256:dba0242c/.test(img) && / 1677721600$/.test(img), `F1: the pinned, tested version with a memory limit (${img})`);
  const outside = await new Promise((r) => { const c = http.get({ host: ipOf("a"), port: 8010, path: "/", timeout: 4000 }, () => r("open")); c.on("error", (e) => r(e.code)); c.on("timeout", () => { c.destroy(); r("timeout"); }); });
  check(outside !== "open", `section 5: nothing but the HTTPS address answers a stranger (Paperless's own port: ${outside})`);

  section("A: the drive, the plan, the phone (F2)");
  for (const [k, v] of [["about", KIT.profile], ["country", KIT.country], ["interval_minutes", "1"], ["talk", '["telegram"]']]) await clerk("a", `settings ${k} '${String(v).replace(/'/g, "'\\''")}'`, env);
  const fin = await connectDrive("a", env);
  check(fin.code === 0 && /Connected to the drive/.test(fin.out), "Google Drive connected (the pretend one)");
  await clerk("a", 'drive folder "Paperwork"', env);
  const prop = await clerk("a", "plan propose", env);
  note(prop.out.split("\n").slice(0, 8).join(" | "));
  check(/"Invoice" papers go to Invoices\./.test(prop.out) && /"Letter" papers go to Letters\./.test(prop.out) && /"Pay slip" papers go to Payslips\/<year>\./.test(prop.out), "the plan proposed from the drive's folders");
  const conf = await clerk("a", "plan confirm", env);
  check(conf.code === 0, "the folder plan confirmed");
  check((await clerk("a", "resume", env)).code === 0, "the Clerk resumed");
  const ph = await clerk("a", "phone", env);
  check(/Swift Paperless/.test(ph.out) && ph.out.includes(login.password) && ph.out.includes("https://srv-a.clerk.test:48444") && /second factor/.test(ph.out), "F2: the address, the login and the second factor, for the chat");
  // The phone signed in once (above) and keeps its key; a second sign-in in the same 30 seconds
  // would reuse the one-time code, which Paperless refuses.
  await uploadKit(p, A.tok, A.slugs);
  note(`${A.slugs.length} made-up scans uploaded over HTTPS the way the phone app does`);
  const docs = await p.all(A.tok, "/api/documents/?page_size=100&fields=id,title,original_file_name,correspondent,document_type,created,tags");
  A.ids = Object.fromEntries(A.slugs.map((s, i) => [s, docs.find((d) => d.original_file_name === `Scan ${today} 16-17-${String(i + 1).padStart(2, "0")}.pdf`)?.id]));
  const filed = await waitFor("every scan filed", () => A.slugs.every((s) => markedFiles(S.drives.main).some((f) => f.appProperties.clerkDoc === String(A.ids[s]) && (s === "blurry-scan" || !S.drives.main.pathOf(f.id).startsWith("Paperwork/To sort")))));
  check(!!filed, "F2: the scans are sorted and filed by the Clerk's own service, without anyone running it");
  const corr = Object.fromEntries((await p.all(A.tok, "/api/correspondents/?page_size=100")).map((c) => [c.id, c.name]));
  const typ = Object.fromEntries((await p.all(A.tok, "/api/document_types/?page_size=100")).map((c) => [c.id, c.name]));
  for (const s of A.slugs) {
    const e = expected(s);
    const d = (await p.req("GET", `/api/documents/${A.ids[s]}/`, { headers: { Authorization: `Token ${A.tok}` } })).body;
    const f = markedFiles(S.drives.main).filter((x) => x.appProperties.clerkDoc === String(A.ids[s]));
    const where = f.map((x) => S.drives.main.pathOf(x.id).split("/").slice(1, -1).join("/"));
    // The folder by the plan as proposed on this Paperless and confirmed as it was (A.folders).
    if (e.check) check(f.length === 1 && where[0] === "To sort", `${s}: waits in To sort (${where})`);
    else check(f.length === 1 && corr[d.correspondent] === e.correspondent && typ[d.document_type] === e.document_type && d.created === e.created && where[0] === A.folders[s], `${s}: ${corr[d.correspondent]}, ${typ[d.document_type]}, ${d.created}, filed in ${where[0]} (the plan: ${A.folders[s]})`);
  }
  const notes = await waitFor("the notes", async () => { const n = await S.notes(); return A.slugs.every((s) => n.some((x) => x.clerk_doc === A.ids[s])) ? n : null; }, { minutes: 4 });
  check(!!notes, `the notes are in the notebook (${notes?.length})`);
  const told = await waitFor("the phone message", () => S.sent.find((m) => /phone is connected/.test(m)), { minutes: 4 });
  check(!!told, `F2: the first scan is reported as connected: "${(told || "").replace(/\n/g, " | ")}"`);
  check(S.sent.filter((m) => /phone is connected/.test(m)).length === 1, "said once");
  const sortMsg = S.sent.find((m) => /waiting to be sorted/.test(m));
  check(!!sortMsg && /https:\/\/srv-a\.clerk\.test:48444\/view\/\d+/.test(sortMsg), `F16, F19: the paper to sort is told with the To sort page's HTTPS link (${(sortMsg || "").replace(/\n/g, " | ")})`);

  section("A: a Godspeed update rewrites its own Caddyfile; the Clerk puts Paperless's address back (F3)");
  await inM("a", "f=/root/godspeed/.godspeed/integrated-runtime/https/Caddyfile; awk '/^# Paperless-ngx/{exit} {print}' $f > $f.new && mv $f.new $f && systemctl restart godspeed-https");
  const gone = await p.req("GET", "/api/ui_settings/").then((r) => r.status, (e) => e.code);
  const heal = await clerk("a", "paperless check", env);
  const back = await waitFor("the address back", () => p.req("GET", "/api/ui_settings/").then((r) => r.status === 401, () => false), { minutes: 2, every: 3000 });
  check(gone !== 401 && /web address was gone from Caddy and is back/.test(heal.out) && back, `the address went away (${gone}), the check put it back, and it answers again`);

  section("A: the restore copy (F9)");
  const cp = await clerk("a", "copy", env);
  check(cp.code === 0 && /restore copy is whole/.test(cp.out), `the copy: ${cp.out.trim()}`);
  const D = S.drives.main;
  const restore = JSON.parse(D.byPath("The Clerk/paperless/restore.json")?.content?.toString() || "{}");
  check(restore.paperless_version === "3.3.3" && restore.documents === A.slugs.length && restore.user === login.user, `restore.json: Paperless ${restore.paperless_version}, ${restore.documents} documents, account ${restore.user}`);
  check(!!D.byPath("The Clerk/paperless/manifest.json") && !!D.byPath("The Clerk/records/clerk-records.json") && filesOf(D).filter((f) => D.pathOf(f.id).startsWith("The Clerk/paperless/originals/")).length === A.slugs.length, "the export (originals, manifest) and the Clerk's records are in its own folder");
  check(filesOf(D).every((f) => /^(Paperwork|The Clerk|Holiday photos)\//.test(D.pathOf(f.id))), "nothing written outside the documents folder and the Clerk's own folder");
  const w0 = D.writes.length;
  const again = await clerk("a", "copy", env);
  const resent = D.writes.slice(w0).map((x) => D.pathOf(x.id)).filter((p) => /The Clerk\/paperless\/(originals|archive)\//.test(p));
  check(again.code === 0 && resent.length === 0, `the next copy sends no scan again, only what changed (${again.out.trim()})`);
  A.restoreAt = restore.made_at;
  A.snapshot = await snapshotOf(p, A.tok);
  A.plan = await readIn("a", "/var/lib/godspeed/clerk/plan.json");
  A.counts = { files: markedFiles(D).length, notes: (await S.notes()).length, items: (await S.items()).length, deadlines: (await S.deadlines()).length };
  note(`A holds ${A.snapshot.length} documents; the drive ${A.counts.files} filed files, the notebook ${A.counts.notes} notes, ${A.counts.items} items, ${A.counts.deadlines} deadlines`);

  section("A: another account keeps a paper in this Paperless (F9)");
  await p.req("POST", "/api/users/", { body: { username: "sam", password: "a-made-up-password-for-sam", is_superuser: false, is_active: true }, headers: { Authorization: `Token ${A.tok}` } });
  const sam = await p.signIn("sam", "a-made-up-password-for-sam");
  await uploadKit(p, sam.body.token, ["second-account-letter"], 30);
  const shared = await clerk("a", "copy", env);
  check(/another account keeps documents/.test(shared.out), `the export stops: ${shared.out.trim()}`);
  check(JSON.parse(D.byPath("The Clerk/paperless/restore.json").content.toString()).made_at === A.restoreAt, "the restore copy in the drive is the one from before");
  const samId = (await p.all(A.tok, "/api/documents/?page_size=100&fields=id,owner,original_file_name")).find((d) => /16-17-30/.test(d.original_file_name))?.id;
  check(!!samId && !markedFiles(D).some((f) => f.appProperties.clerkDoc === String(samId)) && !filesOf(D).some((f) => /16-17-30/.test(f.name)), "nothing of that account reaches the drive");
  const sharedMsg = await waitFor("the shared message", () => S.sent.find((m) => /another account/.test(m)), { minutes: 4 });
  check(!!sharedMsg && S.sent.filter((m) => /another account/.test(m)).length === 1, "the person hears it once");
  await machine("down", "a");
  note("machine A thrown away");
}

async function snapshotOf(p, tok) {
  const corr = Object.fromEntries((await p.all(tok, "/api/correspondents/?page_size=100")).map((c) => [c.id, c.name]));
  const typ = Object.fromEntries((await p.all(tok, "/api/document_types/?page_size=100")).map((c) => [c.id, c.name]));
  const tg = Object.fromEntries((await p.all(tok, "/api/tags/?page_size=100")).map((c) => [c.id, c.name]));
  return (await p.all(tok, "/api/documents/?page_size=100&ordering=id")).map((d) => ({ id: d.id, title: d.title, created: d.created, sender: corr[d.correspondent] || null, type: typ[d.document_type] || null, tags: d.tags.map((t) => tg[t]).sort(), checksum: d.original_checksum || null }));
}

async function partB() {
  section("B: a fresh server rebuilt from the drive (F9)");
  check((await machine("up", "b")).code === 0, "machine B: a fresh server");
  const env = await wire("b", S.drives.main);
  const inst = await installLine("b");
  check(inst.code === 0, `the install line on B (an empty Paperless)${inst.code ? `: ${inst.all.slice(-600)}` : ""}`);
  const fin = await connectDrive("b", env);
  check(/restore copy of a Paperless the Clerk installed/.test(fin.out), `connecting the drive offers the rebuild (${fin.out.split("\n").pop()})`);
  const r = await clerk("b", "restore", env);
  note(r.all.trim().split("\n").join(" | ").slice(0, 900));
  check(r.code === 0 && /Paperless is rebuilt/.test(r.out), "godspeed-clerk restore rebuilds Paperless");
  check(/Paperless 3\.3\.3 starting empty/.test(r.out), "the version that made the export first");
  const p = phone("b");
  const old = await p.signIn(A.login.user, A.login.password);
  check(old.status === 400 && /MFA/.test(JSON.stringify(old.body)), "the account came back with its second factor");
  const s = await p.signIn(A.login.user, A.login.password, A.login.secret);
  check(s.status === 200, "the phone signs in again with the same password and authenticator code");
  const snap = await snapshotOf(p, s.body.token);
  check(JSON.stringify(snap) === JSON.stringify(A.snapshot), `every document, title, tag and date of the original (${snap.length} of ${A.snapshot.length})`);
  if (JSON.stringify(snap) !== JSON.stringify(A.snapshot)) note(`B: ${JSON.stringify(snap).slice(0, 400)} / A: ${JSON.stringify(A.snapshot).slice(0, 400)}`);
  check(JSON.stringify((await readIn("b", "/var/lib/godspeed/clerk/plan.json"))?.rules) === JSON.stringify(A.plan?.rules), "the confirmed folder plan");
  const st = await clerk("b", "status", env);
  note(st.out.split("\n").slice(0, 6).join(" | "));
  // The next runs (the worker's, and two more by hand).
  await sleep(90000);
  for (let i = 0; i < 2; i++) await clerk("b", "run", env);
  const D = S.drives.main;
  const counts = { files: markedFiles(D).length, notes: (await S.notes()).length, items: (await S.items()).length, deadlines: (await S.deadlines()).length };
  check(JSON.stringify(counts) === JSON.stringify(A.counts), `its next runs make no second file, note, collection item or deadline (${JSON.stringify(counts)})`);
  const v = await p.req("GET", "/api/ui_settings/", { headers: { Authorization: `Token ${s.body.token}` } });
  check(v.body.settings?.version === "3.3.3", `Paperless ${v.body.settings?.version} on B`);
  await machine("down", "b");
  note("machine B thrown away");
}

async function partC() {
  section("C: Paperless 3.2.1 in German; an update forced to fail after it changed the database (F3)");
  check((await machine("up", "c")).code === 0, "machine C: a fresh server");
  const env = await wire("c", S.drives.other);
  const inst = await installLine("c", "--language German --paperless-version 3.2.1", { GODSPEED_CLERK_TEST: "1" });
  check(inst.code === 0, `installed Paperless 3.2.1 (the tests' earlier version)${inst.code ? `: ${inst.all.slice(-600)}` : ""}`);
  const login = await readIn("c", "/var/lib/godspeed/clerk/login.json");
  const p = phone("c");
  const tok = (await p.signIn(login.user, login.password, login.secret)).body.token;
  const types = (await p.all(tok, "/api/document_types/?page_size=100")).map((x) => x.name).sort();
  const tags = (await p.all(tok, "/api/tags/?page_size=100")).map((x) => x.name);
  check(JSON.stringify(types) === JSON.stringify([...STARTERS.german.types].sort()) && ["Posteingang", "Prüfen", "Wichtig", "Nicht ins Notizbuch", `Steuer ${new Date().getFullYear() - 1}`].every((n) => tags.includes(n)), `F1: the starter set in German (${types.slice(0, 4).join(", ")}, ...; ${tags.slice(0, 5).join(", ")}, ...)`);
  const ocr = (await inM("c", "grep PAPERLESS_OCR_LANGUAGE: /opt/godspeed-clerk/paperless/compose.yaml")).out.trim();
  check(/deu\+eng/.test(ocr), `text reading in German and English (${ocr})`);
  await connectDrive("c", env);
  await uploadKit(p, tok, ["utility-invoice", "council-letter", "doctor-letter"]);
  const sums = async () => {
    const out = {};
    for (const d of await p.all(tok, "/api/documents/?page_size=100&ordering=id&fields=id")) {
      const o = await p.req("GET", `/api/documents/${d.id}/download/?original=true`, { headers: { Authorization: `Token ${tok}` }, raw: true });
      const a = await p.req("GET", `/api/documents/${d.id}/download/`, { headers: { Authorization: `Token ${tok}` }, raw: true });
      out[d.id] = [o.status, md5(o.body), a.status, md5(a.body)];
    }
    return JSON.stringify(out);
  };
  const migrations = async () => (await inM("c", "cd /opt/godspeed-clerk/paperless && docker compose -p godspeed-clerk-paperless exec -T db psql -U paperless -tAc \"select count(*) || ' ' || string_agg(app || '.' || name, ',' order by id) from django_migrations\"")).out.trim();
  const before = { sums: await sums(), mig: await migrations() };
  check(Object.keys(JSON.parse(before.sums)).length === 3 && Object.values(JSON.parse(before.sums)).every((x) => x[0] === 200 && x[2] === 200), "three documents, each original and searchable PDF downloads");
  const fail = await clerk("c", "paperless update", env, { GODSPEED_CLERK_TEST_FAIL_UPDATE: "after-start" });
  note(fail.all.trim().split("\n").join(" | "));
  const log = (await inM("c", "grep 'update:' /var/lib/godspeed/clerk/clerk.log")).out;
  check(/Paperless 3\.3\.3 is not healthy \(the test made this update fail after the new version had started\)/.test(log), "the new version started and ran its migrations before the update was made to fail");
  check(fail.code !== 0 && /runs again with its database, settings and documents as before/.test(fail.err + fail.out), "the update reports it put everything back");
  const v1 = await p.req("GET", "/api/ui_settings/", { headers: { Authorization: `Token ${tok}` } });
  const img1 = (await inM("c", "docker inspect godspeed-clerk-paperless-webserver-1 --format '{{.Config.Image}}'")).out.trim();
  check(v1.body.settings?.version === "3.2.1" && /:3\.2\.1@sha256:5fa76604/.test(img1), `F3: on the previous version (${v1.body.settings?.version}, ${img1.split("@")[0]})`);
  check(await migrations() === before.mig, `F3: with the previous database (${before.mig.split(" ")[0]} migrations, the same ones)`);
  check(await sums() === before.sums, "F3: every document present and readable, byte for byte");
  check((await inM("c", "ls /opt/godspeed-clerk/paperless/backups")).out.includes("before-3.3.3"), "the copy taken before the update is kept");
  const ok = await clerk("c", "paperless update", env);
  check(ok.code === 0 && /Paperless 3\.3\.3 runs/.test(ok.out), `the update to 3.3.3 (${ok.out.trim().split("\n").pop()})`);
  const after = await migrations();
  check(Number(after.split(" ")[0]) > Number(before.mig.split(" ")[0]) && /documents\.0027_documentbarcode/.test(after), `its migrations ran (${before.mig.split(" ")[0]} to ${after.split(" ")[0]}, documents.0027 among them)`);
  check(await sums() === before.sums, "every document present and readable after the update");
  section("C: a stopped Paperless (F3)");
  await inM("c", "cd /opt/godspeed-clerk/paperless && docker compose -p godspeed-clerk-paperless stop webserver");
  const down = await p.req("GET", "/api/ui_settings/").then((r) => r.status, (e) => e.code);
  const chk = await clerk("c", "paperless check", env);
  const up = await waitFor("Paperless back", () => p.req("GET", "/api/ui_settings/").then((r) => r.status === 401, () => false), { minutes: 4, every: 5000 });
  check(down !== 401 && /started again/.test(chk.out) && up, `stopped (${down}), it runs again on the next check`);
  if (!process.env.E2E_KEEP) { await machine("down", "c"); note("machine C thrown away"); }
}

async function partD() {
  section("D: a server below the minimum (F1)");
  check((await machine("up", "d", "--memory", "1g")).code === 0, "machine D: a fresh server with 1 GB of memory");
  const inst = await installLine("d");
  note(inst.all.trim().split("\n").slice(-6).join(" | "));
  check(inst.code !== 0 && /Paperless was not installed, because/.test(inst.all) && /GB of memory free; Paperless needs 1\.5 GB/.test(inst.all), "it stops before installing and names the missing memory");
  check((await inM("d", "test -e /opt/godspeed-clerk || echo none")).out.trim() === "none" && (await inM("d", "docker ps -aq | wc -l")).out.trim() === "0", "nothing was installed: no folder, no container");
  if (!process.env.E2E_KEEP) { await machine("down", "d"); note("machine D thrown away"); }
}

// --serve: only what outlives a machine, for working by hand (a reviewer, a person): the services,
// and a small page of what they hold, on http://10.89.0.1:48904 (/drive, /drive-other, /telegram,
// /notebook). Wire a machine to them with: test/machine/machine.sh wire <letter> [other].
async function serve() {
  await machine("net");
  await startServices();
  const control = http.createServer(async (req, res) => {
    const json = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o, null, 1)); };
    const drive = (d) => d.files().map((f) => ({ path: d.pathOf(f.id), folder: f.mimeType === "application/vnd.google-apps.folder" || undefined, trashed: f.trashed || undefined, clerk: f.appProperties?.clerkDoc ? `doc ${f.appProperties.clerkDoc}` : f.appProperties?.clerkCopy ? "restore copy" : undefined }));
    try {
      if (req.url === "/drive") return json(drive(S.drives.main));
      if (req.url === "/drive-other") return json(drive(S.drives.other));
      if (req.url === "/telegram") return json(S.sent);
      if (req.url === "/notebook") return json({ notes: (await S.notes()).map((n) => ({ title: n.title, doc: n.clerk_doc })), items: (await S.items()).length, deadlines: await S.deadlines() });
      if (req.url?.startsWith("/consent?")) { const link = decodeURIComponent(req.url.slice(9)); const r = await fetch(link, { redirect: "manual" }); return json({ address: r.headers.get("location") }); }
    } catch (e) { res.writeHead(500); return res.end(String(e.message)); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => control.listen(48904, HOST, r));
  console.log([
    "Running, until stopped:",
    `  the pretend Google Drive (account ${KIT.drive.account}, documents folder "Paperwork"):  ${S.drives.main.url}`,
    `  a second pretend drive (kim@example.test, folder "Papers"):  ${S.drives.other.url}`,
    `  the Godspeed notebook:  ${S.nb}`,
    `  the pretend Telegram:  http://${HOST}:48902`,
    `  the install line's files:  http://${HOST}:48903/install.sh and /godspeed-clerk.tar.gz`,
    `  what they hold:  http://${HOST}:48904/drive, /drive-other, /telegram, /notebook`,
    `  Google's consent, pressed for you:  http://${HOST}:48904/consent?<the link drive connect printed, URL-encoded>`,
  ].join("\n"));
  await new Promise(() => {});
}

async function main() {
  if (process.argv.includes("--serve")) return serve();
  if (!fs.existsSync(path.join(RENDERED, "utility-invoice.pdf"))) { const r = await sh("python3", [path.join(ROOT, "test", "kit", "render.py"), RENDERED]); if (r.code) throw new Error(`the kit could not be rendered: ${r.all || r.err}`); }
  if (!fs.existsSync(path.join(WORK, "godspeed-clerk.tar.gz"))) throw new Error("test/machine/.work/godspeed-clerk.tar.gz: build it first (README)");
  await machine("net");
  await startServices();
  try {
    if (ONLY.has("a")) await partA();
    if (ONLY.has("b")) await partB();
    if (ONLY.has("c")) await partC();
    if (ONLY.has("d")) await partD();
  } finally {
    S.nbChild?.kill();
    for (const s of [S.tg, S.files, S.fwd]) s?.close();
    for (const d of Object.values(S.drives || {})) await d.close();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
