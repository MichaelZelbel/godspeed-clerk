// A pretend Google Drive for the tests, with Google's sign-in in front of it: the part of the
// Drive v3 API and the OAuth endpoints the Clerk uses, over real HTTP on 127.0.0.1.
//
//   sign-in   GET  /o/oauth2/v2/auth   consents at once and redirects back with a code
//             POST /token              code (PKCE S256 checked) or refresh token
//   drive     /drive/v3/about, /drive/v3/files (list with the q subset the Clerk uses, get, create
//             folder, metadata PATCH with addParents/removeParents), resumable uploads under
//             /upload/drive/v3/files (308 with Range until the last byte)
// Every write lands in `writes`, with the folder it went to, so a test can prove where the Clerk
// wrote. `fields` is honoured like Google does: a field not asked for is not returned.
import http from "node:http";
import crypto from "node:crypto";

const FOLDER = "application/vnd.google-apps.folder";
const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const TEST_CLIENT = { id: "test-client.apps.googleusercontent.com", secret: "test-secret" };

export async function startFakeDrive({ tree = {}, account = "alex@example.test", pageSize = 100, grantScope = null, maxOr = Infinity, host = "127.0.0.1", publicHost = null, port = 0 } = {}) {
  const st = { files: new Map(), writes: [], codes: new Map(), refresh: new Map(), access: new Map(), sessions: new Map(), seq: 1, revoked: false, grantScope, calls: [], changes: [] };
  // Drive's changes feed: every change to a file, in order; a page token is a position in it.
  const logChange = (id) => { const x = st.files.get(id); st.changes.push({ fileId: id, removed: false, file: x ? { id: x.id, name: x.name, mimeType: x.mimeType, parents: [...x.parents], trashed: x.trashed } : null }); };
  const newId = (p) => `${p}${String(st.seq++).padStart(4, "0")}Xq7LmZ2vR9tWk4pB8nC3yHj`; // as long as Google's ids
  const ROOT = "root0000";
  st.files.set(ROOT, { id: ROOT, name: "My Drive", mimeType: FOLDER, parents: [], trashed: false, appProperties: {} });
  const now = () => new Date().toISOString();

  function addFile(name, parent, content, extra = {}) {
    const id = newId("f");
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
    st.files.set(id, { id, name, mimeType: extra.mimeType || "application/pdf", parents: [parent], trashed: false, appProperties: extra.appProperties || {},
      content: buf, size: String(buf.length), md5Checksum: md5(buf), sha256Checksum: sha256(buf), modifiedTime: now() });
    logChange(id);
    return id;
  }
  function addFolder(name, parent, appProperties = {}) {
    const id = newId("d");
    st.files.set(id, { id, name, mimeType: FOLDER, parents: [parent], trashed: false, appProperties: { ...appProperties }, modifiedTime: now() });
    logChange(id);
    return id;
  }
  function build(node, parent) {
    for (const [name, v] of Object.entries(node)) {
      if (v && typeof v === "object" && !Buffer.isBuffer(v)) build(v, addFolder(name, parent));
      else addFile(name, parent, v);
    }
  }
  build(tree, ROOT);

  const pathOf = (id) => {
    const parts = [];
    let f = st.files.get(id);
    while (f && f.id !== ROOT) { parts.unshift(f.name); f = st.files.get(f.parents[0]); }
    return parts.join("/");
  };
  const byPath = (p) => [...st.files.values()].find((f) => pathOf(f.id) === p && !f.trashed) || null;

  // ---------------------------------------------------------------- the q subset
  function splitAnd(q, sep = " and ") {
    const out = [];
    let depth = 0, cur = "", inStr = false;
    for (let i = 0; i < q.length; i++) {
      const c = q[i];
      if (c === "\\" && inStr) { cur += c + q[++i]; continue; }
      if (c === "'") inStr = !inStr;
      if (!inStr && (c === "{" || c === "(")) depth++;
      if (!inStr && (c === "}" || c === ")")) depth--;
      if (!inStr && depth === 0 && q.slice(i, i + sep.length) === sep) { out.push(cur.trim()); cur = ""; i += sep.length - 1; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  const unq = (s) => s.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  const STR = "'(?:[^'\\\\]|\\\\.)*'";
  function clause(c) {
    let m;
    if (c.startsWith("(") && c.endsWith(")")) { const any = splitAnd(c.slice(1, -1), " or ").map(clause); return (f) => any.some((fn) => fn(f)); }
    if ((m = c.match(new RegExp(`^(${STR}) in parents$`)))) { const id = unq(m[1]) === "root" ? ROOT : unq(m[1]); return (f) => f.parents.includes(id); }
    if ((m = c.match(new RegExp(`^name = (${STR})$`)))) { const v = unq(m[1]); return (f) => f.name === v; }
    if ((m = c.match(new RegExp(`^mimeType (=|!=) (${STR})$`)))) { const v = unq(m[2]); return m[1] === "=" ? (f) => f.mimeType === v : (f) => f.mimeType !== v; }
    if ((m = c.match(/^trashed = (true|false)$/))) { const v = m[1] === "true"; return (f) => f.trashed === v; }
    if ((m = c.match(new RegExp(`^appProperties has \\{ key=(${STR}) and value=(${STR}) \\}$`)))) { const k = unq(m[1]), v = unq(m[2]); return (f) => f.appProperties?.[k] === v; }
    throw new Error(`unsupported query: ${c}`);
  }

  const DEFAULT_FIELDS = ["id", "name", "mimeType", "kind"];
  function shape(f, fields) {
    const want = fields ? fields.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_FIELDS;
    const out = {};
    for (const k of want) if (k === "kind") out.kind = "drive#file"; else if (f[k] !== undefined) out[k] = f[k];
    return out;
  }
  const listFields = (fields) => (fields?.match(/files\(([^)]*)\)/)?.[1]) || null;

  // ---------------------------------------------------------------- HTTP
  const send = (res, code, obj, headers = {}) => {
    const body = obj === null ? "" : JSON.stringify(obj);
    res.writeHead(code, { "Content-Type": "application/json", ...headers });
    res.end(body);
  };
  const err = (res, code, reason, message) => send(res, code, { error: { code, message: message || reason, errors: [{ reason, message: message || reason }] } });
  const authed = (req) => {
    const t = (req.headers.authorization || "").replace(/^Bearer /, "");
    return !st.revoked && st.access.has(t);
  };

  function finishUpload(sess, res) {
    const buf = Buffer.concat(sess.chunks);
    if (sess.fileId) {
      const f = st.files.get(sess.fileId);
      Object.assign(f, { content: buf, size: String(buf.length), md5Checksum: md5(buf), sha256Checksum: sha256(buf), modifiedTime: now() });
      st.writes.push({ op: "update-content", id: f.id, name: f.name, parents: [...f.parents] });
      logChange(f.id);
      return send(res, 200, shape(f, sess.fields));
    }
    const parent = (sess.meta.parents || [ROOT])[0];
    const id = addFile(sess.meta.name, parent === "root" ? ROOT : parent, buf, { appProperties: sess.meta.appProperties || {}, mimeType: sess.meta.mimeType });
    st.writes.push({ op: "upload", id, name: sess.meta.name, parents: [...st.files.get(id).parents] });
    return send(res, 200, shape(st.files.get(id), sess.fields));
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const u = new URL(req.url, "http://x");
      const p = u.pathname, q = u.searchParams;
      st.calls.push({ method: req.method, path: p, q: q.get("q") || "" });
      try {
        // ---------------- sign-in
        if (p === "/o/oauth2/v2/auth") {
          const code = crypto.randomBytes(8).toString("hex");
          const scope = st.grantScope || q.get("scope");
          st.codes.set(code, { challenge: q.get("code_challenge"), method: q.get("code_challenge_method"), redirect: q.get("redirect_uri"), client: q.get("client_id"), scope });
          const back = new URL(q.get("redirect_uri"));
          back.searchParams.set("code", code); back.searchParams.set("state", q.get("state") || ""); back.searchParams.set("scope", scope);
          res.writeHead(302, { Location: back.toString() });
          return res.end();
        }
        if (p === "/token" && req.method === "POST") {
          const f = new URLSearchParams(raw.toString());
          if (f.get("client_id") !== TEST_CLIENT.id || f.get("client_secret") !== TEST_CLIENT.secret) return send(res, 401, { error: "invalid_client" });
          if (f.get("grant_type") === "authorization_code") {
            const c = st.codes.get(f.get("code"));
            if (!c || c.redirect !== f.get("redirect_uri") || c.method !== "S256" || b64url(crypto.createHash("sha256").update(f.get("code_verifier") || "").digest()) !== c.challenge) return send(res, 400, { error: "invalid_grant" });
            st.codes.delete(f.get("code"));
            st.revoked = false;
            const refresh = `r-${crypto.randomBytes(8).toString("hex")}`, access = `a-${crypto.randomBytes(8).toString("hex")}`;
            st.refresh.set(refresh, true); st.access.set(access, true);
            return send(res, 200, { access_token: access, refresh_token: refresh, expires_in: 3599, scope: c.scope, token_type: "Bearer" });
          }
          if (f.get("grant_type") === "refresh_token") {
            if (st.revoked || !st.refresh.get(f.get("refresh_token"))) return send(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
            const access = `a-${crypto.randomBytes(8).toString("hex")}`;
            st.access.set(access, true);
            return send(res, 200, { access_token: access, expires_in: 3599, token_type: "Bearer" });
          }
          return send(res, 400, { error: "unsupported_grant_type" });
        }
        // ---------------- resumable sessions
        if (p === "/upload/session" && req.method === "PUT") {
          if (!authed(req)) return err(res, 401, "authError");
          const sess = st.sessions.get(q.get("id"));
          if (!sess) return err(res, 404, "notFound", "upload session not found");
          const range = req.headers["content-range"] || "";
          let m;
          if ((m = range.match(/^bytes \*\/(\d+)$/))) {
            if (sess.received === Number(m[1]) && sess.done) return send(res, 200, shape(st.files.get(sess.doneId), sess.fields));
            return send(res, 308, null, sess.received ? { Range: `bytes=0-${sess.received - 1}` } : {});
          }
          m = range.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
          if (!m || Number(m[1]) !== sess.received) return err(res, 400, "badContentRange");
          sess.chunks.push(raw); sess.received += raw.length;
          if (m[3] !== "*" && sess.received === Number(m[3])) { sess.done = true; return finishUpload(sess, res); }
          return send(res, 308, null, { Range: `bytes=0-${sess.received - 1}` });
        }
        if (!p.startsWith("/drive/v3") && !p.startsWith("/upload/drive/v3")) return err(res, 404, "notFound");
        if (!authed(req)) return err(res, 401, "authError", "Invalid Credentials");
        if (p === "/drive/v3/changes/startPageToken") return send(res, 200, { startPageToken: String(st.changes.length) });
        if (p === "/drive/v3/changes") {
          const start = Number(q.get("pageToken")), size = Math.min(Number(q.get("pageSize") || 100), pageSize);
          if (!Number.isInteger(start) || start < 0 || start > st.changes.length) return err(res, 400, "invalid", "Invalid page token");
          const slice = st.changes.slice(start, start + size);
          return send(res, 200, { changes: slice, ...(start + size < st.changes.length ? { nextPageToken: String(start + size) } : { newStartPageToken: String(st.changes.length) }) });
        }
        if (p === "/drive/v3/about") return send(res, 200, { user: { emailAddress: account, displayName: "Alex Morgan" } });
        if (p === "/drive/v3/files" && req.method === "GET") {
          if ((q.get("q") || "").split(" or ").length - 1 >= maxOr) return err(res, 400, "invalid", "The query is too complex.");
          const filters = splitAnd(q.get("q") || "").map(clause);
          const all = [...st.files.values()].filter((f) => f.id !== ROOT && filters.every((fn) => fn(f))).sort((a, b) => a.id.localeCompare(b.id));
          const start = Number(q.get("pageToken") || 0), size = Math.min(Number(q.get("pageSize") || 100), pageSize);
          const slice = all.slice(start, start + size);
          return send(res, 200, { files: slice.map((f) => shape(f, listFields(q.get("fields")))), ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) });
        }
        if (p === "/drive/v3/files" && req.method === "POST") {
          const meta = JSON.parse(raw.toString() || "{}");
          if (meta.mimeType !== FOLDER) return err(res, 400, "badRequest", "this fake makes folders here; files come by upload");
          const id = addFolder(meta.name, ((meta.parents || [ROOT])[0] === "root" ? ROOT : (meta.parents || [ROOT])[0]), meta.appProperties || {});
          st.writes.push({ op: "create-folder", id, name: meta.name, parents: [...st.files.get(id).parents] });
          logChange(id);
          return send(res, 200, shape(st.files.get(id), q.get("fields")));
        }
        let m = p.match(/^\/drive\/v3\/files\/([^/]+)$/);
        if (m) {
          const f = st.files.get(m[1]);
          if (!f) return err(res, 404, "notFound", `File not found: ${m[1]}.`);
          if (req.method === "GET" && q.get("alt") === "media") {
            if (f.mimeType === FOLDER) return err(res, 403, "fileNotDownloadable");
            res.writeHead(200, { "Content-Type": f.mimeType || "application/octet-stream" });
            return res.end(f.content);
          }
          if (req.method === "GET") return send(res, 200, shape(f, q.get("fields")));
          if (req.method === "PATCH") {
            const meta = JSON.parse(raw.toString() || "{}");
            const from = [...f.parents];
            if (meta.name !== undefined) f.name = meta.name;
            if (meta.appProperties) f.appProperties = { ...f.appProperties, ...meta.appProperties };
            if (q.get("removeParents")) f.parents = f.parents.filter((x) => !q.get("removeParents").split(",").includes(x));
            if (q.get("addParents")) f.parents.push(...q.get("addParents").split(",").filter((x) => !f.parents.includes(x)));
            f.modifiedTime = now();
            st.writes.push({ op: "update", id: f.id, name: f.name, parents: [...f.parents], from });
            logChange(f.id);
            return send(res, 200, shape(f, q.get("fields")));
          }
        }
        if ((p === "/upload/drive/v3/files" && req.method === "POST") || ((m = p.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/)) && req.method === "PATCH")) {
          if (q.get("uploadType") !== "resumable") return err(res, 400, "badRequest", "only resumable uploads here");
          const sid = crypto.randomBytes(6).toString("hex");
          st.sessions.set(sid, { meta: JSON.parse(raw.toString() || "{}"), fileId: m ? m[1] : null, chunks: [], received: 0, fields: q.get("fields"), done: false });
          res.writeHead(200, { Location: `http://${req.headers.host}/upload/session?id=${sid}` });
          return res.end();
        }
        return err(res, 404, "notFound");
      } catch (e) {
        return err(res, 400, "invalid", e.message);
      }
    });
  });
  await new Promise((r) => server.listen(port, host, r));
  const url = `http://${publicHost || host}:${server.address().port}`;
  return {
    url, authUrl: `${url}/o/oauth2/v2/auth`, tokenUrl: `${url}/token`, ROOT, state: st,
    env: { GODSPEED_CLERK_GOOGLE_AUTH_URL: `${url}/o/oauth2/v2/auth`, GODSPEED_CLERK_GOOGLE_TOKEN_URL: `${url}/token`, GODSPEED_CLERK_DRIVE_API: url },
    get writes() { return st.writes; },
    files: () => [...st.files.values()].filter((f) => f.id !== ROOT),
    pathOf, byPath, addFile, addFolder,
    idOf: (p) => byPath(p)?.id || null,
    marked: (docId) => [...st.files.values()].filter((f) => f.appProperties?.clerkDoc === String(docId)),
    // what a person does by hand in the Drive
    userMove: (id, folderPath) => { const f = st.files.get(id); f.parents = [byPath(folderPath).id]; logChange(id); },
    userRename: (id, name) => { st.files.get(id).name = name; logChange(id); },
    userTrash: (id) => { st.files.get(id).trashed = true; logChange(id); },
    get calls() { return st.calls; },
    revoke: () => { st.revoked = true; st.access.clear(); st.refresh.clear(); },
    // a token for tests that talk to the drive without signing in
    issue: () => { const r = `r-${crypto.randomBytes(8).toString("hex")}`; st.refresh.set(r, true); st.revoked = false; return r; },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}
