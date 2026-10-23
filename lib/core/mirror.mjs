// F19: sort in Paperless, and the drive follows.
//
// THE MIRROR. Paperless's "storage path" field means "where this document belongs". With the
// person's yes (F4; setting `storage_paths`), the Clerk keeps one storage path per place a paper can
// go into, named like the folder and with a template that mirrors the drive folder, so Paperless's
// own files and the drive look alike:
//   - every fixed folder of the plan ("Letters");
//   - every sender folder where the plan keeps one folder per sender ("Deutsche Bahn"); a folder
//     the Clerk makes there later gets its path too;
//   - the folder before a {year} or {type} ("Taxes"), with the rest of the pattern in the template;
//   - "To sort".
// Each is set to Paperless's automatic matching (Auto), so Paperless learns from the person's picks;
// "To sort" is None, so Paperless never learns to put a paper there. A saved view "To sort" (storage
// path is To sort), in the sidebar and on the dashboard, shows exactly the papers waiting for the
// person, with a picture of each first page. Kept level every run: a folder renamed or moved gets its
// path's name and template corrected. Only paths the Clerk made are ever changed; nothing is ever
// deleted; a path the person deleted is not made again.
//
// THE RECORDS (mirror.json): which storage path stands for which folder (folder ids and the rest of
// a pattern), which the Clerk made, and the view's id. With the records lost, the Clerk's own paths
// are found again by their templates, and the view by its name and rule.
import { readJson, writeJson } from "./files.mjs";
import { norm } from "./names.mjs";
import { cleanName, segments } from "./plan.mjs";

export const MATCH_AUTO = 6;
export const MATCH_NONE = 0;
export const RULE_STORAGE_PATH_IS = 25;
const TO_SORT = "to-sort";

export const mirrorOn = (settings) => settings.storage_paths === "yes";
export const loadMirror = (paths) => { const m = readJson(paths.mirror, null); return m && m.paths ? m : { format: 1, paths: {}, view: null }; };
const save = (c) => writeJson(c.ctx.paths.mirror, c.mirrorMap);

// "Paperwork/Insurance/Car" as the list of folder names from the documents folder down.
function names(c, id) {
  const out = [];
  for (let at = id, i = 0; at && i < 64; i++) {
    const f = c.confined.folders.get(at);
    if (!f) return null;
    out.unshift(f.name);
    if (at === c.rootId) return out;
    at = f.parent;
  }
  return null;
}
function walk(c, segs) {
  let at = c.rootId;
  for (const s of segs) { at = c.confined.children(at).find((k) => norm(k.name) === norm(s))?.id; if (!at) return null; }
  return at;
}

