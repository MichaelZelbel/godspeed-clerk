// A pretend Godspeed notebook for the fast tests: its local door's record requests (POST
// /api/query) for notes, collections and collection items, and the MCP tool get_notebook_link, over
// real HTTP on 127.0.0.1. It behaves the way the real notebook does where the Clerk depends on it
// (read from the product's notebook/core/query.mjs and records/store.mjs):
// - an insert or update merges the values over the row; every row answers with its _hash;
// - an insert with an id that exists, also a deleted one, is refused ("Record already exists");
// - an update with `expected` whose hash is not the row's is refused with 409 CONFLICT;
// - a delete sets removed_at, and the row is gone from every read;
// - note defaults (is_trashed false, folder_path ""), a collection's slug made from its name, an
//   item's title from the collection's primary field.
// - the add-on deadlines of the product's POST /api/functions/addon-deadlines (core/addon-deadlines.mjs
//   and tools/due.js there): list, create once per key, update only while the person has not
//   touched one (changed its title or a date, closed or dropped it); `withoutDeadlines` answers as a
//   Godspeed from before them.
// `down = true` drops every connection, as a stopped notebook would.
import http from "node:http";
import crypto from "node:crypto";

const hashOf = (row) => crypto.createHash("sha256").update(JSON.stringify({ ...row, _hash: undefined })).digest("hex").slice(0, 16);
const slugOf = (s) => String(s || "record").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "record";

