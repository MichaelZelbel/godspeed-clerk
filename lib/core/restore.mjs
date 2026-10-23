// F9: a restore copy, and rebuilding from it.
//
// THE CLERK'S OWN FOLDER, "The Clerk" at the top of the person's drive, marked (clerkOwn) so it is
// found again; everything in it carries the mark clerkCopy, and the Clerk writes nowhere else in it.
// It holds:
//   records/clerk-records.json   the Clerk's own records: settings, the confirmed folder plan, the
//                                storage paths it keeps, and per document its file, note, item and
//                                deadlines (numbers, marks and links). Every night, on every Paperless.
//   paperless/                   on a Paperless the Clerk installed, while every document there is
//                                the person's: Paperless's full export (originals/, archive/,
//                                manifest.json, metadata.json with the version that made it), the
//                                Clerk's records of that night beside it, and restore.json last,
//                                which says the copy is whole.
// Only files whose checksum changed since the night before are uploaded, a few minutes per run, so
// a first night with thousands of papers never holds new scans back. A Paperless where another
// account keeps documents is never exported (its export would hold their papers); the person hears
// it once. A Paperless the Clerk did not install is never exported (section 4).
//
// THE REBUILD (godspeed-clerk restore), on a new server where the Clerk installed an empty
// Paperless: the version that made the export first (Paperless imports only into that version),
// the export imported, the Clerk's records of that night back, then the usual update to the newest
// tested version. The export leaves sign-in tokens out, so the phone signs in once more. What came
// after that night is found again through the marks on files, notes and deadlines (F18).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { FOLDER, DriveError } from "./drive.mjs";
import { readJson, writeJson, ensurePrivateDir } from "./files.mjs";
import { Records, now } from "./records.mjs";

export const OWN_NAME = "The Clerk";
export const RESTORE_FILE = "restore.json";
const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");
const q = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const TYPES = { ".pdf": "application/pdf", ".json": "application/json" };
const typeOf = (rel) => TYPES[path.extname(rel).toLowerCase()] || "application/octet-stream";
const dirOf = (rel) => (path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel));

// The Clerk's own folder: by its mark, else a folder called "The Clerk" at the top that holds a
// restore copy or records (made by the same Clerk with another Google app). Made when asked.
export async function findOwn(drive, { create = false } = {}) {
  const top = `'root' in parents and mimeType = ${q(FOLDER)} and trashed = false`;
  const marked = await drive.list(`${top} and appProperties has { key='clerkOwn' and value='1' }`, "id,name,appProperties");
  if (marked.length) return marked[0];
  for (const f of await drive.list(`${top} and name = ${q(OWN_NAME)}`, "id,name,appProperties")) {
    const kids = await drive.list(`${q(f.id)} in parents and trashed = false`, "id,name");
    if (kids.some((k) => k.name === "records" || k.name === "paperless" || k.name === RESTORE_FILE)) return f;
  }
  if (!create) return null;
  return drive.createFolder(OWN_NAME, "root", { clerkOwn: "1" });
}

// Writing inside the Clerk's own folder, by path ("paperless/originals/x.pdf"). An index (kept in the
// state folder) says which file is which and its checksum; lost, it is read again from the drive.
export class OwnCopy {
  constructor(drive, own, index = null) {
    this.drive = drive;
    this.own = own;
    this.index = index && index.own === own.id ? index : { own: own.id, folders: { "": own.id }, files: {}, learned: false };
  }
  async learn() {
    const walk = async (rel, id) => {
      for (const f of await this.drive.list(`${q(id)} in parents and trashed = false`, "id,name,mimeType,md5Checksum,size,appProperties")) {
        const r = rel ? `${rel}/${f.name}` : f.name;
        if (f.mimeType === FOLDER) { this.index.folders[r] ||= f.id; await walk(r, f.id); }
        else if (!this.index.files[r] || this.index.files[r].id === f.id) this.index.files[r] = { id: f.id, md5: f.md5Checksum, size: Number(f.size || 0), mine: f.appProperties?.clerkCopy === "1" };
      }
    };
    await walk("", this.own.id);
    this.index.learned = true;
  }
  async folderFor(rel) {
    if (this.index.folders[rel]) return this.index.folders[rel];
    const parent = await this.folderFor(dirOf(rel));
    const name = path.posix.basename(rel);
    const hit = (await this.drive.list(`${q(parent)} in parents and mimeType = ${q(FOLDER)} and trashed = false and name = ${q(name)}`, "id,name"))[0];
    const id = hit?.id || (await this.drive.createFolder(name, parent, { clerkCopy: "1" })).id;
    this.index.folders[rel] = id;
    return id;
  }
  // Uploads when the checksum differs. Returns true when it uploaded.
  async put(rel, bytes) {
    const sum = md5(bytes);
    const known = this.index.files[rel];
    if (known?.md5 === sum) return false;
    const contentType = typeOf(rel);
    const f = known?.id && known.mine
      ? await this.drive.upload({ fileId: known.id, bytes, contentType })
      : await this.drive.upload({ name: path.posix.basename(rel), parentId: await this.folderFor(dirOf(rel)), bytes, contentType, appProperties: { clerkCopy: "1" } });
    if (f.md5Checksum && f.md5Checksum !== sum) throw new DriveError(`the copy of ${rel} in the drive does not match what was sent`);
    this.index.files[rel] = { id: f.id, md5: sum, size: bytes.length, mine: true };
    return true;
  }
  async get(rel) {
    const k = this.index.files[rel];
    return k ? this.drive.download(k.id) : null;
  }
  under(prefix) { return Object.keys(this.index.files).filter((r) => r.startsWith(`${prefix}/`)); }
}

