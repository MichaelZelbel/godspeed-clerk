// F9: a restore copy, and rebuilding from it.
//
// THE CLERK'S OWN FOLDER, "The Clerk" at the top of the person's drive, marked (clerkOwn) so it is
// found again; everything in it carries the mark clerkCopy, and the Clerk writes nowhere else in it.
// Each installation writes only into folders of its own copy id (setting `copy_id`, made with the
// first copy, and taken over by a rebuild of it), so a new server never writes over the copy of the
// one before it:
//   records/<id>/clerk-records.json   the Clerk's own records: settings, the confirmed folder plan,
//                                the storage paths it keeps, and per document its file, note, item
//                                and deadlines (numbers, marks and links). Every night, on every Paperless.
//   paperless/<id>/              on a Paperless the Clerk installed, while every document there is
//                                the person's: Paperless's full export (originals/, archive/,
//                                manifest.json, metadata.json with the version that made it), the
//                                Clerk's records of that night beside it, and restore.json last,
//                                written only when every file the manifest names is in the drive
//                                with the manifest's own checksum: the copy is whole.
// Only files whose checksum changed are uploaded, a few minutes per run, so a first night with
// thousands of papers never holds new scans back; what the drive holds is read back at the start of
// every export, so a file changed or lost there is sent again. A Paperless where another account
// keeps documents is never exported (its export would hold their papers); the person hears it once.
// A Paperless the Clerk did not install is never exported (section 4). A copy that fails is tried
// again within the hour (a new export) and the person hears it when it keeps failing.
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
import { saveSettings } from "./settings.mjs";

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
  // What the drive holds, read whole: an entry whose file is still there with the same checksum is
  // kept as it was (with the time of the local file it came from); one changed or gone in the drive
  // is replaced or dropped, so it is sent again.
  async learn() {
    const seen = {}, folders = { "": this.own.id };
    const walk = async (rel, id) => {
      for (const f of await this.drive.list(`${q(id)} in parents and trashed = false`, "id,name,mimeType,md5Checksum,size,appProperties")) {
        const r = rel ? `${rel}/${f.name}` : f.name;
        if (f.mimeType === FOLDER) { folders[r] ||= f.id; await walk(r, f.id); }
        else if (!seen[r] || f.appProperties?.clerkCopy === "1") seen[r] = { id: f.id, md5: f.md5Checksum, size: Number(f.size || 0), mine: f.appProperties?.clerkCopy === "1" };
      }
    };
    await walk("", this.own.id);
    const files = {};
    for (const [r, f] of Object.entries(seen)) { const k = this.index.files[r]; files[r] = k && k.id === f.id && k.md5 === f.md5 ? k : f; }
    this.index.files = files;
    this.index.folders = folders;
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

// Is the copy due? The first one as soon as it can; then once a night in the four hours from
// `copy_hour` (the server's own time), or at once when a night was missed; on every run while an
// upload goes on; within the hour after a copy that failed.
export function copyDue(st, settings, t) {
  const c = st.copy || {};
  if (c.phase === "upload") return true;
  if (c.phase === "failed") return t >= Date.parse(c.retry_at || 0);
  if (!c.last_ok_at) return true;
  if (c.day === localDay(t)) return false;
  const h = new Date(t).getHours(), from = Number(settings.copy_hour ?? 2);
  return (h - from + 24) % 24 < 4 || t - Date.parse(c.last_ok_at) > 36 * 3600e3;
}
// The night's hours, for the update after the copy.
export const nightNow = (settings, t) => (new Date(t).getHours() - Number(settings.copy_hour ?? 2) + 24) % 24 < 4;

export function copyIdOf(ctx) {
  if (ctx.settings.copy_id) return ctx.settings.copy_id;
  const id = `c${crypto.randomBytes(5).toString("hex")}`;
  ctx.settings = saveSettings(ctx.paths, { copy_id: id });
  return id;
}

// Every file the manifest names, with the checksum it gives: [[rel, md5], ...].
function manifestFiles(manifest) {
  const out = [];
  for (const o of manifest) {
    if (o.model !== "documents.document") continue;
    if (o.__exported_file_name__) out.push([o.__exported_file_name__, o.fields?.checksum]);
    if (o.__exported_archive_name__ && o.fields?.archive_checksum) out.push([o.__exported_archive_name__, o.fields.archive_checksum]);
  }
  return out;
}
export const MANIFEST_FILES = manifestFiles;

// The nightly copy. `host` is the installed Paperless (host.mjs), or null for one the Clerk did not
// install. Returns { ran, records, exported, uploaded, done, shared, why }. `force`: now, and with a
// new export (a copy before an update, `godspeed-clerk copy`).
export async function copyStep(ctx, { host = null, user = null, force = false, clerkVersion = "" } = {}) {
  const { paths, settings } = ctx;
  const t = ctx.clock();
  const st = readJson(paths.state, {});
  const c = st.copy || {};
  const out = { ran: false, records: false, exported: false, uploaded: 0, done: false };
  if (!force && !copyDue(st, settings, t)) return out;
  if (!ctx.driveConn) { out.why = "Google Drive is not connected yet"; return out; }
  out.ran = true;
  const id = copyIdOf(ctx);
  const pre = `paperless/${id}`;
  const save = () => { st.copy = c; writeJson(paths.state, st); };
  let copy = null;
  const keep = () => { if (copy) writeJson(paths.restoreIndex, copy.index); };
  try {
    const drive = ctx.drive();
    const own = await findOwn(drive, { create: true });
    copy = new OwnCopy(drive, own, readJson(paths.restoreIndex, null));
    if (!copy.index.learned) await copy.learn();
    // 1. The Clerk's own records, on every Paperless.
    const bundle = Buffer.from(JSON.stringify(recordsBundle(paths, { clerkVersion })));
    // 2. Paperless's export, on one the Clerk installed and only while every document is the person's.
    const fresh = force || c.phase !== "upload" || t - Date.parse(c.export_at || 0) > 12 * 3600e3;
    if (fresh) { out.records = await copy.put(`records/${id}/clerk-records.json`, bundle); keep(); }
    if (host) {
      const root = path.join(host.dir, "export");
      if (fresh) {
        const owners = host.owners();
        const others = Object.keys(owners).filter((n) => n && n !== user);
        if (others.length) {
          if (!c.shared_since) { c.shared_since = now(); ctx.outbox({ kind: "shared-paperless", since: c.shared_since }); ctx.log(`restore copy: another account keeps documents in this Paperless (${others.length} account(s)); its export stops`); }
          out.shared = true;
          Object.assign(c, { day: localDay(t), last_ok_at: now(), phase: "done", fails: 0 });
          for (const k of ["retry_at", "fail_since", "last_error"]) delete c[k];
          save();
          return out;
        }
        if (c.shared_since) { delete c.shared_since; ctx.log("restore copy: every document is the person's again; the export goes on"); }
        host.exportNow();
        const version = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, "metadata.json"), "utf8")).version; } catch { return null; } })() || host.rec.version;
        await copy.learn(); // what the drive holds now: a file changed or lost there is sent again
        keep();
        Object.assign(c, { phase: "upload", export_at: now(), version: String(version).replace(/^v/i, "") });
        save();
        out.exported = true;
        ctx.log(`restore copy: Paperless ${c.version} exported`);
      }
      const until = ctx.clock() + Number(settings.copy_minutes ?? 4) * 60000;
      const last = new Set(["manifest.json", "metadata.json"]);
      const files = [...walkFiles(root)].filter((r) => !last.has(r));
      // A file whose size and time are those it had when it was uploaded, and that the drive still
      // holds as uploaded, is unchanged (the exporter rewrites only what changed, -c): it is not
      // even read. Only uploads count against the time.
      let left = 0, since = 0;
      for (const rel of files) {
        const full = path.join(root, rel), stt = fs.statSync(full), key = `${pre}/${rel}`;
        const k = copy.index.files[key];
        if (k && k.size === stt.size && k.mtime === stt.mtimeMs) continue;
        if (ctx.clock() > until && !force) { left++; continue; }
        if (await copy.put(key, fs.readFileSync(full))) { out.uploaded++; since++; }
        copy.index.files[key].mtime = stt.mtimeMs;
        if (since >= 25) { keep(); since = 0; }
      }
      keep();
      if (left) { ctx.log(`restore copy: ${out.uploaded} file(s) uploaded, ${left} more next run`); save(); return out; }
      // Whole only when every file the manifest names is in the drive with the manifest's checksum.
      const manifest = fs.readFileSync(path.join(root, "manifest.json"));
      const named = manifestFiles(JSON.parse(manifest.toString("utf8")));
      for (const [rel, sum] of named) {
        let local;
        try { local = md5(fs.readFileSync(path.join(root, rel))); } catch { local = null; }
        if (local !== sum) throw new Error(`Paperless's export does not match its manifest (${rel}); the next copy exports again`);
        if (copy.index.files[`${pre}/${rel}`]?.md5 !== sum) { await copy.put(`${pre}/${rel}`, fs.readFileSync(path.join(root, rel))); out.uploaded++; }
      }
      for (const rel of ["metadata.json", "manifest.json"]) { if (await copy.put(`${pre}/${rel}`, fs.readFileSync(path.join(root, rel)))) out.uploaded++; }
      await copy.put(`${pre}/clerk-records.json`, bundle);
      const docs = JSON.parse(manifest.toString("utf8")).filter((o) => o.model === "documents.document").length;
      await copy.put(`${pre}/${RESTORE_FILE}`, Buffer.from(JSON.stringify({ format: 2, copy_id: id, host: host.rec.host || null, made_at: now(), paperless_version: c.version, documents: docs, manifest_md5: md5(manifest), files: named.length, user, clerk_version: clerkVersion }, null, 1)));
      keep();
      ctx.log(`restore copy: whole, ${docs} documents, ${out.uploaded} file(s) uploaded`);
    }
    Object.assign(c, { phase: "done", day: localDay(t), last_ok_at: now(), fails: 0 });
    for (const k of ["retry_at", "fail_since", "last_error", "told_fail"]) delete c[k];
    out.done = true;
    save();
    return out;
  } catch (e) {
    keep();
    c.fails = (c.fails || 0) + 1;
    c.fail_since ||= now();
    c.last_error = String(e.message).slice(0, 200);
    c.phase = "failed";
    c.retry_at = new Date(t + 3600e3).toISOString();
    ctx.log(`restore copy failed (${c.fails} in a row): ${c.last_error}`);
    if (c.fails >= 3 && c.told_fail !== c.fail_since) { c.told_fail = c.fail_since; ctx.outbox({ kind: "copy-failed", why: c.last_error }); }
    save();
    throw e;
  }
}

// The restore copies a drive holds: every installation's (paperless/<id>/restore.json), newest
// first. `except`: this installation's own copy id. Returns { own, copy, copies: [{ id, prefix,
// restore }], restore, prefix } with the newest copy that holds papers as `restore`, or null.
export async function findRestoreCopy(drive, { index = null, except = null } = {}) {
  const own = await findOwn(drive);
  if (!own) return null;
  const copy = new OwnCopy(drive, own, index);
  await copy.learn();
  const copies = [];
  for (const rel of Object.keys(copy.index.files)) {
    const m = rel.match(/^paperless\/([^/]+)\/restore\.json$/);
    if (!m || m[1] === except) continue;
    try { copies.push({ id: m[1], prefix: `paperless/${m[1]}`, restore: JSON.parse((await copy.get(rel)).toString("utf8")) }); } catch { /* not readable: not a copy */ }
  }
  copies.sort((a, b) => String(b.restore.made_at).localeCompare(String(a.restore.made_at)));
  const best = copies.find((x) => Number(x.restore.documents) > 0) || null;
  return { own, copy, copies, restore: best?.restore || null, prefix: best?.prefix || null, id: best?.id || null };
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
