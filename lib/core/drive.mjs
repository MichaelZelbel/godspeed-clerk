// Google Drive, through its v3 API (F8).
//
// THE PERMISSION AND ITS LIMIT. Google is asked for the whole drive
// (https://www.googleapis.com/auth/drive), because the narrower permission reaches only files the
// app made or the person picks in Google's file picker, so it could not file into the folders the
// person already has. What the Clerk may touch is decided here, in `Confined`, not by Google:
//   - it writes only inside the documents folder the person named and inside the Clerk's own
//     folder (both with everything below them);
//   - it renames, moves or rewrites only files it made itself, which carry its mark;
//   - it never deletes anything.
// Every write goes through `Confined`; the raw `Drive` below is not handed to anything else.
//
// THE MARK. Every file the Clerk makes carries, in its hidden app properties, the Paperless number
// of the document (clerkDoc) and the checksum Paperless keeps of the original (clerkSum), so the
// file is found again when the Clerk's own records are lost or the document got a new number in a
// rebuilt Paperless (F18). App properties are seen only by the Google app (client) that wrote them.
import crypto from "node:crypto";
import { findSame, norm } from "./names.mjs";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
export const FOLDER = "application/vnd.google-apps.folder";
export const FILE_FIELDS = "id,name,mimeType,parents,size,md5Checksum,sha256Checksum,appProperties,trashed,webViewLink";

export class DriveAccessLost extends Error {
  constructor(message) { super(message); this.name = "DriveAccessLost"; }
}
export class DriveError extends Error {
  constructor(message, status) { super(message); this.name = "DriveError"; this.status = status; }
}
export class OutsideError extends Error {
  constructor(message) { super(message); this.name = "OutsideError"; }
}

export function endpoints(env = process.env) {
  return {
    auth: env.GODSPEED_CLERK_GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth",
    token: env.GODSPEED_CLERK_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
    api: (env.GODSPEED_CLERK_DRIVE_API || "https://www.googleapis.com").replace(/\/+$/, ""),
  };
}

const quote = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOST_REASONS = /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientScopes|authError|invalid_grant|invalid_client|unauthorized_client/i;

export class Drive {
  constructor({ creds, env = process.env, crash = () => {}, chunkSize, fetchImpl = globalThis.fetch }) {
    this.creds = creds;
    this.ep = endpoints(env);
    this.crash = crash;
    this.fetch = fetchImpl;
    const fromEnv = Number(env.GODSPEED_CLERK_UPLOAD_CHUNK);
    this.chunkSize = chunkSize || (fromEnv > 0 ? fromEnv : 8 * 1024 * 1024); // Google wants multiples of 256 KiB
    this.cached = null;
  }

  forgetToken() { this.cached = null; }