// The Clerk's own records, in one file: numbers, marks, folder ids, links; no document's text.
export function recordsBundle(paths, { clerkVersion = "" } = {}) {
  const st = readJson(paths.state, {});
  return {
    format: 1, made_at: now(), clerk_version: clerkVersion,
    settings: readJson(paths.settings, {}), plan: readJson(paths.plan, null), mirror: readJson(paths.mirror, null), links: readJson(paths.links, {}),
    records: new Records(paths).all(), notify_sent: st.notify?.sent || {}, started_at: st.started_at || null,
  };
}

const localDay = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function* walkFiles(root, rel = "") {
  let entries = [];
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walkFiles(root, r);
    else if (e.isFile()) yield r;
  }
}

// Is the nightly copy due? Once a day from `copy_hour` (the server's own time), and on every run
// while an upload is still going.
export function copyDue(st, settings, t) {
  const c = st.copy || {};
  if (c.phase === "upload") return true;
  return c.day !== localDay(t) && new Date(t).getHours() >= Number(settings.copy_hour ?? 2);
}

// The nightly copy. `host` is the installed Paperless (host.mjs), or null for one the Clerk did not
// install. Returns { ran, records, exported, uploaded, done, shared, why }.
export async function copyStep(ctx, { host = null, user = null, force = false, clerkVersion = "" } = {}) {
  const { paths, settings } = ctx;
  const t = ctx.clock();
  const st = readJson(paths.state, {});
  const c = st.copy || {};
  const out = { ran: false, records: false, exported: false, uploaded: 0, done: false };
  if (!force && !copyDue(st, settings, t)) return out;
  if (!ctx.driveConn) { out.why = "Google Drive is not connected yet"; return out; }
  out.ran = true;
  const drive = ctx.drive();
  const own = await findOwn(drive, { create: true });
  const copy = new OwnCopy(drive, own, readJson(paths.restoreIndex, null));
  if (!copy.index.learned) await copy.learn();
  const keep = () => writeJson(paths.restoreIndex, copy.index);
  const save = () => { st.copy = c; writeJson(paths.state, st); };
  try {
    // 1. The Clerk's own records, on every Paperless.
    const bundle = Buffer.from(JSON.stringify(recordsBundle(paths, { clerkVersion })));
    if (c.phase !== "upload") { out.records = await copy.put("records/clerk-records.json", bundle); keep(); }
    // 2. Paperless's export, on one the Clerk installed and only while every document is the person's.
    if (host) {
      if (c.phase !== "upload") {
        const owners = host.owners();
        const others = Object.keys(owners).filter((n) => n && n !== user);
        if (others.length) {
          if (!c.shared_since) { c.shared_since = now(); ctx.outbox({ kind: "shared-paperless", since: c.shared_since }); ctx.log(`restore copy: another account keeps documents in this Paperless (${others.length} account(s)); its export stops`); }
          out.shared = true;
          Object.assign(c, { day: localDay(t), last_ok_at: now(), phase: "done" });
          save();
          return out;
        }
        if (c.shared_since) { delete c.shared_since; ctx.log("restore copy: every document is the person's again; the export goes on"); }
        host.exportNow();
        Object.assign(c, { phase: "upload", export_at: now(), version: host.rec.version, image: host.rec.image });
        save();
        out.exported = true;
        ctx.log(`restore copy: Paperless ${host.rec.version} exported`);
      }
      const root = path.join(host.dir, "export");
      const until = ctx.clock() + Number(settings.copy_minutes ?? 4) * 60000;
      const last = new Set(["manifest.json", "metadata.json"]);
      const files = [...walkFiles(root)].filter((r) => !last.has(r));
      // A file whose size and time are those it had when it was uploaded is unchanged (the exporter
      // rewrites only what changed, -c): it is not even read. Only uploads count against the time.
      let left = 0, since = 0;
      for (const rel of files) {
        const full = path.join(root, rel), stt = fs.statSync(full), key = `paperless/${rel}`;
        const k = copy.index.files[key];
        if (k && k.size === stt.size && k.mtime === stt.mtimeMs) continue;
        if (ctx.clock() > until && !force) { left++; continue; }
        if (await copy.put(key, fs.readFileSync(full))) { out.uploaded++; since++; }
        copy.index.files[key].mtime = stt.mtimeMs;
        if (since >= 25) { keep(); since = 0; }
      }
      keep();
      if (left) { ctx.log(`restore copy: ${out.uploaded} file(s) uploaded, ${left} more next run`); save(); return out; }
      const manifest = fs.readFileSync(path.join(root, "manifest.json"));
      for (const rel of ["metadata.json", "manifest.json"]) { if (await copy.put(`paperless/${rel}`, fs.readFileSync(path.join(root, rel)))) out.uploaded++; }
      await copy.put("paperless/clerk-records.json", bundle);
      const docs = JSON.parse(manifest.toString("utf8")).filter((o) => o.model === "documents.document").length;
      await copy.put(`paperless/${RESTORE_FILE}`, Buffer.from(JSON.stringify({ format: 1, made_at: now(), paperless_version: c.version, image: c.image, documents: docs, manifest_md5: md5(manifest), user, clerk_version: clerkVersion }, null, 1)));
      keep();
      ctx.log(`restore copy: whole, ${docs} documents, ${out.uploaded} file(s) uploaded`);
    }
    Object.assign(c, { phase: "done", day: localDay(t), last_ok_at: now(), fails: 0 });
    delete c.last_error;
    out.done = true;
    save();
    return out;
  } catch (e) {
    keep();
    c.fails = (c.fails || 0) + (c.phase === "upload" ? 0 : 1);
    c.last_error = String(e.message).slice(0, 200);
    if (c.phase !== "upload") c.day = localDay(t);
    if (c.fails >= 2 && c.told_fail !== c.day) { c.told_fail = c.day; ctx.outbox({ kind: "copy-failed", why: c.last_error }); }
    save();
    throw e;
  }
}

