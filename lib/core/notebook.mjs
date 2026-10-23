// The Godspeed notebook, as the Clerk writes to it: the same record requests the notebook's own
// screens make (POST /api/query), on the door that answers only on this machine (127.0.0.1:47831),
// like the Wingman's. The address comes from the environment (GODSPEED_CLERK_NOTEBOOK), never from
// the settings file. When the notebook does not answer, notes and items wait; nothing else does.
//
// Every update and every single read names its row (["eq","id",id]): an update without a filter
// would change every row of the table. An update carries the version just read (`expected`), so a
// change the person saved in between is refused (409) and kept, never written over.
export const DEFAULT_NOTEBOOK = "http://127.0.0.1:47831";

export class NotebookError extends Error {
  constructor(status, body) {
    super(`notebook answered ${status}: ${String(body?.error || body?.message || "").slice(0, 200)}`);
    this.name = "NotebookError";
    this.status = status;
    this.code = body?.code || null;
    // An insert refused because a row with that id exists or existed (deleted for good).
    this.exists = /already exists/i.test(String(body?.error || ""));
    // A Godspeed from before add-on deadlines: it does not know the function.
    this.missing = /has not been ported|unknown operation/i.test(String(body?.error || ""));
  }
}

// The notebook did not answer at all: stopped, unreachable, too slow.
export class NotebookDown extends Error {
  constructor(message) { super(message); this.name = "NotebookDown"; }
}

export class Notebook {
  constructor({ base = DEFAULT_NOTEBOOK, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
    this.base = String(base).replace(/\/+$/, "");
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async #post(route, body, timeoutMs) {
    let r;
    try {
      r = await this.fetch(`${this.base}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs || this.timeoutMs) });
    } catch (e) { throw new NotebookDown(`the notebook did not answer: ${e.cause?.code || e.name || e.message}`); }
    let json = null;
    try { json = await r.json(); } catch { json = null; }
    return { r, json };
  }

  // The deadlines the Clerk keeps in Godspeed (the product's addon-deadlines function, docs
  // full-version/addon-model.md): { action: "list" | "create" | "update", ... }. Godspeed makes
  // one per key and never changes one the person touched.
  async deadlines(body, { timeoutMs } = {}) {
    const { r, json } = await this.#post("/api/functions/addon-deadlines", { addon: "godspeed-clerk", ...body }, timeoutMs);
    if (!r.ok || json?.error) throw new NotebookError(r.status, json || {});
    return json?.data ?? null;
  }

  async query(body, { timeoutMs } = {}) {
    const { r, json } = await this.#post("/api/query", body, timeoutMs);
    if (!r.ok || json?.error) throw new NotebookError(r.status, json || {});
    return Array.isArray(json?.data) ? json.data : [];
  }

  // Whether the notebook answers: one small read, a short wait. Never throws.
  async answers({ timeoutMs = 5000 } = {}) {
    try { await this.query({ table: "collections", operation: "select", filters: [["eq", "source_app", "godspeed-clerk"]] }, { timeoutMs }); return true; }
    catch { return false; }
  }

  // Where the person opens this notebook in a browser ("https://host"), as the notebook answers
  // get_notebook_link on its MCP door. null when it answered without one.
  async address({ timeoutMs = 10000 } = {}) {
    const { r, json } = await this.#post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_notebook_link", arguments: {} } }, timeoutMs);
    if (!r.ok || !json || json.error) throw new NotebookError(r.status, json?.error && typeof json.error === "object" ? { error: json.error.message } : json || {});
    if (json.result?.isError) return null;
    let link = null;
    try { link = JSON.parse(json.result?.content?.[0]?.text || "null")?.link; } catch { link = null; }
    try {
      const u = new URL(String(link || ""));
      return ["https:", "http:"].includes(u.protocol) && u.hostname ? u.origin : null;
    } catch { return null; }
  }

  async note(id) { return (await this.query({ table: "notes", operation: "select", filters: [["eq", "id", id]] }))[0] || null; }
  async insertNote(values) { return (await this.query({ table: "notes", operation: "insert", values }))[0]; }
  async updateNote(id, values, hash) {
    return (await this.query({ table: "notes", operation: "update", values, filters: [["eq", "id", id]], expected: hash ? { [id]: hash } : {} }))[0];
  }

  async collection(id) { return (await this.query({ table: "collections", operation: "select", filters: [["eq", "id", id]] }))[0] || null; }
  async collectionsBy(sourceApp) { return this.query({ table: "collections", operation: "select", filters: [["eq", "source_app", sourceApp]] }); }
  async createCollection(values) { return (await this.query({ table: "collections", operation: "insert", values }))[0]; }
  async item(collectionId, sourceId) {
    return (await this.query({ table: "collection_items", operation: "select", filters: [["eq", "collection_id", collectionId], ["eq", "source_id", sourceId]] }))[0] || null;
  }
  async insertItem(values) { return (await this.query({ table: "collection_items", operation: "insert", values }))[0]; }
  async updateItem(id, data, hash) {
    return (await this.query({ table: "collection_items", operation: "update", values: { data }, filters: [["eq", "id", id]], expected: hash ? { [id]: hash } : {} }))[0];
  }
}
