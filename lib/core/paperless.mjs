// Paperless-ngx, through its REST API only.
//
// THE WRITE GUARD. Reading is free. Writing exists only behind `writer("godspeed")`, and only as
// three things: change some fields of a document, make a tag, make a sender. In "Paperless sorts"
// and "nobody sorts" there is no writer at all, so not one write can reach Paperless however the
// rest of the program behaves (F4). Even the writer never deletes anything and never touches the
// account's token: `profile/generate_auth_token/` makes a new token and signs the person's phone
// app out, so no request to it ever leaves this file.
//
// SIGNING IN. The person's existing API token, read once at setup through `token/` with their
// password (Django REST Framework's endpoint returns the token the account already has, and makes
// one only when it has none). The password is not kept.

export class PaperlessError extends Error {
  constructor(message, status) { super(message); this.name = "PaperlessError"; this.status = status; }
}
export class ReadOnlyError extends Error {
  constructor(message) { super(message); this.name = "ReadOnlyError"; }
}

const DOC_FIELDS = new Set(["title", "created", "correspondent", "document_type", "tags"]);
const MATCH_NONE = 0, MATCH_AUTO = 6;

export function apiBase(url) {
  let u = String(url || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) throw new PaperlessError(`"${url}" is not a web address (it starts with http:// or https://)`);
  if (!/\/api$/.test(u)) u += "/api";
  return u;
}

function refuse(method, path) {
  if (method === "DELETE") return "the Clerk never deletes anything in Paperless";
  if (/generate_auth_token|\/profile\//.test(`/${path}`)) return "the Clerk never asks Paperless for a new token (that would sign the phone app out)";
  return null;
}

export class Paperless {
  constructor({ url, token, fetchImpl = globalThis.fetch, timeoutMs = 60000 }) {
    this.base = apiBase(url);
    this.token = token;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  // Public: GET only. Anything else goes through a writer.
  request(method, path, opts = {}) {
    if (method !== "GET") return Promise.reject(new ReadOnlyError(refuse(method, path) || `the Clerk reads Paperless here and writes nothing (${method} ${path})`));
    return this.#send(method, path, opts);
  }

  async #send(method, path, { body, params, binary } = {}) {
    const why = refuse(method, path);
    if (why) throw new ReadOnlyError(why);
    let url = /^https?:/.test(path) ? path : `${this.base}/${String(path).replace(/^\/+/, "")}`;
    if (params) {
      const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));
      if ([...q].length) url += (url.includes("?") ? "&" : "?") + q;
    }
    let res;
    try {
      res = await this.fetch(url, {
        method,
        headers: { Authorization: `Token ${this.token}`, Accept: binary ? "*/*" : "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new PaperlessError(`Paperless was not reached (${method} ${path}): ${e.cause?.code || e.message}`);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new PaperlessError(`Paperless answered ${res.status} to ${method} ${path.replace(/\?.*/, "")}${detail ? `: ${detail}` : ""}`, res.status);
    }
    if (binary) return Buffer.from(await res.arrayBuffer());
    const text = await res.text();
    return text.trim() ? JSON.parse(text) : null;
  }

  get(path, params) { return this.request("GET", path, { params }); }

  // Every page of a list. The `next` link carries the host Paperless saw (behind a proxy, another
  // one), so it is followed on the address this client was given.
  async all(path, params = {}) {
    let page = await this.get(path, { page_size: 100, ...params });
    const out = [...(page.results || [])];
    while (page.next) {
      const n = new URL(page.next), b = new URL(this.base);
      page = await this.get(`${b.origin}${n.pathname}${n.search}`);
      out.push(...(page.results || []));
    }
    return out;
  }

  document(id) { return this.get(`documents/${id}/`); }
  metadata(id) { return this.get(`documents/${id}/metadata/`); }
  // The searchable PDF Paperless made (its archive version); Paperless sends the original when there is none.
  async download(id) {
    return this.#send("GET", `documents/${id}/download/`, { binary: true });
  }
  async me() {
    const s = await this.get("ui_settings/");
    if (!s?.user?.id) throw new PaperlessError("Paperless did not say which account this is");
    return { id: s.user.id, username: s.user.username, superuser: !!s.user.is_superuser, version: s.settings?.version || "" };
  }

  writer(mode) {
    if (mode !== "godspeed") throw new ReadOnlyError(`with "${mode === "paperless" ? "Paperless sorts" : "nobody sorts"}" the Clerk writes nothing into Paperless`);
    const send = (m, p, o) => this.#send(m, p, o);
    return {
      async patchDocument(id, fields) {
        for (const k of Object.keys(fields)) if (!DOC_FIELDS.has(k)) throw new ReadOnlyError(`the Clerk may not change ${k}`);
        return send("PATCH", `documents/${id}/`, { body: fields });
      },
      createTag: (name) => send("POST", "tags/", { body: { name, matching_algorithm: MATCH_NONE } }),
      createCorrespondent: (name) => send("POST", "correspondents/", { body: { name, matching_algorithm: MATCH_AUTO } }),
    };
  }
}

export async function obtainToken({ url, user, password, code, fetchImpl = globalThis.fetch }) {
  const body = { username: user, password, ...(code ? { code } : {}) };
  let res;
  try {
    res = await fetchImpl(`${apiBase(url)}/token/`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new PaperlessError(`Paperless was not reached at ${url}: ${e.cause?.code || e.message}`);
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.token) {
    const why = j.non_field_errors?.join(" ") || j.detail || `HTTP ${res.status}`;
    throw new PaperlessError(`Paperless refused the sign-in for ${user}: ${why}`, res.status);
  }
  return j.token;
}

const norm = (s) => String(s ?? "").normalize("NFC").toLocaleLowerCase().split(/\s+/).filter(Boolean).join(" ");

// The live tags, senders and document types, by id. Read every run, never kept: a renamed tag is
// seen at once. Objects made during a run are added here.
export class Taxonomy {
  constructor(tags, correspondents, types) {
    this.tags = new Map(tags.map((t) => [t.id, t]));
    this.correspondents = new Map(correspondents.map((c) => [c.id, c]));
    this.types = new Map(types.map((d) => [d.id, d]));
  }
  static async load(pl) {
    const [t, c, d] = await Promise.all([pl.all("tags/"), pl.all("correspondents/"), pl.all("document_types/")]);
    return new Taxonomy(t, c, d);
  }
  static find(map, name) {
    const n = norm(name);
    for (const o of map.values()) if (norm(o.name) === n) return o;
    return null;
  }
  tag(name) { return Taxonomy.find(this.tags, name); }
  type(name) { return Taxonomy.find(this.types, name); }
  name(map, id) { return id === null || id === undefined ? null : map.get(id)?.name ?? `#${id}`; }
  inboxIds() { return [...this.tags.values()].filter((t) => t.is_inbox_tag).map((t) => t.id).sort((a, b) => a - b); }
}
