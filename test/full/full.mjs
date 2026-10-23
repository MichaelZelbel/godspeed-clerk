#!/usr/bin/env node
// The full test (PRD section 11): a real Paperless-ngx 3.3.3 in Docker, the made-up kit uploaded
// the way the phone app sends it, the Clerk run as its own process (so a crash is a real kill),
// a pretend Google Drive in this process, and recorded AI answers through a stand-in for
// Godspeed's `godspeed-model`. Every result is read back through Paperless's API and the drive.
//
//   docker compose -f test/full/compose.yaml up -d
//   python3 test/kit/render.py test/kit/rendered
//   node test/full/full.mjs
//
// PAPERLESS_URL (default http://127.0.0.1:8000) and KIT_RENDERED (default test/kit/rendered).
// GODSPEED_NOTEBOOK_CHECKOUT: a checkout of the Godspeed product (MichaelZelbel/godspeed-mission-
// control); its notebook is started for the test in a folder of its own, on a port of its own,
// with every GODSPEED_* variable cleared (NOTEBOOK_NODE: the Node it runs on, default this one).
// Without it the notes are not tested, and the Clerk gets an address where nothing answers, so it
// can never reach a notebook that belongs to someone. Messages go to a pretend Telegram API.
// The test itself does what the Clerk never does: it makes users, uploads, deletes a document.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import net from "node:net";
import { startFakeDrive } from "../fakes/drive.mjs";
import { keyOf } from "../../lib/core/deadlines.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const KITDIR = path.join(ROOT, "test", "kit");
const PL = (process.env.PAPERLESS_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const RENDERED = path.resolve(process.env.KIT_RENDERED || path.join(KITDIR, "rendered"));
const KIT = JSON.parse(fs.readFileSync(path.join(KITDIR, "kit.json"), "utf8"));
const DOCS = JSON.parse(fs.readFileSync(path.join(KITDIR, "documents.json"), "utf8")).documents;
const expected = (slug) => JSON.parse(fs.readFileSync(path.join(KITDIR, "expected", `${slug}.json`), "utf8"));
const kitText = (slug) => fs.readFileSync(path.join(KITDIR, "documents", `${slug}.txt`), "utf8");
const PW = Object.fromEntries(KIT.paperless.users.map((u) => [u.username, u.password]));
const HELD_BACK = ["roofing-invoice", "pay-slip", "unusable-answer"];
const ALEX = DOCS.filter((d) => d.owner === "alex").map((d) => d.slug);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `clerk-full-${p}-`));

const CHECKOUT = process.env.GODSPEED_NOTEBOOK_CHECKOUT ? path.resolve(process.env.GODSPEED_NOTEBOOK_CHECKOUT) : null;
// CLERK_PREVIOUS: a checkout of an earlier Clerk (0.2). Then "Godspeed sorts" starts with that one
// over the kit, and this version takes over: the upgrade (papers sorted and noted before get their
// deadlines read once, never sorted or filed again).
const PREVIOUS = process.env.CLERK_PREVIOUS ? path.resolve(process.env.CLERK_PREVIOUS) : null;
// The day the Clerk counts from (test mode only), so the kit's letters keep their future deadlines.
const CLERK_DAY = "2026-10-22";
const DEADLINE_LETTERS = ["water-invoice", "tax-office-letter", "parking-notice", "gym-letter", "library-reminder", "meter-letter", "clinic-letter"];
const wantDeadlines = (slugs) => slugs.reduce((n, s) => n + (expected(s).deadlines || []).length, 0);
const NOBODY = "http://127.0.0.1:9"; // nothing answers here

let failures = 0, passes = 0;
function check(ok, what) {
  if (ok) { passes++; console.log(`  ok    ${what}`); } else { failures++; console.log(`  FAIL  ${what}`); }
}
const section = (s) => console.log(`\n== ${s}`);