export async function startFakeNotebook({ web = "https://notebook.example" } = {}) {
  const tables = { notes: new Map(), collections: new Map(), collection_items: new Map() };
  const writes = [];
  let n = 1;
  const fb = { down: false, withoutDeadlines: false };
  // Add-on deadlines, by "<addon> <key>": what the add-on wrote (`wrote`) against what is there now.
  const due = new Map();
  const realDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  const print = (d) => JSON.stringify([d.title, d.start, d.due]);
  const shown = (d) => ({ key: d.key, slug: d.slug, title: d.title, due: d.due, start: d.start, state: d.state, touched: d.state !== "open" || print(d) !== d.wrote, closed_on: d.closed_on || null, link: d.link || null });
  const refuse = (m) => { throw Object.assign(new Error(m), { status: 400 }); };
  function deadlines(body) {
    if (fb.withoutDeadlines) refuse("Processing function has not been ported: addon-deadlines");
    const addon = String(body.addon || "");
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(addon)) refuse("Give the add-on's name");
    const mine = () => [...due.values()].filter((d) => d.addon === addon);
    if (body.action === "list") return { deadlines: mine().map(shown) };
    if (!/^[A-Za-z0-9][A-Za-z0-9._:#/-]{0,119}$/.test(String(body.key || ""))) refuse("Give the add-on's own key");
    const id = `${addon} ${body.key}`;
    if (body.action === "update") {
      const d = due.get(id);
      if (!d) refuse("No deadline of this add-on has that key.");
      if (body.due != null && !realDay(body.due)) refuse("The deadline needs a real day");
      if (shown(d).touched) return { updated: false, touched: true, deadline: shown(d) };
      if (body.due) { d.due = body.due; if (d.start > d.due) d.start = d.due; }
      if (body.title) d.title = String(body.title).trim();
      d.wrote = print(d);
      writes.push({ table: "deadlines", operation: "update", id });
      return { updated: true, deadline: shown(d) };
    }
    if (body.action !== "create") refuse("The action is list, create or update.");
    const title = String(body.title || "").trim();
    if (!title || /[\r\n]/.test(title) || title.length > 300) refuse("Say what needs doing, in one line.");
    if (!realDay(body.due)) refuse("The deadline needs a real day");
    for (const k of ["done_when", "cost"]) if (!String(body[k] || "").trim() || /[\r\n]/.test(body[k])) refuse(`Say ${k} in one line.`);
    if (body.link && !/^https?:\/\/\S+$/.test(body.link)) refuse("The link is an http or https address.");
    if (due.has(id)) return { created: false, deadline: shown(due.get(id)) };
    const d = { addon, key: body.key, slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50)}-${due.size + 1}`, title, due: body.due,
      start: body.start || "2026-10-22", state: "open", link: body.link || null, done_when: body.done_when, cost: body.cost };
    d.wrote = print(d);
    due.set(id, d);
    writes.push({ table: "deadlines", operation: "insert", id });
    return { created: true, deadline: shown(d) };
  }

  const seal = (row) => { row._hash = hashOf(row); return row; };
  const visible = (t) => [...tables[t].values()].filter((r) => !r.removed_at);
  const value = (row, key) => key.split(".").reduce((o, k) => (o == null ? o : o[k]), row);
  const matches = (row, filters = []) => filters.every(([op, key, v]) => {
    if (op === "eq") return value(row, key) === v;
    if (op === "in") return v.includes(value(row, key));
    if (op === "is") return value(row, key) == null;
    throw Object.assign(new Error(`the pretend notebook knows no filter ${op}`), { status: 400 });
  });
  const titleOf = (item) => {
    const coll = tables.collections.get(item.collection_id);
    const primary = (coll?.field_schema || []).find((f) => f.primary);
    // As the real notebook: the primary column's value, else "Untitled" (checked against it).
    return (primary && item.data?.[primary.key]) || "Untitled";
  };

  function execute({ table, operation = "select", values, filters = [], expected = {} }) {
    if (!tables[table]) throw Object.assign(new Error(`Unknown record domain ${table}`), { status: 400 });
    const map = tables[table];
    if (operation === "select") return visible(table).filter((r) => matches(r, filters)).map((r) => structuredClone(r));
    if (operation === "insert") {
      const out = [];
      for (const v of [].concat(values)) {
        const id = v.id || `${slugOf(v.name || v.title || table)}-${String(n++).padStart(8, "0")}`;
        if (map.has(id)) throw Object.assign(new Error("Record already exists"), { status: 400 });
        if (table === "collection_items" && !tables.collections.get(v.collection_id)) throw Object.assign(new Error("Collection missing"), { status: 400 });
        const now = new Date().toISOString();
        let row = { ...v, id, revision: 1, created_at: v.created_at || now, updated_at: now };
        if (table === "notes") row = { is_trashed: false, folder_path: "", tags: [], metadata: {}, ai_visibility: "visible", ...row };
        if (table === "collections") {
          const plain = slugOf(row.slug || row.name);
          row.slug = visible("collections").some((c) => c.slug === plain) ? `${plain}-${id.slice(-8)}` : plain;
          row = { field_schema: [], visibility: "personal", ...row };
        }
        if (table === "collection_items") { row = { data: {}, ...row }; row.title = titleOf(row); }
        map.set(id, seal(row));
        writes.push({ table, operation, id });
        out.push(structuredClone(row));
      }
      return out;
    }
    if (operation === "update" || operation === "delete") {
      const out = [];
      for (const old of visible(table).filter((r) => matches(r, filters))) {
        if (expected[old.id] && expected[old.id] !== old._hash) throw Object.assign(new Error("This record changed. Both versions were saved for review."), { status: 409, code: "CONFLICT" });
        const row = operation === "delete" ? { ...old, removed_at: new Date().toISOString() } : { ...old, ...values, id: old.id, created_at: old.created_at };
        row.revision = (old.revision || 0) + 1;
        row.updated_at = new Date().toISOString();
        if (table === "collection_items") row.title = titleOf(row);
        map.set(old.id, seal(row));
        writes.push({ table, operation, id: old.id });
        out.push(structuredClone(row));
      }
      return out;
    }
    throw Object.assign(new Error("Unknown operation"), { status: 400 });
  }

  const server = http.createServer((req, res) => {
    if (fb.down) { req.socket.destroy(); return; }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (code, obj) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { "Content-Type": "application/json", "Content-Length": b.length }); res.end(b); };
      try {
        if (req.url === "/health") return send(200, { ok: true });
        if (req.url === "/mcp" && req.method === "POST") {
          const body = JSON.parse(raw);
          if (body.params?.name !== "get_notebook_link") return send(200, { jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ type: "text", text: "unknown tool" }] } });
          return send(200, { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ link: `${web}/dashboard` }) }] } });
        }
        if (req.url === "/api/query" && req.method === "POST") return send(200, { data: execute(JSON.parse(raw)), error: null });
        if (req.url === "/api/functions/addon-deadlines" && req.method === "POST") return send(200, { data: deadlines(JSON.parse(raw)), error: null });
        return send(404, { error: "Unknown operation" });
      } catch (e) { return send(e.status || 500, { error: e.message, code: e.code }); }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`, web, writes,
    get down() { return fb.down; }, set down(v) { fb.down = !!v; },
    get withoutDeadlines() { return fb.withoutDeadlines; }, set withoutDeadlines(v) { fb.withoutDeadlines = !!v; },
    // Every add-on deadline, with all it holds; and what the person does to one in Godspeed.
    deadlineRows: () => [...due.values()].map((d) => ({ ...shown(d), addon: d.addon, done_when: d.done_when, cost: d.cost })),
    clearDeadlines: () => due.clear(),
    personMoves: (key, day, addon = "godspeed-clerk") => { due.get(`${addon} ${key}`).due = day; },
    personRenames: (key, title, addon = "godspeed-clerk") => { due.get(`${addon} ${key}`).title = title; },
    personCloses: (key, addon = "godspeed-clerk") => { const d = due.get(`${addon} ${key}`); d.state = "closed"; d.closed_on = "2026-10-23"; },
    rows: (t) => visible(t).map((r) => structuredClone(r)),
    row: (t, id) => { const r = tables[t].get(id); return r && !r.removed_at ? structuredClone(r) : null; },
    // What the person does in the notebook's own screens: a save with the version they had.
    edit: (t, id, patch) => execute({ table: t, operation: "update", values: patch, filters: [["eq", "id", id]] })[0],
    remove: (t, id) => execute({ table: t, operation: "delete", filters: [["eq", "id", id]] })[0],
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}
