// A pretend Paperless-ngx for the fast tests: the part of its REST API the Clerk uses, over real
// HTTP on 127.0.0.1, with page links that carry another host (as a real Paperless behind a proxy
// does). Every request that is not a GET is kept in `writes`, so a test can prove none came.
import http from "node:http";
import crypto from "node:crypto";

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

export function fakePdf(label, size = 2000) {
  const head = Buffer.from(`%PDF-1.4\n% ${label}\n`);
  const fill = crypto.createHash("sha512").update(label).digest();
  const body = Buffer.alloc(Math.max(0, size - head.length));
  for (let i = 0; i < body.length; i++) body[i] = fill[i % fill.length];
  return Buffer.concat([head, body]);
}

export async function startFakePaperless({ users = [{ id: 2, username: "alex", password: "pw", token: "tok-alex" }], tags = [], types = [], correspondents = [], docs = [] } = {}) {
  const st = {
    users,
    tags: new Map(), correspondents: new Map(), types: new Map(), docs: new Map(),
    writes: [], requests: [], next: { tag: 1, corr: 1, type: 1, doc: 1 }, binned: new Set(),
  };
  for (const t of tags) { const id = t.id ?? st.next.tag; st.next.tag = Math.max(st.next.tag, id + 1); st.tags.set(id, { matching_algorithm: 1, match: "", is_inbox_tag: false, owner: 2, ...t, id }); }
  for (const c of correspondents) { const id = c.id ?? st.next.corr; st.next.corr = Math.max(st.next.corr, id + 1); st.correspondents.set(id, { matching_algorithm: 1, match: "", owner: 2, ...c, id }); }
  for (const d of types) { const id = d.id ?? st.next.type; st.next.type = Math.max(st.next.type, id + 1); st.types.set(id, { matching_algorithm: 1, match: "", owner: 2, ...d, id }); }

  const now = () => new Date().toISOString();
  function addDoc(d) {
    const id = d.id ?? st.next.doc;
    st.next.doc = Math.max(st.next.doc, id + 1);
    const original = d.original ?? fakePdf(`original ${id} ${d.title || ""} ${Math.random()}`, d.size || 3000);
    const archive = d.archive === null ? null : d.archive ?? fakePdf(`archive ${id} ${Math.random()}`, d.archiveSize || d.size || 3000);
    const doc = {
      id, title: d.title ?? `Scan 2026-10-22 16-17-${String(id).padStart(2, "0")}`, content: d.content ?? "",
      tags: d.tags ?? [], correspondent: d.correspondent ?? null, document_type: d.document_type ?? null,
      storage_path: null, created: d.created ?? "2026-10-22", added: d.added ?? `2026-10-22T16:${String(id % 60).padStart(2, "0")}:00+02:00`,
      modified: d.modified ?? now(), original_file_name: d.original_file_name ?? `${d.title ?? `Scan 2026-10-22 16-17-${String(id).padStart(2, "0")}`}.pdf`,
      owner: d.owner === undefined ? 2 : d.owner, custom_fields: d.custom_fields ?? [], notes: [], deleted_at: null,
      mime_type: "application/pdf", page_count: d.page_count ?? 1,
    };
    st.docs.set(id, { doc, original, archive });
    return doc;
  }
  for (const d of docs) addDoc(d);

  const send = (res, code, obj, headers = {}) => {
    const body = Buffer.isBuffer(obj) ? obj : Buffer.from(JSON.stringify(obj));
    res.writeHead(code, { "Content-Type": Buffer.isBuffer(obj) ? "application/pdf" : "application/json", "Content-Length": body.length, ...headers });
    res.end(body);
  };
  const userOf = (req) => {
    const a = req.headers.authorization || "";
    if (a.startsWith("Token ")) return st.users.find((u) => u.token === a.slice(6)) || null;
    if (a.startsWith("Basic ")) {
      const [u, p] = Buffer.from(a.slice(6), "base64").toString().split(":");
      return st.users.find((x) => x.username === u && x.password === p) || null;
    }
    return null;
  };
  function page(res, items, q, pathName) {
    const size = Number(q.get("page_size") || 25), n = Number(q.get("page") || 1);
    const slice = items.slice((n - 1) * size, n * size);
    let next = null;
    if (n * size < items.length) { const nq = new URLSearchParams(q); nq.set("page", String(n + 1)); next = `http://paperless.invalid:8000${pathName}?${nq}`; }
    send(res, 200, { count: items.length, next, previous: null, results: slice });
  }
  const pick = (o, fields) => (fields ? Object.fromEntries(fields.split(",").filter((f) => f in o).map((f) => [f, o[f]])) : o);

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url, "http://x");
      const p = u.pathname, q = u.searchParams;
      st.requests.push({ method: req.method, path: p });
      if (req.method !== "GET") st.writes.push({ method: req.method, path: p, body: raw });
      if (p === "/api/token/" && req.method === "POST") {
        let b = {}; try { b = JSON.parse(raw); } catch { b = Object.fromEntries(new URLSearchParams(raw)); }
        const user = st.users.find((x) => x.username === b.username && x.password === b.password);
        return user ? send(res, 200, { token: user.token }) : send(res, 400, { non_field_errors: ["Unable to log in with provided credentials."] });
      }
      const user = userOf(req);
      if (!user) return send(res, 401, { detail: "Invalid token." });
      if (p === "/api/ui_settings/") return send(res, 200, { user: { id: user.id, username: user.username, is_superuser: true }, settings: { version: "3.3.3" } });
      const coll = { "/api/tags/": [st.tags, "tag"], "/api/correspondents/": [st.correspondents, "corr"], "/api/document_types/": [st.types, "type"] }[p];
      if (coll) {
        const [map, key] = coll;
        if (req.method === "GET") return page(res, [...map.values()].sort((a, b) => a.id - b.id), q, p);
        if (req.method === "POST") {
          const b = JSON.parse(raw || "{}");
          if ([...map.values()].some((o) => o.name.toLowerCase() === String(b.name).toLowerCase())) return send(res, 400, { name: ["exists"] });
          const id = st.next[key]++;
          const o = { id, name: b.name, matching_algorithm: b.matching_algorithm ?? 1, match: b.match ?? "", is_inbox_tag: false, owner: user.id };
          map.set(id, o);
          return send(res, 201, o);
        }
        return send(res, 405, { detail: "Method not allowed" });
      }
      if (p === "/api/documents/" && req.method === "GET") {
        let items = [...st.docs.values()].map((x) => x.doc);
        const all = q.get("tags__id__all");
        if (all) items = items.filter((d) => all.split(",").map(Number).every((t) => d.tags.includes(t)));
        items = items.filter((d) => !st.binned.has(d.id));
        if (q.get("owner__id")) items = items.filter((d) => d.owner === Number(q.get("owner__id")));
        if (q.get("owner__id__in")) { const ids = q.get("owner__id__in").split(",").map(Number); items = items.filter((d) => ids.includes(d.owner)); }
        if (q.get("owner__isnull") === "true" || q.get("owner__isnull") === "1") items = items.filter((d) => d.owner === null);
        const ord = q.get("ordering") || "id";
        const key = ord.replace(/^-/, "");
        items.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : a.id - b.id) * (ord.startsWith("-") ? -1 : 1));
        return page(res, items.map((d) => pick(d, q.get("fields"))), q, p);
      }
      const m = p.match(/^\/api\/documents\/(\d+)\/(metadata\/|download\/)?$/);
      if (m) {
        const e = st.binned.has(Number(m[1])) ? null : st.docs.get(Number(m[1]));
        if (!e) return send(res, 404, { detail: "No Document matches the given query." });
        if (!m[2] && req.method === "GET") return send(res, 200, e.doc);
        if (!m[2] && req.method === "PATCH") {
          const b = JSON.parse(raw || "{}");
          for (const [k, v] of Object.entries(b)) e.doc[k] = v;
          e.doc.modified = now();
          return send(res, 200, e.doc);
        }
        if (m[2] === "metadata/") return send(res, 200, { original_checksum: sha256(e.original), original_size: e.original.length, original_filename: e.doc.original_file_name,
          has_archive_version: !!e.archive, archive_checksum: e.archive ? sha256(e.archive) : null, archive_size: e.archive ? e.archive.length : null });
        if (m[2] === "download/") return send(res, 200, q.get("original") === "true" || !e.archive ? e.original : e.archive);
      }
      return send(res, 404, { detail: "Not found." });
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, state: st, addDoc,
    get writes() { return st.writes; },
    doc: (id) => st.docs.get(id)?.doc,
    remove: (id) => st.docs.delete(id),
    // Paperless's bin: gone from lists and reads, back on restore.
    bin: (id) => st.binned.add(id),
    restore: (id) => { st.binned.delete(id); st.docs.get(id).doc.modified = now(); },
    snapshot: () => JSON.stringify({ docs: [...st.docs.values()].map((x) => ({ ...x.doc, modified: undefined })), tags: [...st.tags.values()], corr: [...st.correspondents.values()], types: [...st.types.values()] }),
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}