// ------------------------------------------------------------------ Paperless, as the test
async function api(tok, method, p, body, { raw = false } = {}) {
  const headers = { Accept: "application/json", Authorization: `Token ${tok}` };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(`${PL}/api/${p.replace(/^\/+/, "")}`, { method, headers, body: payload });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${text.slice(0, 300)}`);
  return raw ? text : text ? JSON.parse(text) : null;
}
async function all(tok, p) {
  let page = await api(tok, "GET", `${p}${p.includes("?") ? "&" : "?"}page_size=100`);
  const out = [...page.results];
  while (page.next) { const n = new URL(page.next); page = await api(tok, "GET", `${n.pathname.replace(/^\/api\//, "")}${n.search}`); out.push(...page.results); }
  return out;
}
async function tokenFor(user) {
  const res = await fetch(`${PL}/api/token/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: user, password: PW[user] }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.token) throw new Error(`no token for ${user}: ${res.status}`);
  return j.token;
}
async function waitUp() {
  const until = Date.now() + 8 * 60000;
  while (Date.now() < until) {
    try { return await tokenFor("alex"); } catch { await sleep(3000); }
  }
  throw new Error("Paperless did not come up within 8 minutes");
}
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const ids = {};
let alexTok, samTok, tagIds = {}, typeIds = {}, corrIds = {};
async function upload(slugs) {
  const tasks = [];
  for (const slug of slugs) {
    const d = DOCS.find((x) => x.slug === slug);
    const n = DOCS.indexOf(d) + 1;
    const fd = new FormData();
    fd.append("document", new Blob([fs.readFileSync(path.join(RENDERED, `${slug}.pdf`))], { type: "application/pdf" }), `Scan ${today} 16-17-${String(n).padStart(2, "0")}.pdf`);
    if (d.upload?.title) fd.append("title", d.upload.title);
    for (const t of d.upload?.tags || []) fd.append("tags", String(tagIds[t]));
    fd.append("created", today);
    const task = await api(d.owner === "sam" ? samTok : alexTok, "POST", "documents/post_document/", fd);
    tasks.push({ slug, task: typeof task === "string" ? task : task.task_id || task.id, file: `Scan ${today} 16-17-${String(n).padStart(2, "0")}.pdf` });
  }
  for (const t of tasks) {
    const until = Date.now() + 10 * 60000;
    for (;;) {
      const r = await api(alexTok, "GET", `tasks/?task_id=${t.task}`);
      const task = (Array.isArray(r) ? r : r.results || [])[0];
      const st = String(task?.status || "").toLowerCase();
      if (st === "success") break;
      if (st === "failure") throw new Error(`Paperless could not read ${t.slug}: ${task.result}`);
      if (Date.now() > until) throw new Error(`Paperless took more than 10 minutes for ${t.slug}`);
      await sleep(2000);
    }
  }
  const docs = await all(alexTok, "documents/?fields=id,original_file_name,owner");
  for (const t of tasks) {
    const hit = docs.find((x) => x.original_file_name === t.file);
    if (!hit) throw new Error(`the upload of ${t.slug} is not in Paperless`);
    ids[t.slug] = hit.id;
  }
}

async function snapshot() {
  const docs = (await all(alexTok, "documents/?ordering=id")).map(({ modified, ...d }) => d);
  const [tags, corr, types, fields] = await Promise.all(["tags/", "correspondents/", "document_types/", "custom_fields/"].map((p) => all(alexTok, p).then((x) => x.map(({ document_count, last_correspondence, ...o }) => o))));
  return JSON.stringify({ docs, tags, corr, types, fields });
}
const doc = (slug) => api(alexTok, "GET", `documents/${ids[slug]}/`);
const nameOf = (map, id) => (id ? Object.keys(map).find((k) => map[k] === id) ?? `#${id}` : null);
async function refreshNames() {
  tagIds = Object.fromEntries((await all(alexTok, "tags/")).map((t) => [t.name, t.id]));
  corrIds = Object.fromEntries((await all(alexTok, "correspondents/")).map((t) => [t.name, t.id]));
  typeIds = Object.fromEntries((await all(alexTok, "document_types/")).map((t) => [t.name, t.id]));
}

// ------------------------------------------------------------------ a real notebook, a pretend Telegram
const freePort = () => new Promise((r) => { const srv = net.createServer(); srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => r(port)); }); });
async function startNotebook() {
  if (!CHECKOUT) return null;
  const ws = tmp("notebook"), home = tmp("notebook-home"), port = await freePort();
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GODSPEED_|HERMES_)/i.test(k)));
  Object.assign(env, { GODSPEED_WORKSPACE: ws, GODSPEED_PORT: String(port), GODSPEED_FOOD_TABLE: "off", HOME: home, USERPROFILE: home });
  const log = fs.openSync(path.join(home, "notebook.log"), "a");
  const child = spawn(process.env.NOTEBOOK_NODE || process.execPath, [path.join(CHECKOUT, "notebook", "server", "main.mjs")], { env, stdio: ["ignore", log, log] });
  const url = `http://127.0.0.1:${port}`;
  for (const until = Date.now() + 90000; ;) {
    try { if ((await fetch(`${url}/health`)).ok) break; } catch { /* not yet */ }
    if (Date.now() > until || child.exitCode !== null) throw new Error(`the notebook did not start: ${fs.readFileSync(path.join(home, "notebook.log"), "utf8").slice(-800)}`);
    await sleep(500);
  }
  const query = async (body) => { const r = await fetch(`${url}/api/query`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok || j.error) throw new Error(`notebook: ${r.status} ${j.error}`); return j.data; };
  return {
    url, query, ws,
    // The Clerk's deadlines as the product keeps them (core/addon-deadlines.mjs).
    deadlines: async () => {
      const r = await fetch(`${url}/api/functions/addon-deadlines`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addon: "godspeed-clerk", action: "list" }) });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(`notebook deadlines: ${r.status} ${j.error}`);
      return j.data.deadlines;
    },
    // What the product's deadline reminders and the morning brief say on a day (tools/due.js today).
    remindersOn: (day) => new Promise((resolve) => {
      const env2 = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GODSPEED_|HERMES_)/i.test(k)));
      const c = spawn(process.env.NOTEBOOK_NODE || process.execPath, [path.join(CHECKOUT, "tools", "due.js"), "today", "--godspeed", ws], { env: { ...env2, GODSPEED_TODAY: day } });
      let out = "";
      c.stdout.on("data", (d) => (out += d));
      c.on("close", () => resolve(out));
    }),
    notes: async () => (await query({ table: "notes", operation: "select", filters: [["eq", "source_app", "godspeed-clerk"]] })),
    items: async () => {
      const colls = await query({ table: "collections", operation: "select", filters: [["eq", "source_app", "godspeed-clerk"]] });
      return colls.length ? query({ table: "collection_items", operation: "select", filters: [["eq", "collection_id", colls[0].id]] }) : [];
    },
    collections: () => query({ table: "collections", operation: "select", filters: [["eq", "source_app", "godspeed-clerk"]] }),
    stop: () => new Promise((r) => { if (child.exitCode !== null) return r(); child.once("exit", r); child.kill(); }),
  };
}
async function startTelegram() {
  const sent = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { if (/\/sendMessage$/.test(req.url)) sent.push(JSON.parse(raw || "{}").text); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, result: { message_id: sent.length } })); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const env = path.join(tmp("hermes"), "hermes", ".env");
  fs.mkdirSync(path.dirname(env), { recursive: true });
  fs.writeFileSync(env, "TELEGRAM_BOT_TOKEN=999:made-up-for-the-test\nTELEGRAM_HOME_CHANNEL=1001\n");
  return { url: `http://127.0.0.1:${server.address().port}`, env, sent, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
let NB = null, TG = null;

// ------------------------------------------------------------------ the Clerk, as its own process
const WORK = tmp("work");
const ANSWERS = path.join(WORK, "answers.json");
fs.copyFileSync(path.join(KITDIR, "answers.json"), ANSWERS);
const WS = path.join(WORK, "godspeed");
fs.mkdirSync(WS);
fs.writeFileSync(path.join(WS, "AGENTS.md"), "A made-up Godspeed folder for the full test.\n");

function clerk(state, args, env = {}, app = ROOT) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(app, "bin", "godspeed-clerk.mjs"), ...args, "--state", state], {
      env: { ...process.env, GODSPEED_MODEL_COMMAND: path.join(ROOT, "test", "fakes", "model.mjs"), GODSPEED_CLERK_FAKE_ANSWERS: ANSWERS,
        GODSPEED_CLERK_FAKE_PROMPTS: path.join(WORK, "prompts.jsonl"), PAPERLESS_PASSWORD: PW.alex, GODSPEED_CLERK_UPLOAD_CHUNK: "65536",
        // Never a real notebook or a real bot: the test's own, or nothing.
        GODSPEED_CLERK_NOTEBOOK: NB?.url || NOBODY, GODSPEED_CLERK_TELEGRAM_API: TG?.url || NOBODY, GODSPEED_CLERK_TEST: "1", GODSPEED_CLERK_TODAY: CLERK_DAY, ...env },
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code, signal) => resolve({ code, signal, out, err }));
  });
}
async function must(state, args, env, app = ROOT) {
  const r = await clerk(state, args, env, app);
  if (r.code !== 0) throw new Error(`godspeed-clerk ${args.join(" ")} failed (${r.code} ${r.signal || ""}): ${r.err || r.out}`);
  return r;
}
async function runUntilQuiet(state, env, max = 10, app = ROOT) {
  let last;
  for (let i = 0; i < max; i++) {
    last = await must(state, ["run"], env, app);
    const m = last.out.match(/(\d+) copied to the drive, (\d+) sorted, (\d+) to check, (\d+) filed, (\d+) noted\. .*?; (\d+) waiting/);
    const made = last.out.match(/ (\d+) deadline\(s\) made in Godspeed/);
    if (!m || (m.slice(1).every((x) => x === "0") && !made)) break;
  }
  return last;
}
async function connectDrive(state, fake) {
  const env = fake.env;
  const c = await must(state, ["drive", "connect", "--client-id", "test-client.apps.googleusercontent.com", "--client-secret", "test-secret"], env);
  const link = c.out.match(/(http\S+\/o\/oauth2\/v2\/auth\S+)/)[1];
  const landed = (await fetch(link, { redirect: "manual" })).headers.get("location");
  await must(state, ["drive", "finish", landed], env);
}
async function setUp(mode, fake, storagePaths = null) {
  const state = tmp(mode);
  const env = fake.env;
  await must(state, ["setup", "--paperless", PL, "--user", "alex", "--godspeed", WS, "--no-service", "--no-copy", "--sorting", mode, "--country", KIT.country], env);
  await must(state, ["settings", "about", KIT.profile], env);
  await must(state, ["settings", "tag_rules", JSON.stringify(KIT.paperless.tag_rules)], env);
  await must(state, ["settings", "settle_minutes", "0"], env);
  await must(state, ["settings", "talk", JSON.stringify(["telegram"])], env);
  if (TG) await must(state, ["settings", "telegram_env", TG.env], env);
  await connectDrive(state, fake);
  await must(state, ["drive", "folder", "Paperwork"], env);
  const p = await must(state, ["plan", "propose"], env);
  const confirmed = await must(state, ["plan", "confirm", ...(storagePaths ? ["--storage-paths", storagePaths] : [])], env);
  await must(state, ["resume"], env);
  return { state, env, proposal: p.out, confirmed: confirmed.out };
}
const sumIn = (state, slug) => JSON.parse(fs.readFileSync(path.join(state, "records", `${ids[slug]}.json`), "utf8")).sum;
const oneFile = (fake, slug) => fake.marked(ids[slug]).filter((f) => !f.trashed);
const outbox = (state) => (fs.existsSync(path.join(state, "outbox.jsonl")) ? fs.readFileSync(path.join(state, "outbox.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

// ------------------------------------------------------------------ the test
async function main() {
  section("Paperless comes up, the kit goes in");
  alexTok = await waitUp();
  await api(alexTok, "POST", "users/", { username: "sam", password: PW.sam, email: "sam@example.test", is_superuser: true, is_staff: false, is_active: true });
  samTok = await tokenFor("sam");
  for (const name of KIT.paperless.types) await api(alexTok, "POST", "document_types/", { name, matching_algorithm: 0 });
  for (const t of KIT.paperless.tags) await api(alexTok, "POST", "tags/", { matching_algorithm: 0, ...t });
  for (const name of [...KIT.paperless.correspondents, "Harbor Bank"]) await api(alexTok, "POST", "correspondents/", { name, matching_algorithm: 0 });
  await refreshNames();
  await upload(DOCS.map((d) => d.slug).filter((s) => !HELD_BACK.includes(s)));
  const p = DOCS.find((d) => d.slug === "bank-certificate").presorted;
  await api(alexTok, "PATCH", `documents/${ids["bank-certificate"]}/`, { title: p.title, correspondent: corrIds[p.correspondent], document_type: typeIds[p.document_type], tags: p.tags.map((t) => tagIds[t]), created: p.created });
  const first = await doc("utility-invoice");
  check(first.title === `Scan ${today} 16-17-01` && first.created === today && first.tags.includes(tagIds.Inbox), "an upload arrives like a phone scan: file-name title, upload day as its date, inbox tag");
  check((first.content || "").includes("55120"), "Paperless read the text of the scan");
  const samDoc = JSON.stringify(await api(samTok, "GET", `documents/${ids["second-account-letter"]}/`));

  for (const mode of ["nobody", "paperless"]) {
    section(`F4: "${mode === "nobody" ? "nobody sorts" : "Paperless sorts"}"`);
    const fake = await startFakeDrive({ tree: KIT.drive.tree, account: KIT.drive.account });
    NB = await startNotebook();
    TG = await startTelegram();
    try {
      const before = await snapshot();
      const views0 = await all(alexTok, "saved_views/"), paths0 = await all(alexTok, "storage_paths/");
      const { state, env } = await setUp(mode, fake, mode === "nobody" ? "no" : "yes");
      // The Clerk was running when the kit arrived: new letters, not an archive it found (which
      // gets no AI reading, F10), so their deadlines are read.
      const sf = path.join(state, "state.json"), st = fs.existsSync(sf) ? JSON.parse(fs.readFileSync(sf, "utf8")) : {};
      fs.writeFileSync(path.join(state, "state.json"), JSON.stringify({ ...st, started_at: "2026-10-01T00:00:00Z" }));
      await runUntilQuiet(state, env);
      check(await snapshot() === before, "every document, tag, sender, type and custom field in Paperless is exactly as before");
      if (mode === "nobody") {
        check(JSON.stringify(await all(alexTok, "storage_paths/")) === JSON.stringify(paths0) && JSON.stringify(await all(alexTok, "saved_views/")) === JSON.stringify(views0), "F19: with the person's \"no\", Paperless's storage paths and saved views are unchanged");
      } else {
        const sp = await all(alexTok, "storage_paths/"), views = await all(alexTok, "saved_views/");
        check(sp.some((x) => x.name === "To sort") && sp.some((x) => x.name === "Letters") && views.some((v) => v.name === "To sort"), `F4, F19: with the yes, the storage paths and the To sort page are made, and nothing of a document changes (${sp.map((x) => x.name).join(", ")})`);
      }
      const here = ALEX.filter((s) => !HELD_BACK.includes(s));
      check(here.every((s) => oneFile(fake, s).length === 1), `every document is filed, once (${here.length})`);
      check(fake.pathOf(oneFile(fake, "bank-certificate")[0]?.id || "") === "Paperwork/Taxes/2024/2025-02-14 Yearly tax certificate 2024.pdf", "the document sorted before goes where the plan says");
      check(oneFile(fake, "second-account-letter").length === 0, "the other account's document is not copied");
      if (NB) {
        const notes = await NB.notes();
        const want = here.filter((s) => !expected(s).not_in_notebook);
        check(notes.length === want.length && want.every((s) => notes.filter((n) => n.clerk_doc === ids[s]).length === 1), `F4, F10: every note is still written, one per document (${notes.length} of ${want.length}), the kept-out letter none`);
        check((await NB.items()).length === here.length, "F17: one collection item per document");
        const dl = await NB.deadlines();
        check(dl.length === wantDeadlines(here) && here.every((s) => JSON.stringify(dl.filter((d) => d.key.startsWith(keyOf(sumIn(state, s), ""))).map((d) => d.due).sort()) === JSON.stringify((expected(s).deadlines || []).map((x) => x.due).sort())),
          `F4, F15: every letter's deadlines are still made in Godspeed (${dl.length} of ${wantDeadlines(here)})`);
      } else console.log("  SKIP  the notes (GODSPEED_NOTEBOOK_CHECKOUT is not set)");
    } finally { await fake.close(); await NB?.stop(); await TG.close(); NB = null; TG = null; }
  }

  section("Godspeed sorts: the plan, the first copies");
  const fake = await startFakeDrive({ tree: KIT.drive.tree, account: KIT.drive.account });
  NB = await startNotebook();
  TG = await startTelegram();
  try {
    const { state, env, confirmed } = await setUp("godspeed", fake, "yes");
    check(/storage paths? for your folders/.test(confirmed) && /\/view\/\d+/.test(confirmed), `F19: confirming the plan makes the storage paths and the To sort page (${confirmed.trim().split("\n").pop()})`);
    const sumOf = (slug) => JSON.parse(fs.readFileSync(path.join(state, "records", `${ids[slug]}.json`), "utf8")).sum;
    const linksIn = (m) => m.match(/https?:\/\/\S+/g) || [];
    const plan = JSON.parse(fs.readFileSync(path.join(state, "plan.json"), "utf8"));
    const tops = Object.keys(KIT.drive.tree.Paperwork);
    const kitTypes = [...new Set(ALEX.map((s) => expected(s).document_type).filter(Boolean))];
    for (const t of kitTypes) check(plan.rules.some((r) => r.type === t && tops.includes(r.folder.split("/")[0])), `F8: the proposed plan sends "${t}" to one of the existing folders`);
    const before = await snapshot();
    await must(state, ["run", "--steps", "copy"], env);
    const now = ALEX.filter((s) => !HELD_BACK.includes(s));
    check(now.every((s) => /^Paperwork\/To sort\//.test(fake.pathOf(oneFile(fake, s)[0]?.id || ""))), "F8: every document is in To sort before any sorting starts");
    check(await snapshot() === before, "the first copies change nothing in Paperless");
    const meta = await api(alexTok, "GET", `documents/${ids["utility-invoice"]}/metadata/`);
    const f0 = oneFile(fake, "utility-invoice")[0];
    check(f0?.appProperties?.clerkDoc === String(ids["utility-invoice"]) && f0?.appProperties?.clerkSum === meta.original_checksum, "F18: the file carries the mark: Paperless number and the original's checksum");
    check(Number(f0?.size) === meta.archive_size && f0?.sha256Checksum === meta.archive_checksum, "F8: the copy in the drive is the searchable PDF, size and checksum as Paperless has them");

    const promptLog = () => (fs.existsSync(path.join(WORK, "prompts.jsonl")) ? fs.readFileSync(path.join(WORK, "prompts.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
    let upgrade = null;
    if (PREVIOUS) {
      section(`The upgrade: the kit sorted, filed and noted by the Clerk ${JSON.parse(fs.readFileSync(path.join(PREVIOUS, "package.json"), "utf8")).version}`);
      await runUntilQuiet(state, env, 10, PREVIOUS);
      const before = NB ? await NB.deadlines() : [];
      check(before.length === 0 && (await NB?.notes() || []).length > 0, "the earlier version noted the papers and made no deadline");
      upgrade = { sorts: promptLog().filter((p) => p.system.startsWith("You sort")).length, readings: promptLog().filter((p) => p.system.startsWith("You summarise")).length, writes: fake.writes.length, sent: TG.sent.length, files: Object.fromEntries(ALEX.filter((s) => !HELD_BACK.includes(s)).map((s) => [s, fake.pathOf(oneFile(fake, s)[0]?.id || "")])) };
    }

    section("F18: killed after each step in turn, and in the middle of an upload");
    await upload(["roofing-invoice", "pay-slip"]);
    for (const point of ["after-copy", "mid-upload", "after-sort", "after-file", ...(NB ? ["after-note", "after-item"] : [])]) {
      const r = await clerk(state, ["run"], { ...env, GODSPEED_CLERK_CRASH_AT: point });
      check(r.signal === "SIGKILL", `killed at ${point}`);
    }
    if (NB) {
      // A deadline is made once its letter is sorted, filed and noted: runs go on until one is.
      let r;
      for (let i = 0; i < 8; i++) { r = await clerk(state, ["run"], { ...env, GODSPEED_CLERK_CRASH_AT: "after-deadline" }); if (r.signal === "SIGKILL") break; }
      check(r.signal === "SIGKILL", "killed at after-deadline");
    }
    await runUntilQuiet(state, env);
    // Messages the earlier version sent before the update come first.
    const base = upgrade ? upgrade.sent : 0;

    if (upgrade) {
      section("The upgrade: every paper's deadlines read once, nothing sorted or filed again");
      const sortsAfter = promptLog().filter((p) => p.system.startsWith("You sort")).length - upgrade.sorts;
      check(sortsAfter === 2, `only the two papers uploaded after the update were sorted (${sortsAfter} sorting requests)`);
      check(Object.entries(upgrade.files).every(([s, where]) => fake.pathOf(oneFile(fake, s)[0]?.id || "") === where), "every paper filed by the earlier version is where it was, under its name");
      const dl = await NB.deadlines();
      check(dl.length === wantDeadlines(ALEX.filter((s) => s !== "unusable-answer")), `each letter's deadlines were made, once (${dl.length})`);
      // Which paper a reading was about: the strings its recorded answer is matched by.
      const squash = (t) => String(t).toLowerCase().replace(/\s+/g, " ");
      const kitAnswers = JSON.parse(fs.readFileSync(path.join(KITDIR, "answers.json"), "utf8"));
      const markerOf = (slug) => (kitAnswers.find((a) => (a.match || []).length && a.match.every((m) => squash(kitText(slug)).includes(squash(m)))) || {}).match || [];
      const readings = promptLog().filter((p) => p.system.startsWith("You summarise")).slice(upgrade.readings);
      const sortedBefore = ALEX.filter((s) => !HELD_BACK.includes(s) && !DOCS.find((d) => d.slug === s).presorted && !expected(s).check);
      const counts = sortedBefore.map((slug) => [slug, readings.filter((r) => markerOf(slug).every((m) => squash(r.prompt).includes(squash(m)))).length]);
      check(counts.every(([, n]) => n === 1), `each paper the earlier version sorted was read once for its deadlines (${counts.filter(([, n]) => n !== 1).map(([s, n]) => `${s}: ${n}`).join(", ") || `all ${counts.length}`})`);
    }

    section("F5, F6, F7, F8, F12: the kit, sorted and filed");
    const done = ALEX.filter((s) => s !== "unusable-answer");
    for (const slug of done) {
      const e = expected(slug), d = await doc(slug);
      const tags = d.tags.map((t) => nameOf(tagIds, t));
      await refreshNames();
      const tagsNow = d.tags.map((t) => nameOf(tagIds, t));
      const files = oneFile(fake, slug);
      const where = files[0] ? fake.pathOf(files[0].id) : "";
      const okFields = (!e.title || d.title === e.title) && (!("correspondent" in e) || nameOf(corrIds, d.correspondent) === e.correspondent)
        && (!e.document_type || nameOf(typeIds, d.document_type) === e.document_type) && (!e.created || d.created === e.created)
        && (e.tags_include || []).every((t) => tagsNow.includes(t)) && (e.tags_exclude || []).every((t) => !tagsNow.includes(t))
        // A document left to check keeps its scan title: with unreadable text there is nothing to
        // take a title from (F7). F5's test asks every kit document for a real title; the blurry
        // one cannot have one, so that part is checked on the sorted documents only.
        && (e.check || (!!d.title && d.title !== d.original_file_name.replace(/\.pdf$/, "")));
      check(okFields, `${slug}: title, sender, type, tags and date as expected${okFields ? "" : ` (got ${JSON.stringify({ title: d.title, sender: nameOf(corrIds, d.correspondent), type: nameOf(typeIds, d.document_type), created: d.created, tags })})`}`);
      check(files.length === 1 && where.split("/").slice(0, -1).join("/") === `Paperwork/${e.folder}`, `${slug}: exactly one file, in ${e.folder}${files.length === 1 ? "" : ` (${files.length} files)`}${where ? ` (${where})` : ""}`);
      if (!e.check) check(where.split("/").pop().replace(/ \(\d+\)\.pdf$/, ".pdf") === `${d.created} ${d.title}.pdf`, `${slug}: named <date> <title>.pdf`);
    }
    const permits = ["parking-permit-a", "parking-permit-b"].map((s) => fake.pathOf(oneFile(fake, s)[0]?.id || "")).sort();
    check(permits[0] === "Paperwork/Letters/2025-07-01 Residents parking permit renewal (2).pdf" && permits[1] === "Paperwork/Letters/2025-07-01 Residents parking permit renewal.pdf", "F8: the same date and title give two files");
    check(JSON.stringify(await api(samTok, "GET", `documents/${ids["second-account-letter"]}/`)) === samDoc && oneFile(fake, "second-account-letter").length === 0, "the other account's document is untouched and not in the drive");
    const prompts = fs.readFileSync(path.join(WORK, "prompts.jsonl"), "utf8");
    check(!prompts.includes("Riverside Book Club"), "the other account's document never reached the AI");
    const note = fake.byPath("Paperwork/Letters/handwritten note.pdf");
    check(!!note && fake.writes.every((w) => w.id !== note.id), "F8: the file placed by hand is untouched");
    check(fake.writes.every((w) => w.parents.every((p) => fake.pathOf(p).startsWith("Paperwork"))), "F8: nothing was written outside the documents folder");
    const madeFolders = fake.writes.filter((w) => w.op === "create-folder").map((w) => fake.pathOf(w.id)).sort();
    check(JSON.stringify(madeFolders) === JSON.stringify(["Paperwork/Invoices/Hollis Roofing", "Paperwork/Payslips/2025", "Paperwork/Taxes/2024", "Paperwork/To sort"]), `no stray folder: only the new sender, the missing years and To sort were made (${madeFolders.join(", ")})`);
    check(!fake.files().some((f) => / Scan d{4}-/.test(f.name) && !fake.pathOf(f.id).startsWith("Paperwork/To sort/")), "no file named after its scan outside To sort");

    if (NB) {
      section("F10, F11, F16, F17: the notes, the Documents collection, the message");
      const notes = await NB.notes(), items = await NB.items();
      const noteOf = (slug) => notes.filter((n) => n.clerk_doc === ids[slug]);
      let one = true, text = true, links = true, sums = true, fields = true;
      for (const slug of done) {
        const e = expected(slug), n = noteOf(slug), d = await doc(slug);
        const it = items.filter((i) => i.source_id === sumOf(slug));
        if (it.length !== 1) { fields = false; console.log(`        ${slug}: ${it.length} items`); continue; }
        if (e.not_in_notebook) {
          check(n.length === 0, `F11: ${slug}, uploaded with "Not in notebook", is sorted and filed but has no note`);
          check(JSON.stringify(Object.keys(it[0].data).sort()) === JSON.stringify(["added", "folder", "status"]) && it[0].data.status === "kept out of the notebook" && it[0].data.folder === e.folder,
            `F17: its item has no title, only when it was added, its folder and its status (${JSON.stringify(it[0].data)})`);
          continue;
        }
        if (n.length !== 1 || n[0].folder_path !== "Documents" || n[0].title !== d.title) { one = false; console.log(`        ${slug}: ${n.length} notes${n[0] ? `, folder ${n[0].folder_path}, title ${n[0].title === d.title ? "as in Paperless" : "different"}` : ""}`); continue; }
        if (!n[0].content.includes(String(d.content || "").replace(/\r\n?/g, "\n").replace(/\s+$/, ""))) text = false;
        const f = oneFile(fake, slug)[0];
        if (!n[0].content.includes(`(${PL}/documents/${ids[slug]}/details)`) || !n[0].content.includes(`(https://drive.google.com/file/d/${f.id}/view)`)) links = false;
        if (!e.check && !DOCS.find((x) => x.slug === slug).presorted && !n[0].clerk_summary) sums = false;
        const data = it[0].data;
        const okItem = data.title === d.title && data.folder === e.folder && data.status === (e.status || (e.check ? "check this" : "sorted")) && data.in_drive === true && data.deadlines === (e.item_deadlines ?? "")
          && data.paperless === `${PL}/documents/${ids[slug]}/details` && data.drive === `https://drive.google.com/file/d/${f.id}/view` && data.note.endsWith(`/dashboard/notes/${n[0].id}`);
        if (!okItem) { fields = false; console.log(`        ${slug}: item ${JSON.stringify(data)}`); }
      }
      check(one, "F10: exactly one note per document, in the folder Documents, titled as in Paperless");
      check(text, "F10: each note holds the document's full text as Paperless read it");
      check(links, "F10: each note links to the document in Paperless and to its file in the drive");
      check(sums, "F10: every document the Clerk sorted has its summary in the note");
      check(notes.length > 0 && notes.every((n) => n.skip_processing === true), "F10: every note is for search, not for the notebook's processing (skip_processing, kept by the real notebook)");
      check(items.length === done.length && fields, `F17: one item per document with every field as its expected-result file says (${items.length} of ${done.length})`);
      check((await NB.collections()).length === 1 && (await NB.collections())[0].name === "Documents", "F17: one collection, \"Documents\"");
      const blurry = await doc("blurry-scan");
      const parking = await doc("parking-notice"), meter = await doc("meter-letter");
      // F19: the storage paths mirror the plan, and the To sort page lists exactly the papers waiting.
      const sps = await all(alexTok, "storage_paths/");
      const spById = new Map(sps.map((x) => [x.id, x]));
      const toSort = sps.find((x) => x.name === "To sort");
      const view = (await all(alexTok, "saved_views/")).find((v) => v.name === "To sort");
      const viewLink = `${PL}/view/${view?.id}`;
      const waitingSlugs = done.filter((sl) => expected(sl).folder === "To sort");
      const listed = async () => (await all(alexTok, `documents/?storage_path__id=${toSort?.id}&fields=id`)).map((d) => d.id).sort((a, b) => a - b);
      check(!!toSort && toSort.matching_algorithm === 0 && toSort.path === "Paperwork/To sort/{{ added }} {{ title }}" && sps.filter((x) => x !== toSort && spById.get(x.id)).every((x) => x.matching_algorithm === 6),
        "F19: one storage path per plan folder, templates mirroring the drive; Auto matching, except To sort");
      let mirrored = true;
      for (const sl of done.filter((x) => expected(x).folder !== "To sort")) {
        const sp = spById.get((await doc(sl)).storage_path);
        const want = `Paperwork/${expected(sl).folder.replace(/\/\d{4}$/, "")}/`;
        if (!sp?.path.startsWith(want)) { mirrored = false; console.log(`        ${sl}: storage path ${sp?.name} ${sp?.path}`); }
      }
      check(mirrored, "F5, F19: every paper the Clerk filed carries the storage path of its folder");
      check(!!view && JSON.stringify(view.filter_rules.map((r) => [r.rule_type, String(r.value)])) === JSON.stringify([[25, String(toSort?.id)]]) && view.display_mode === "smallCards",
        `F19: a saved view "To sort" (storage path is To sort, small cards) (${JSON.stringify(view)})`);
      const ui = (await api(alexTok, "GET", "ui_settings/")).settings?.saved_views || {};
      check((ui.sidebar_views_visible_ids || []).includes(view?.id) && (ui.dashboard_views_visible_ids || []).includes(view?.id), "F19: shown in the sidebar and on the dashboard");
      check(JSON.stringify(await listed()) === JSON.stringify(waitingSlugs.map((sl) => ids[sl]).sort((a, b) => a - b)), `F19: the To sort page lists exactly the papers left in To sort (${waitingSlugs.join(", ")})`);
      const n = waitingSlugs.length, line = n === 1 ? "1 paper is waiting to be sorted." : `${n} papers are waiting to be sorted.`;
      if (!upgrade) check(TG.sent.length === 1 && TG.sent[0].includes(line) && [parking, meter].every((x) => TG.sent[0].includes(`"${x.title}"`)) && JSON.stringify(linksIn(TG.sent[0])) === JSON.stringify([viewLink]),
        `F16: the run over the kit sent exactly one message, counting the papers to sort and naming the letters whose deadlines need a check, with a link that opens the To sort page (${TG.sent.length}: ${JSON.stringify(TG.sent[0] || "")})`);
      else check(TG.sent.length === base + 1 && TG.sent[base].includes(line) && [parking, meter].every((x) => TG.sent[base].includes(`"${x.title}"`)) && JSON.stringify(linksIn(TG.sent[base])) === JSON.stringify([viewLink]),
        `F16: after the update exactly one message counts the papers to sort and names the letters whose deadlines need a check, with the To sort page's link (${TG.sent.length - base}: ${JSON.stringify(TG.sent[base] || "")})`);
      await must(state, ["run"], env);
      check(TG.sent.length === base + 1, "F16: a second run with nothing new sends none");

      section("F19: the person sorts in Paperless, and the drive follows");
      const letters = sps.find((x) => x.name === "Letters");
      await api(alexTok, "PATCH", `documents/${ids["blurry-scan"]}/`, { storage_path: letters.id });
      await must(state, ["run"], env);
      await refreshNames();
      const picked = await doc("blurry-scan");
      check(/^Paperwork\/Letters\//.test(fake.pathOf(oneFile(fake, "blurry-scan")[0]?.id || "")) && oneFile(fake, "blurry-scan").length === 1, `picking Letters as its storage path moves its drive file there at the next run (${fake.pathOf(oneFile(fake, "blurry-scan")[0]?.id || "")})`);
      check(!picked.tags.includes(tagIds["Check this"]) && picked.storage_path === letters.id, "Check this is off, and the person's pick stays");
      check(!(await listed()).includes(ids["blurry-scan"]), "it is off the To sort page");
      const bytes = await api(alexTok, "GET", `documents/${ids["blurry-scan"]}/download/`, undefined, { raw: true });
      check(bytes.length > 1000, "Paperless still serves the paper after keeping it under its new storage path");
      await must(state, ["run"], env);
      check(TG.sent.length === base + 1, "sorting a paper sends no message");

      section("F15: deadlines from letters, in Godspeed");
      const dl = await NB.deadlines();
      const ofDoc = (slug) => dl.filter((x) => x.key.startsWith(keyOf(sumOf(slug), "")));
      const water = ofDoc("water-invoice");
      check(water.length === 1 && water[0].due === "2026-11-20" && water[0].link === `${PL}/documents/${ids["water-invoice"]}/details` && water[0].title === "Pay the Brightwater Utilities electricity invoice of 212.40 EUR",
        `the letter with a deadline in the future made exactly one deadline with the right date and a link to the document (${JSON.stringify(water)})`);
      const file = water[0] ? fs.readFileSync(path.join(NB.ws, "due", `${water[0].slug}.md`), "utf8") : "";
      check(/^ADDON: godspeed-clerk$/m.test(file) && file.includes(`ADDON-KEY: ${keyOf(sumOf("water-invoice"), 1)}`) && /^STRIP: \S+ 2026-11-20$/m.test(file), "it is an ordinary deadline file in Godspeed's due/, carrying the document's mark and which request it is");
      check(ofDoc("library-reminder").length === 0, "a letter whose deadline has passed made none");
      const libNote = (await NB.notes()).find((n) => n.clerk_doc === ids["library-reminder"]);
      check(!!libNote && libNote.content.split("## Key facts")[1]?.split("##")[0].includes("Pay the Fairford Library fine of 12.50 EUR: by 2026-08-31, already passed"), "and it is written into the note's key facts");
      const tax = ofDoc("tax-office-letter").map((x) => x.due).sort();
      check(JSON.stringify(tax) === JSON.stringify(["2026-11-13", "2026-11-30"]), `the letter with two requests made two (${tax.join(", ")})`);
      const pk = ofDoc("parking-notice");
      check(pk.length === 1 && pk[0].due === "2026-11-09" && /\(check the date\)$/.test(pk[0].title), `the letter whose period runs from receipt made one counted from its printed date, marked "check the date" (${JSON.stringify(pk)})`);
      check(ofDoc("gym-letter").length === 0, "a vague request made none");
      const gymNote = (await NB.notes()).find((n) => n.clerk_doc === ids["gym-letter"]);
      check(!!gymNote && gymNote.content.includes("Return the signed membership form to Elm Row Fitness (no date given)"), "and it is in the note's key facts");
      check(ofDoc("meter-letter").length === 0 && meter.tags.includes(tagIds["Check this"]), "no printed date to count from: no deadline, and the letter is to check");
      const clinic = ofDoc("clinic-letter");
      check(clinic.length === 1 && clinic[0].title === "Follow-up appointment reminder, 2026-10-14" && clinic[0].due === "2026-11-27", `F11: the letter kept out of the notebook has its deadline, named only by its title and date (${JSON.stringify(clinic)})`);
      check(dl.length === wantDeadlines(ALEX.filter((s) => s !== "unusable-answer")), `no other deadline (${dl.length})`);
      const said = await NB.remindersOn("2026-11-18");
      check(said.includes("Pay the Brightwater Utilities electricity invoice of 212.40 EUR"), `Godspeed's own deadline reminders say it as its day comes (tools/due.js today on 18 November: ${JSON.stringify(said.slice(0, 300))})`);
      check(/Deadlines: 5 made in Godspeed from your letters\./.test((await must(state, ["status"], env)).out), "status says how many deadlines the Clerk made");
    } else console.log("  SKIP  the notes, the collection and the message (GODSPEED_NOTEBOOK_CHECKOUT is not set)");

    section("F8: changes in Paperless and by hand in the drive");
    // The person adds a line of their own to a note, as in the notebook's editor.
    const mine = NB ? (await NB.notes()).find((x) => x.clerk_doc === ids["utility-invoice"]) : null;
    if (mine) await NB.query({ table: "notes", operation: "update", values: { content: `Keep until 2032.\n\n${mine.content}\nPaid on 25 March, checked against the bank statement.\n` }, filters: [["eq", "id", mine.id]], expected: { [mine.id]: mine._hash } });
    await api(alexTok, "PATCH", `documents/${ids["utility-invoice"]}/`, { title: "Electricity bill for February" });
    const council = oneFile(fake, "council-letter")[0];
    fake.userMove(council.id, "Paperwork/Insurance");
    const councilName = fake.pathOf(council.id).split("/").pop();
    await api(alexTok, "PATCH", `documents/${ids["council-letter"]}/`, { title: "New bin collection days" });
    await runUntilQuiet(state, env);
    check(fake.pathOf(oneFile(fake, "utility-invoice")[0].id) === "Paperwork/Invoices/Brightwater Utilities/2025-03-04 Electricity bill for February.pdf", "renaming a document in Paperless renames its file");
    check(fake.pathOf(council.id) === `Paperwork/Insurance/${councilName}`, "a file moved by hand stays where it was put after its title changes");
    if (mine) {
      const n = (await NB.notes()).filter((x) => x.clerk_doc === ids["utility-invoice"]);
      check(n.length === 1 && n[0].id === mine.id && n[0].title === "Electricity bill for February" && /\nPaid on 25 March, checked against the bank statement\.\n?$/.test(n[0].content) && n[0].content.split("Paid on 25 March").length === 2
        && n[0].content.startsWith("Keep until 2032.\n\n- **"),
        "F10: renaming a document updates the same note and keeps the lines the person added, below and above the Clerk's part");
      const it = (await NB.items()).filter((i) => i.source_id === sumOf("utility-invoice"));
      check(it.length === 1 && it[0].data.title === "Electricity bill for February", "F17: renaming a document updates its item");
      const cn = (await NB.notes()).filter((x) => x.clerk_doc === ids["council-letter"]);
      check(cn.length === 1 && cn[0].content.includes("Insurance"), "the note of a file moved by hand names the folder it is in now");
    }

    section("F8: a document deleted in Paperless");
    const inj = fake.pathOf(oneFile(fake, "injection-letter")[0].id);
    await api(alexTok, "DELETE", `documents/${ids["injection-letter"]}/`);
    await runUntilQuiet(state, env);
    check(fake.pathOf(oneFile(fake, "injection-letter")[0]?.id || "") === inj, "its file stays in the drive");
    check(outbox(state).filter((n) => n.kind === "deleted-in-paperless" && n.doc === ids["injection-letter"]).length === 1, "and the person will hear it once");
    if (NB) check(TG.sent.length === base + 2 && /Deleted in Paperless, its file stays in your drive: "Garage space offer on Station Road"/.test(TG.sent[base + 1]) && linksIn(TG.sent[base + 1]).length === 1, `F16: one message names the deleted document, with one link (${JSON.stringify(TG.sent[base + 1] || "")})`);
    const record = (slug) => JSON.parse(fs.readFileSync(path.join(state, "records", `${ids[slug]}.json`), "utf8"));
    check(!!record("injection-letter").gone, "its record says it is gone (Paperless answers 404 for a document in its bin)");
    await api(alexTok, "POST", "trash/", { action: "restore", documents: [ids["injection-letter"]] });
    await api(alexTok, "PATCH", `documents/${ids["injection-letter"]}/`, { title: "Garage space on Station Road" });
    await runUntilQuiet(state, env);
    check(!record("injection-letter").gone, "taken out of Paperless's bin, it is not gone any more");
    check(oneFile(fake, "injection-letter").length === 1 && fake.pathOf(oneFile(fake, "injection-letter")[0].id) === "Paperwork/Letters/2025-07-09 Garage space on Station Road.pdf", "and its one file follows its new title");

    section("F8: Google access withdrawn, then back");
    fake.revoke();
    const writes = fake.writes.length;
    await upload(["unusable-answer"]);
    await must(state, ["run"], env);
    await must(state, ["run"], env);
    check(fake.writes.length === writes, "a run files nothing while access is gone");
    check(outbox(state).filter((n) => n.kind === "drive-lost").length === 1, "one notice asks to reconnect");
    check(/access LOST/.test((await must(state, ["status"], env)).out), "status shows the lost access");
    const ua = await doc("unusable-answer");
    await refreshNames();
    check(ua.tags.includes(tagIds["Check this"]) && !ua.tags.includes(tagIds.Inbox) && ua.correspondent === null, "F7: sorting goes on in Paperless: the answer unusable twice gives Check this");
    await connectDrive(state, fake);
    await runUntilQuiet(state, env);
    check(oneFile(fake, "unusable-answer").length === 1 && /^Paperwork\/To sort\//.test(fake.pathOf(oneFile(fake, "unusable-answer")[0].id)), "after reconnecting the waiting document is filed once, into To sort");
    check(fake.writes.slice(writes).filter((w) => w.op === "upload").length === 1, "exactly one upload after reconnecting");
    check(!/LOST/.test((await must(state, ["status"], env)).out), "status no longer shows a loss");
    if (NB) {
      const last = TG.sent[TG.sent.length - 1] || "";
      const view = (await all(alexTok, "saved_views/")).find((v) => v.name === "To sort");
      check(TG.sent.length === base + 3 && /Google Drive no longer lets the Clerk file your papers/.test(last) && last.includes("1 paper is waiting to be sorted.") && JSON.stringify(linksIn(last)) === JSON.stringify([`${PL}/view/${view?.id}`]),
        `F16: lost access and the paper to sort from that run came as one message with one link, the To sort page (${TG.sent.length}: ${JSON.stringify(last)})`);
      check((await NB.notes()).filter((x) => x.clerk_doc === ids["unusable-answer"]).length === 1, "F10: after reconnecting, the waiting document has its note");

      section("F19: a storage path the person makes becomes a folder inside the documents folder");
      const mine = await api(alexTok, "POST", "storage_paths/", { name: "Library", path: "library/{{ title }}", matching_algorithm: 0 });
      await api(alexTok, "PATCH", `documents/${ids["unusable-answer"]}/`, { storage_path: mine.id });
      await must(state, ["run"], env);
      check(!!fake.byPath("Paperwork/Library") && /^Paperwork\/Library\//.test(fake.pathOf(oneFile(fake, "unusable-answer")[0]?.id || "")), `the folder is made inside the documents folder and the paper filed there (${fake.pathOf(oneFile(fake, "unusable-answer")[0]?.id || "")})`);
      const after = await api(alexTok, "GET", `storage_paths/${mine.id}/`);
      check(after.name === "Library" && after.path === "library/{{ title }}", "the person's own storage path is not changed");
      check(TG.sent.length === base + 3, "no message about it");
    }

    if (NB) {
      section("F11: the tag added to documents that already have a note");
      const keep = tagIds["Not in notebook"];
      const notes = await NB.notes();
      const taNote = notes.find((x) => x.clerk_doc === ids["tax-assessment"]);
      const psNote = notes.find((x) => x.clerk_doc === ids["pay-slip"]);
      await NB.query({ table: "notes", operation: "update", values: { content: `${psNote.content}\nAsk payroll about the bonus.\n` }, filters: [["eq", "id", psNote.id]], expected: { [psNote.id]: psNote._hash } });
      for (const slug of ["tax-assessment", "pay-slip"]) await api(alexTok, "PATCH", `documents/${ids[slug]}/`, { tags: [...(await doc(slug)).tags, keep] });
      await runUntilQuiet(state, env);
      const after = await NB.notes();
      const t = after.find((x) => x.id === taNote.id), p2 = after.find((x) => x.id === psNote.id);
      check(t?.is_trashed === true && !t.content.includes("103/5550/7781") && !JSON.stringify(t).includes(taNote.title) && t.clerk_summary === null,
        "F11: adding the tag to a noted document trashes its note, with the Clerk's text taken out");
      check(p2?.is_trashed === false && p2.content.trim() === "Ask payroll about the bonus." && p2.title === "Document kept out of the notebook",
        "F11: adding it to a noted document with a line the person added leaves a note holding only that line");
      const ki = (await NB.items()).find((i) => i.source_id === sumOf("tax-assessment"));
      check(!!ki && JSON.stringify(Object.keys(ki.data).sort()) === JSON.stringify(["added", "folder", "status"]) && ki.data.status === "kept out of the notebook", "F17: its item shrinks to the kept-out form, without a title");
      check(TG.sent.length === base + 3, "nothing in this to act on: no message");
    }

    if (NB) {
      section("F15: the person's own date, and a corrected letter date");
      const one = async (slug) => (await NB.deadlines()).filter((x) => x.key.startsWith(keyOf(sumOf(slug), "")));
      const moveByHand = (d, day) => { const f = path.join(NB.ws, "due", `${d.slug}.md`); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^(STRIP: \S+) \S+$/m, `$1 ${day}`)); };
      // The person moves the water bill's day by hand, the way the deadline files are meant to be edited.
      moveByHand((await one("water-invoice"))[0], "2026-11-27");
      // The parking notice's date is corrected in Paperless: its untouched deadline, counted from it, moves.
      await api(alexTok, "PATCH", `documents/${ids["parking-notice"]}/`, { created: "2026-10-12" });
      await runUntilQuiet(state, env);
      check((await one("parking-notice"))[0]?.due === "2026-11-12", "a corrected letter date moves the untouched deadline counted from it");
      check((await one("water-invoice"))[0]?.due === "2026-11-27", "the deadline the person moved keeps the person's date");
      moveByHand((await one("parking-notice"))[0], "2026-11-16");
      await api(alexTok, "PATCH", `documents/${ids["parking-notice"]}/`, { created: "2026-10-13" });
      await runUntilQuiet(state, env);
      check((await one("parking-notice"))[0]?.due === "2026-11-16" && (await one("parking-notice")).length === 1, "once the person moved it, a corrected letter date leaves the person's date");
    }

    section("F18: the records deleted");
    const w2 = fake.writes.length, s2 = await snapshot();
    const inNotebook = async () => (NB ? JSON.stringify([...(await NB.notes()), ...(await NB.items())].map((x) => `${x.id} ${x._hash}`).sort().concat((await NB.deadlines()).map((d) => JSON.stringify(d)).sort())) : "");
    const nb2 = await inNotebook();
    fs.rmSync(path.join(state, "records"), { recursive: true, force: true });
    await runUntilQuiet(state, env);
    check(fake.writes.length === w2, "no second file, no move, no rename");
    check(await snapshot() === s2, "nothing changed in Paperless");
    if (NB) check(await inNotebook() === nb2, "F10, F15, F17: no second note, item or deadline, and not one rewritten; the person's dates stay");

    section("F14: private by default");
    const sentences = DOCS.flatMap((d) => kitText(d.slug).split(/[.\n]/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 4));
    const titles = (await all(alexTok, "documents/?fields=title")).map((d) => d.title).filter((t) => t.split(/\s+/).length >= 2);
    const files = [];
    const walk = (dir) => { for (const n of fs.existsSync(dir) ? fs.readdirSync(dir) : []) { const f = path.join(dir, n); fs.statSync(f).isDirectory() ? walk(f) : files.push(f); } };
    walk(path.join(state, "records"));
    const known = ["settings.json", "paperless.json", "drive.json", "plan.json", "state.json", "clerk.log", "outbox.jsonl", "links.json", "drive-tree.json", "drive-tree-position.json", "records", "mirror.json"];
    const strays = fs.readdirSync(state).filter((n) => !known.includes(n));
    check(strays.length === 0, `no temporary file: the state folder holds only the Clerk's own files${strays.length ? ` (${strays.join(", ")})` : ""}`);
    files.push(...["clerk.log", "state.json", "outbox.jsonl", "links.json", "mirror.json"].map((n) => path.join(state, n)).filter(fs.existsSync));
    const noteBits = NB ? (await NB.notes()).flatMap((n) => [n.clerk_summary, ...(n.clerk_facts || []), ...((n.clerk_asks?.items || []).map((a) => a.ask))]).filter(Boolean).concat((await NB.deadlines()).map((d) => d.title.replace(/ \(check the date\)$/, ""))) : [];
    const leaks = files.filter((f) => { const b = fs.readFileSync(f, "utf8"); return sentences.some((s) => b.includes(s)) || titles.some((t) => b.includes(t)) || noteBits.some((x) => b.includes(x)); });
    check(leaks.length === 0, `no log line, record or temporary file holds a sentence, a title or a note's summary${leaks.length ? `: ${leaks.join(", ")}` : ""}`);
    check(files.every((f) => (fs.statSync(f).mode & 0o777) === 0o600), "every file the Clerk keeps is readable by its owner only");
    if (NB) check(TG.sent.every((m) => linksIn(m).length === 1), "F16: every message carried exactly one link");
  } finally { await fake.close(); await NB?.stop(); await TG?.close(); }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(`\nThe full test stopped: ${e.stack || e.message}`); process.exit(2); });