  async token() {
    if (this.cached && this.cached.expires > Date.now() + 60000) return this.cached.token;
    let res, body = {};
    try {
      res = await this.fetch(this.ep.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.creds.client_id, client_secret: this.creds.client_secret || "", refresh_token: this.creds.refresh_token, grant_type: "refresh_token" }).toString(),
        signal: AbortSignal.timeout(30000) });
      body = await res.json().catch(() => ({}));
    } catch (e) { throw new DriveError(`Google was not reached: ${e.cause?.code || e.message}`); }
    if (!res.ok || !body.access_token) {
      if (res.status === 400 || res.status === 401) throw new DriveAccessLost(`Google no longer accepts the Clerk's connection (${body.error || res.status})`);
      throw new DriveError(`Google refused to renew the connection (${body.error || res.status})`, res.status);
    }
    this.cached = { token: body.access_token, expires: Date.now() + (body.expires_in || 3600) * 1000 };
    return this.cached.token;
  }

  // One API call. 401 once: a fresh token and again; 401 twice or a missing permission: access is
  // lost. 429 and 5xx on a GET: up to three tries.
  async call(method, path, { params, body, headers = {}, raw = false, url } = {}) {
    const q = new URLSearchParams({ supportsAllDrives: "true", ...(params || {}) });
    const target = url || `${this.ep.api}${path}?${q}`;
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await this.token();
      let res;
      try {
        res = await this.fetch(target, { method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && !Buffer.isBuffer(body) ? { "Content-Type": "application/json; charset=UTF-8" } : {}), ...headers },
          body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body), signal: AbortSignal.timeout(120000), redirect: "manual" });
      } catch (e) {
        last = new DriveError(`Google Drive was not reached: ${e.cause?.code || e.message}`);
        if (method !== "GET") throw last;
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (raw) return res;
      if (res.status === 401) {
        this.cached = null;
        if (attempt === 0) continue;
        throw new DriveAccessLost("Google Drive no longer accepts the Clerk's connection");
      }
      const text = await res.text();
      let j = null;
      try { j = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      if (res.ok) return j;
      const reason = j?.error?.errors?.[0]?.reason || j?.error?.status || "";
      const message = j?.error?.message || text.slice(0, 200);
      if (res.status === 403 && LOST_REASONS.test(`${reason} ${message}`)) throw new DriveAccessLost(`Google Drive refused: ${message}`);
      if ((res.status === 429 || res.status >= 500 || /rateLimitExceeded/.test(reason)) && method === "GET") { last = new DriveError(`Google Drive answered ${res.status}`, res.status); await sleep(1000 * (attempt + 1)); continue; }
      throw new DriveError(`Google Drive answered ${res.status}: ${message}`, res.status);
    }
    throw last || new DriveError("Google Drive did not answer");
  }

  async about() { return (await this.call("GET", "/drive/v3/about", { params: { fields: "user(emailAddress,displayName)" } })).user; }

  async list(q, fields = FILE_FIELDS) {
    const out = [];
    let pageToken;
    do {
      const r = await this.call("GET", "/drive/v3/files", { params: { q, fields: `nextPageToken,files(${fields})`, pageSize: "1000", includeItemsFromAllDrives: "true", ...(pageToken ? { pageToken } : {}) } });
      out.push(...(r.files || []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  async get(id) {
    try { return await this.call("GET", `/drive/v3/files/${encodeURIComponent(id)}`, { params: { fields: FILE_FIELDS } }); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }

  async childFolders(parentId) {
    return this.list(`${quote(parentId)} in parents and mimeType = ${quote(FOLDER)} and trashed = false`, "id,name,parents");
  }

  async filesNamed(parentId, name) {
    return this.list(`${quote(parentId)} in parents and name = ${quote(name)} and trashed = false`, "id,name,parents");
  }

  // Found by the checksum of the original (a rebuilt Paperless may renumber), trashed ones too:
  // a file the person threw away was their decision.
  async findByMark({ docId, sum }) {
    const hits = await this.list(`appProperties has { key='clerkSum' and value=${quote(sum)} }`);
    return hits.sort((a, b) => Number(b.appProperties?.clerkDoc === String(docId)) - Number(a.appProperties?.clerkDoc === String(docId)));
  }

  createFolder(name, parentId) {
    return this.call("POST", "/drive/v3/files", { params: { fields: "id,name,parents" }, body: { name, mimeType: FOLDER, parents: [parentId] } });
  }

  update(id, meta, { addParents, removeParents } = {}) {
    return this.call("PATCH", `/drive/v3/files/${encodeURIComponent(id)}`, { params: { fields: FILE_FIELDS, ...(addParents ? { addParents } : {}), ...(removeParents ? { removeParents } : {}) }, body: meta });
  }

  // A resumable upload, in chunks: nothing exists in the drive until the last byte has arrived,
  // so a crash in the middle leaves no half file.
  async upload({ name, parentId, bytes, appProperties, fileId = null }) {
    const params = new URLSearchParams({ uploadType: "resumable", supportsAllDrives: "true", fields: FILE_FIELDS });
    const start = await this.call(fileId ? "PATCH" : "POST", fileId ? `/upload/drive/v3/files/${encodeURIComponent(fileId)}` : "/upload/drive/v3/files", {
      raw: true, url: `${this.ep.api}${fileId ? `/upload/drive/v3/files/${encodeURIComponent(fileId)}` : "/upload/drive/v3/files"}?${params}`,
      headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/pdf", "X-Upload-Content-Length": String(bytes.length) },
      body: Buffer.from(JSON.stringify(fileId ? {} : { name, parents: [parentId], mimeType: "application/pdf", appProperties })),
    });
    if (start.status === 401 || start.status === 403) { const t = await start.text(); if (start.status === 401 || LOST_REASONS.test(t)) throw new DriveAccessLost("Google Drive no longer accepts the Clerk's connection"); throw new DriveError(`Google Drive refused the upload: ${t.slice(0, 200)}`, 403); }
    if (!start.ok) throw new DriveError(`Google Drive did not start the upload (${start.status}): ${(await start.text()).slice(0, 200)}`, start.status);
    const session = start.headers.get("location");
    if (!session) throw new DriveError("Google Drive gave no upload address");
    let sent = 0, crashed = false;
    const total = bytes.length;
    while (true) {
      const end = Math.min(sent + this.chunkSize, total);
      const res = await this.call("PUT", "", { raw: true, url: session, body: bytes.subarray(sent, end),
        headers: { "Content-Type": "application/pdf", "Content-Range": total ? `bytes ${sent}-${end - 1}/${total}` : "bytes */0" } });
      if (res.status === 200 || res.status === 201) return res.json();
      if (res.status !== 308) throw new DriveError(`Google Drive stopped the upload (${res.status}): ${(await res.text()).slice(0, 200)}`, res.status);
      const range = res.headers.get("range");
      sent = range ? Number(range.split("-")[1]) + 1 : 0;
      if (!crashed) { crashed = true; this.crash("mid-upload"); }
    }
  }
}

// The only way to the drive the rest of the Clerk gets. Knows every folder inside the documents
// folder and the Clerk's own folder, and refuses any write that would land anywhere else.
export class Confined {
  constructor(drive, { rootId, ownId = null }) {
    this.drive = drive;
    this.rootId = rootId;
    this.ownId = ownId;
    this.folders = new Map(); // id -> { id, name, parent }
  }

  async load() {
    this.folders.clear();
    for (const top of [this.rootId, this.ownId].filter(Boolean)) {
      const f = await this.drive.get(top);
      if (!f || f.trashed) throw new DriveError(top === this.rootId ? "the documents folder is no longer in the drive (moved to the bin, or the Clerk lost access to it)" : "the Clerk's own folder is gone");
      this.folders.set(top, { id: top, name: f.name, parent: null });
      const queue = [top];
      while (queue.length) {
        const id = queue.shift();
        for (const c of await this.drive.childFolders(id)) {
          if (this.folders.has(c.id)) continue;
          this.folders.set(c.id, { id: c.id, name: c.name, parent: id });
          queue.push(c.id);
        }
      }
    }
    return this;
  }

  isInside(id) { return this.folders.has(id); }
  children(id) { return [...this.folders.values()].filter((f) => f.parent === id); }

  #inside(id, what) { if (!this.isInside(id)) throw new OutsideError(`${what} is outside the documents folder; the Clerk writes nothing there`); }
  #mine(file) {
    if (!file?.appProperties?.clerkDoc) throw new OutsideError("that file was not made by the Clerk; it is never changed");
    for (const p of file.parents || []) this.#inside(p, "that file");
  }

  // The folder for these segments below `fromId`, made where a segment may be made. A segment the
  // plan does not allow to be made and that is not there gives null.
  async ensurePath(fromId, segments) {
    this.#inside(fromId, "that folder");
    let at = fromId;
    for (const s of segments) {
      const kids = this.children(at);
      const hit = s.sender ? findSame(kids, s.name) : kids.find((k) => norm(k.name) === norm(s.name));
      if (hit) { at = hit.id; continue; }
      if (!s.create) return null;
      const made = await this.drive.createFolder(s.name, at);
      this.folders.set(made.id, { id: made.id, name: made.name, parent: at });
      at = made.id;
    }
    return at;
  }

  async uploadInto(parentId, { name, bytes, appProperties }) {
    this.#inside(parentId, "that folder");
    if (!appProperties?.clerkDoc || !appProperties?.clerkSum) throw new OutsideError("a file without the Clerk's mark is never made");
    return this.drive.upload({ name, parentId, bytes, appProperties });
  }

  async replaceContent(file, bytes) {
    this.#mine(file);
    return this.drive.upload({ fileId: file.id, bytes });
  }

  async moveRename(file, { name, parentId }) {
    this.#mine(file);
    this.#inside(parentId, "that folder");
    const from = (file.parents || []).filter((p) => p !== parentId);
    return this.drive.update(file.id, { name }, { addParents: (file.parents || []).includes(parentId) ? undefined : parentId, removeParents: from.join(",") || undefined });
  }
}

export const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");
export const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