// What a drive holds for a rebuild: { own, restore, copy } or null.
export async function findRestoreCopy(drive, { index = null } = {}) {
  const own = await findOwn(drive);
  if (!own) return null;
  const copy = new OwnCopy(drive, own, index);
  await copy.learn();
  const raw = await copy.get(`paperless/${RESTORE_FILE}`);
  if (!raw) return { own, restore: null, copy };
  return { own, restore: JSON.parse(raw.toString("utf8")), copy };
}

// The Clerk's records of the restore copy, back in the state folder. Settings that belong to this
// machine (its Godspeed folder, its address, its Telegram) stay as they are here.
export function takeRecordsBack(paths, bundle, { keepSettings = ["workspace", "paperless_web", "telegram_env", "talk"] } = {}) {
  ensurePrivateDir(paths.root);
  const here = readJson(paths.settings, {});
  const settings = { ...bundle.settings };
  for (const k of keepSettings) if (here[k] !== undefined) settings[k] = here[k];
  writeJson(paths.settings, settings);
  if (bundle.plan) writeJson(paths.plan, bundle.plan);
  if (bundle.mirror) writeJson(paths.mirror, bundle.mirror);
  writeJson(paths.links, bundle.links || {});
  const records = new Records(paths);
  for (const r of bundle.records || []) records.put(r);
  const st = readJson(paths.state, {});
  st.notify = { ...(st.notify || {}), offset: 0, sent: { ...(bundle.notify_sent || {}), ...(st.notify?.sent || {}) } };
  if (bundle.started_at) st.started_at = bundle.started_at;
  writeJson(paths.state, st);
  return { records: (bundle.records || []).length };
}
