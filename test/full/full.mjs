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
// The test itself does what the Clerk never does: it makes users, uploads, deletes a document.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeDrive } from "../fakes/drive.mjs";

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

// ------------------------------------------------------------------ the Clerk, as its own process
const WORK = tmp("work");
const ANSWERS = path.join(WORK, "answers.json");
fs.copyFileSync(path.join(KITDIR, "answers.json"), ANSWERS);
const WS = path.join(WORK, "godspeed");
fs.mkdirSync(WS);
fs.writeFileSync(path.join(WS, "AGENTS.md"), "A made-up Godspeed folder for the full test.\n");

function clerk(state, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "bin", "godspeed-clerk.mjs"), ...args, "--state", state], {
      env: { ...process.env, GODSPEED_MODEL_COMMAND: path.join(ROOT, "test", "fakes", "model.mjs"), GODSPEED_CLERK_FAKE_ANSWERS: ANSWERS,
        GODSPEED_CLERK_FAKE_PROMPTS: path.join(WORK, "prompts.jsonl"), PAPERLESS_PASSWORD: PW.alex, GODSPEED_CLERK_UPLOAD_CHUNK: "65536", ...env },
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code, signal) => resolve({ code, signal, out, err }));
  });
}
async function must(state, args, env) {
  const r = await clerk(state, args, env);
  if (r.code !== 0) throw new Error(`godspeed-clerk ${args.join(" ")} failed (${r.code} ${r.signal || ""}): ${r.err || r.out}`);
  return r;
}
async function runUntilQuiet(state, env, max = 10) {
  let last;
  for (let i = 0; i < max; i++) {
    last = await must(state, ["run"], env);
    const m = last.out.match(/(\d+) copied to the drive, (\d+) sorted, (\d+) to check, (\d+) filed\. .*?; (\d+) waiting/);
    if (!m || m.slice(1).every((x) => x === "0")) break;
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
async function setUp(mode, fake) {
  const state = tmp(mode);
  const env = fake.env;
  await must(state, ["setup", "--paperless", PL, "--user", "alex", "--godspeed", WS, "--no-service", "--no-copy", "--sorting", mode, "--country", KIT.country], env);
  await must(state, ["settings", "about", KIT.profile], env);
  await must(state, ["settings", "tag_rules", JSON.stringify(KIT.paperless.tag_rules)], env);
  await must(state, ["settings", "settle_minutes", "0"], env);
  await connectDrive(state, fake);
  await must(state, ["drive", "folder", "Paperwork"], env);
  const p = await must(state, ["plan", "propose"], env);
  await must(state, ["plan", "confirm"], env);
  await must(state, ["resume"], env);
  return { state, env, proposal: p.out };
}
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
    try {
      const before = await snapshot();
      const { state, env } = await setUp(mode, fake);
      await runUntilQuiet(state, env);
      check(await snapshot() === before, "every document, tag, sender, type and custom field in Paperless is exactly as before");
      const here = ALEX.filter((s) => !HELD_BACK.includes(s));
      check(here.every((s) => oneFile(fake, s).length === 1), `every document is filed, once (${here.length})`);
      check(fake.pathOf(oneFile(fake, "bank-certificate")[0]?.id || "") === "Paperwork/Taxes/2024/2025-02-14 Yearly tax certificate 2024.pdf", "the document sorted before goes where the plan says");
      check(oneFile(fake, "second-account-letter").length === 0, "the other account's document is not copied");
    } finally { await fake.close(); }
  }

  section("Godspeed sorts: the plan, the first copies");
  const fake = await startFakeDrive({ tree: KIT.drive.tree, account: KIT.drive.account });
  try {
    const { state, env } = await setUp("godspeed", fake);
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

    section("F18: killed after each step in turn, and in the middle of an upload");
    await upload(["roofing-invoice", "pay-slip"]);
    for (const point of ["after-copy", "mid-upload", "after-sort", "after-file"]) {
      const r = await clerk(state, ["run"], { ...env, GODSPEED_CLERK_CRASH_AT: point });
      check(r.signal === "SIGKILL", `killed at ${point}`);
    }
    await runUntilQuiet(state, env);

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
        && !!d.title && d.title !== d.original_file_name.replace(/\.pdf$/, "");
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

    section("F8: changes in Paperless and by hand in the drive");
    await api(alexTok, "PATCH", `documents/${ids["utility-invoice"]}/`, { title: "Electricity bill for February" });
    const council = oneFile(fake, "council-letter")[0];
    fake.userMove(council.id, "Paperwork/Insurance");
    const councilName = fake.pathOf(council.id).split("/").pop();
    await api(alexTok, "PATCH", `documents/${ids["council-letter"]}/`, { title: "New bin collection days" });
    await runUntilQuiet(state, env);
    check(fake.pathOf(oneFile(fake, "utility-invoice")[0].id) === "Paperwork/Invoices/Brightwater Utilities/2025-03-04 Electricity bill for February.pdf", "renaming a document in Paperless renames its file");
    check(fake.pathOf(council.id) === `Paperwork/Insurance/${councilName}`, "a file moved by hand stays where it was put after its title changes");

    section("F8: a document deleted in Paperless");
    const inj = fake.pathOf(oneFile(fake, "injection-letter")[0].id);
    await api(alexTok, "DELETE", `documents/${ids["injection-letter"]}/`);
    await runUntilQuiet(state, env);
    check(fake.pathOf(oneFile(fake, "injection-letter")[0]?.id || "") === inj, "its file stays in the drive");
    check(outbox(state).filter((n) => n.kind === "deleted-in-paperless" && n.doc === ids["injection-letter"]).length === 1, "and the person will hear it once");

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

    section("F18: the records deleted");
    const w2 = fake.writes.length, s2 = await snapshot();
    fs.rmSync(path.join(state, "records"), { recursive: true, force: true });
    await runUntilQuiet(state, env);
    check(fake.writes.length === w2, "no second file, no move, no rename");
    check(await snapshot() === s2, "nothing changed in Paperless");

    section("F14: private by default");
    const sentences = DOCS.flatMap((d) => kitText(d.slug).split(/[.\n]/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 4));
    const titles = (await all(alexTok, "documents/?fields=title")).map((d) => d.title).filter((t) => t.split(/\s+/).length >= 2);
    const files = [];
    const walk = (dir) => { for (const n of fs.existsSync(dir) ? fs.readdirSync(dir) : []) { const f = path.join(dir, n); fs.statSync(f).isDirectory() ? walk(f) : files.push(f); } };
    walk(path.join(state, "records")); walk(path.join(state, "tmp"));
    files.push(...["clerk.log", "state.json", "outbox.jsonl"].map((n) => path.join(state, n)).filter(fs.existsSync));
    const leaks = files.filter((f) => { const b = fs.readFileSync(f, "utf8"); return sentences.some((s) => b.includes(s)) || titles.some((t) => b.includes(t)); });
    check(leaks.length === 0, `no log line, record or temporary file holds a sentence or a title${leaks.length ? `: ${leaks.join(", ")}` : ""}`);
    check(files.every((f) => (fs.statSync(f).mode & 0o777) === 0o600), "every file the Clerk keeps is readable by its owner only");
  } finally { await fake.close(); }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(`\nThe full test stopped: ${e.stack || e.message}`); process.exit(2); });