// A folder name inside a Jinja template, taken literally.
const literal = (s) => (/[{}%#]/.test(s) ? `{% raw %}${s}{% endraw %}` : s);
const JINJA = { year: "{{ created_year }}", type: "{{ document_type }}", sender: "{{ correspondent }}" };

export function template(c, place) {
  const n = names(c, place.folder_id);
  if (!n) return null;
  if (place.key === TO_SORT) return [...n.map(literal), "{{ added }} {{ title }}"].join("/");
  const rest = String(place.rest || "").split("/").filter(Boolean).map((s) => { const m = s.match(/^\{(\w+)\}$/); return m ? JINJA[m[1]] ?? literal(s) : literal(s); });
  return [...n.map(literal), ...rest, "{{ created }} {{ title }}"].join("/");
}

// Every place a paper can go into: { key, folder_id, rest }.
export function places(c) {
  const out = new Map();
  const add = (id, rest = "") => {
    if (!id || id === c.toSortId || id === c.rootId || !c.confined.isInside(id) || c.excluded?.has(id)) return;
    const key = `${id}|${rest}`;
    if (!out.has(key)) out.set(key, { key, folder_id: id, rest });
  };
  for (const r of c.plan?.rules || []) {
    if (r.folder_id) { add(r.folder_id); continue; }
    const segs = String(r.folder).split("/").map((s) => s.trim()).filter(Boolean);
    const i = segs.findIndex((s) => /^\{(sender|year|type)\}$/.test(s));
    const at = walk(c, i < 0 ? segs : segs.slice(0, i));
    if (!at) continue;
    if (i < 0) add(at);
    else if (segs[i] === "{sender}") { const rest = segs.slice(i + 1).join("/"); for (const f of c.confined.children(at)) add(f.id, rest); }
    else add(at, segs.slice(i).join("/"));
  }
  return [...out.values()];
}

// Where a folder the person names through a storage path of their own is made: where the plan keeps
// one folder per sender (its rule for everything else first), else at the top of the documents folder.
export function newParent(c) {
  const rules = c.plan?.rules || [];
  const rule = rules.find((r) => !r.type && !r.sender && !r.tag && !r.kind && !r.folder_id && r.folder.includes("{sender}"));
  if (!rule) return c.rootId;
  const prefix = rule.folder.slice(0, rule.folder.indexOf("{sender}")).replace(/\/$/, "");
  return (c.senderParents || []).find((p) => p.prefix === prefix)?.id || c.rootId;
}

function freeName(c, folderId, taken) {
  const n = names(c, folderId);
  for (const name of [n.at(-1), n.slice(1).join("/"), `${n.slice(1).join("/")} (${n[0]})`]) if (name && !taken.has(norm(name))) return name;
  return null;
}

// Makes and levels the storage paths and the view. Returns { made, changed }.
export async function mirrorStep(c) {
  const out = { made: 0, changed: 0 };
  if (!mirrorOn(c.settings) || !c.confined || !c.plan || !c.toSortId) return out;
  const m = c.mirrorMap ||= loadMirror(c.ctx.paths);
  const w = c.mirrorWriter ||= c.pl.mirrorWriter();
  const live = c.tax.storagePaths;
  let dirty = false;
  // Paths the person deleted in Paperless: never made again.
  for (const [id, e] of Object.entries(m.paths)) if (!e.gone && !live.has(Number(id))) { e.gone = true; dirty = true; c.log(`storage path ${id} was deleted in Paperless; the Clerk does not make it again`); }
  const byKey = new Map(Object.entries(m.paths).map(([id, e]) => [e.key, { ...e, id: Number(id) }]));
  const mine = new Set(Object.keys(m.paths).map(Number));
  const taken = new Set([...live.values()].map((s) => norm(s.name)));
  const want = [{ key: TO_SORT, folder_id: c.toSortId, rest: "" }, ...places(c)];
  // The Clerk's own paths whose folder is no place of the plan any more (renamed, or the plan
  // changed) still follow their folder.
  const wanted = new Set(want.map((p) => p.key));
  for (const e of byKey.values()) if (e.made && !e.gone && !wanted.has(e.key) && c.confined.isInside(e.folder_id)) want.push({ key: e.key, folder_id: e.folder_id, rest: e.rest || "" });
  for (const p of want) {
    const path = template(c, p);
    if (!path) continue;
    const e = byKey.get(p.key);
    if (e?.gone || (e && !e.made)) continue; // deleted by the person, or a path of theirs that stands for this folder
    if (e) {
      // The Clerk's own: level its name and template with the folder.
      const sp = live.get(e.id);
      const name = p.key === TO_SORT ? c.plan.to_sort?.name || c.settings.to_sort : names(c, p.folder_id).at(-1);
      const patch = {};
      if (sp.path !== path) patch.path = path;
      if (norm(sp.name) !== norm(name) && !taken.has(norm(name))) patch.name = name;
      if (Object.keys(patch).length) {
        const s = await w.updateStoragePath(e.id, patch);
        live.set(e.id, s);
        taken.delete(norm(sp.name)); taken.add(norm(s.name));
        out.changed++;
      }
      continue;
    }
    // Found again by its template (the records were lost), else made.
    const again = [...live.values()].find((s) => s.path === path && !mine.has(s.id));
    let sp = again;
    if (!sp) {
      const name = p.key === TO_SORT ? (c.plan.to_sort?.name || c.settings.to_sort) : freeName(c, p.folder_id, taken);
      if (!name || taken.has(norm(name))) { c.log(`no free name for a storage path of folder ${p.folder_id}`); continue; }
      sp = await w.createStoragePath({ name, path, matching_algorithm: p.key === TO_SORT ? MATCH_NONE : MATCH_AUTO, match: "", is_insensitive: true });
      live.set(sp.id, sp);
      taken.add(norm(sp.name));
      out.made++;
    }
    m.paths[sp.id] = { key: p.key, folder_id: p.folder_id, rest: p.rest, made: true };
    mine.add(sp.id);
    byKey.set(p.key, { ...m.paths[sp.id], id: sp.id });
    dirty = true;
  }
  const toSort = byKey.get(TO_SORT);
  if (toSort && !toSort.gone) {
    const rule = [{ rule_type: RULE_STORAGE_PATH_IS, value: String(toSort.id) }];
    const name = c.plan.to_sort?.name || c.settings.to_sort;
    if (!m.view) {
      const views = await c.pl.all("saved_views/");
      const again = views.find((v) => norm(v.name) === norm(name) && JSON.stringify(v.filter_rules?.map((r) => ({ rule_type: r.rule_type, value: r.value }))) === JSON.stringify(rule));
      const v = again || await w.createSavedView({ name, sort_field: "added", sort_reverse: true, filter_rules: rule, display_mode: "smallCards", show_in_sidebar: true, show_on_dashboard: true });
      m.view = { id: v.id, name, rule: String(toSort.id) };
      dirty = true;
      if (!again) out.made++;
    } else if (!m.view.gone && (m.view.name !== name || m.view.rule !== String(toSort.id))) {
      try { await w.updateSavedView(m.view.id, { name, filter_rules: rule }); m.view = { ...m.view, name, rule: String(toSort.id) }; out.changed++; }
      catch (e) { if (e.status !== 404) throw e; m.view.gone = true; }
      dirty = true;
    }
  }
  if (dirty || out.made || out.changed) save(c);
  if (out.made || out.changed) c.log(`Paperless's storage paths and the To sort page: ${out.made} made, ${out.changed} levelled`);
  return out;
}

export const toSortPath = (c) => { const e = Object.entries(c.mirrorMap?.paths || {}).find(([, x]) => x.key === TO_SORT && !x.gone); return e ? Number(e[0]) : null; };
export const viewLink = (c, web) => (c.mirrorMap?.view?.id && !c.mirrorMap.view.gone ? `${web}/view/${c.mirrorMap.view.id}` : null);

// The storage path that stands for a folder: its own (made now when the folder is a place without
// one), else the nearest folder above it that has one (a year below "Taxes", a subfolder of a
// sender folder), else null.
export async function pathFor(c, folderId) {
  const own = (id) => Object.entries(c.mirrorMap?.paths || {}).find(([, e]) => !e.gone && e.folder_id === id && e.key !== TO_SORT);
  let hit = own(folderId);
  if (!hit && places(c).some((p) => p.folder_id === folderId)) { await mirrorStep(c); hit = own(folderId); }
  for (let at = c.confined.folders.get(folderId)?.parent, i = 0; !hit && at && at !== c.rootId && i < 64; i++) { hit = own(at); at = c.confined.folders.get(at)?.parent; }
  return hit ? Number(hit[0]) : null;
}

// The folder a storage path stands for: { id } | { wait } (a year not known yet) | null. A storage
// path the Clerk did not make (the person's own, or one whose folder is gone) becomes a folder of its
// name inside the documents folder, and stands for that folder from then on.
export async function folderOf(c, spId, meta) {
  const m = c.mirrorMap ||= loadMirror(c.ctx.paths);
  const e = m.paths[spId];
  if (e && !e.gone && e.key !== TO_SORT && c.confined.isInside(e.folder_id)) {
    if (!e.rest) return { id: e.folder_id };
    const segs = segments(e.rest, meta, c.settings);
    if (!segs) return { wait: true };
    const id = await c.confined.ensurePath(e.folder_id, segs);
    return id ? { id } : null;
  }
  const sp = c.tax.storagePaths.get(spId);
  const name = sp && cleanName(sp.name);
  if (!name) return null;
  const id = await c.confined.ensurePath(newParent(c), [{ name, create: true }]);
  if (!id) return null;
  m.paths[spId] = { key: `${id}|`, folder_id: id, rest: "", made: !!e?.made };
  save(c);
  c.log(`storage path ${spId} stands for a folder inside the documents folder from now on`);
  return { id };
}
