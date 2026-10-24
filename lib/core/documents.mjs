// The "Documents" collection in the person's Godspeed notebook (F17): one item per document the
// Clerk handled, so "did it do anything today?" is answered by opening one list. An item follows
// its document: its date, title, sender, type, tags, its folder in the drive, its status, whether
// its copy in the drive was checked, and links to its note, to Paperless and to the file. A
// document kept out of the notebook (F11) has an item with only when it was added, its folder and
// its status: no title, nothing of what it says.
//
// The Clerk owns the columns below; a column the person adds is theirs and keeps its value. An
// item is written with the version just read, like a note. Found again by the document's mark
// (source_id: the checksum of the original), so a reinstall makes no second item; the collection
// itself is found by its id, else by its maker (source_app).
import { nameHash, now } from "./records.mjs";
import { metaOf, hasCheck } from "./pipeline.mjs";
import { keptOut, noteReady, fileFolder, folderPath, inDrive, links, noteTitle } from "./notes.mjs";
import { SOURCE } from "./note.mjs";
import { deadlinesText } from "./deadline-step.mjs";
import { readJson, writeJson } from "./files.mjs";

export const STATUS = { sorted: "sorted", check: "check this", toSort: "to sort", keptOut: "kept out of the notebook" };

export const FIELDS = [
  { key: "added", label: "Added", type: "date" },
  { key: "date", label: "Date", type: "date" },
  { key: "title", label: "Title", type: "text", primary: true },
  { key: "sender", label: "Sender", type: "text" },
  { key: "type", label: "Type", type: "text" },
  { key: "tags", label: "Tags", type: "text" },
  { key: "folder", label: "Folder in the drive", type: "text" },
  { key: "status", label: "Status", type: "select", options: Object.values(STATUS) },
  { key: "in_drive", label: "In drive", type: "boolean" },
  { key: "deadlines", label: "Deadlines", type: "text" }, // F15: each day, Godspeed's own once made
  { key: "note", label: "Note", type: "url" },
  { key: "paperless", label: "In Paperless", type: "url" },
  { key: "drive", label: "In the drive", type: "url" },
];
export const OWNED = FIELDS.map((f) => f.key);
export const KEPT = ["added", "folder", "status"];

export function shape(settings) {
  return {
    name: settings.collection, icon: "📄", visibility: "personal", source_app: SOURCE, field_schema: FIELDS,
    description: `Every document the Clerk handled, one item each: its date, title, sender, type, tags, status, and links to its note and Paperless. With Google Drive connected, its folder and file link appear too. The notes with each document's full text are in the notebook folder "${settings.notebook_folder}". The Clerk fills every column it made; a column you add is yours.`,
    agent_instructions: `Kept by the Clerk (godspeed-clerk): one item per document. Do not add or change items. Each document's full text, summary and key facts are in its note in the notebook folder "${settings.notebook_folder}".`,
  };
}

export const collectionLink = (web, slug) => (web && slug ? `${web}/collections/${encodeURIComponent(slug)}` : "");
export const itemLink = (web, slug, id) => (web && slug && id ? `${web}/collections/${encodeURIComponent(slug)}/${encodeURIComponent(id)}` : "");

// sorted | check this | to sort | kept out of the notebook. "Check this": the Clerk could not place
// a sorted paper (the tag when Godspeed sorts); it wins over "kept out", because the person must
// find that paper (F7) and a status says nothing of what it says. "To sort": nobody sorted it yet.
export function statusOf(c, doc, rec) {
  const meta = metaOf(c, doc, rec);
  const check = c.settings.sorting === "godspeed" ? hasCheck(c, doc) : !!rec.file?.check && !!(meta.type || meta.sender || meta.tags.length);
  if (check) return STATUS.check;
  if (keptOut(c, doc)) return STATUS.keptOut;
  if (c.withoutDrive) return rec.sort ? STATUS.sorted : STATUS.toSort;
  if (rec.file?.check || (!rec.file && !rec.user_owned)) return STATUS.toSort;
  return STATUS.sorted;
}

export function itemFields(c, doc, rec) {
  const status = statusOf(c, doc, rec);
  const added = String(doc.added || "").slice(0, 10);
  const folder = folderPath(c, fileFolder(rec)) ?? "";
  if (keptOut(c, doc)) return { added, folder, status };
  const meta = metaOf(c, doc, rec);
  const l = links(c, doc, rec);
  const note = rec.note?.id && !rec.note.deleted && c.web ? `${c.web}/dashboard/notes/${encodeURIComponent(rec.note.id)}` : "";
  return { added, date: meta.date || "", title: noteTitle(c, doc, meta), sender: meta.sender ?? "", type: meta.type ?? "", tags: meta.tags.join(", "), folder, status, in_drive: inDrive(rec), deadlines: deadlinesText(c, rec), note, paperless: l.paperless, drive: l.drive ?? "" };
}

export async function ensureCollection(c) {
  if (c.coll) return c.coll;
  const st = readJson(c.ctx.paths.state, {});
  let coll = st.collection?.id ? await c.nb.collection(st.collection.id) : null;
  if (!coll) {
    const mine = await c.nb.collectionsBy(SOURCE);
    coll = mine.find((x) => x.name === c.settings.collection) || mine[0] || null;
  }
  if (!coll) {
    coll = await c.nb.createCollection(shape(c.settings));
    c.log(`notebook: made the collection "${c.settings.collection}"`);
  }
  if (st.collection?.id !== coll.id || st.collection?.slug !== coll.slug) { st.collection = { id: coll.id, slug: coll.slug }; writeJson(c.ctx.paths.state, st); }
  c.coll = coll;
  return coll;
}

// Returns "written", or null when the item was already as it should be.
export async function itemStep(c, doc, rec) {
  if (!noteReady(rec, c) || !(rec.note?.key || rec.note?.deleted)) return null;
  const coll = await ensureCollection(c);
  const data = itemFields(c, doc, rec);
  const key = nameHash(JSON.stringify([coll.id, c.web, data]));
  if (rec.item?.key === key) return null;
  const cur = await c.nb.item(coll.id, rec.sum);
  let wrote = false, id = cur?.id;
  if (!cur) {
    id = (await c.nb.insertItem({ collection_id: coll.id, source_app: SOURCE, source_id: rec.sum, data }))?.id;
    wrote = true;
  } else {
    const next = Object.fromEntries(Object.entries(cur.data || {}).filter(([k]) => !OWNED.includes(k)));
    Object.assign(next, data);
    if (JSON.stringify(next) !== JSON.stringify(cur.data || {})) {
      try { await c.nb.updateItem(cur.id, next, cur._hash); wrote = true; }
      catch (e) {
        if (e?.status !== 409 && e?.code !== "CONFLICT") throw e;
        c.log(`doc ${doc.id}: its collection item was saved in the notebook at the same moment; the Clerk tries again next run`);
        return null;
      }
    }
  }
  if (wrote) c.ctx.crash("after-item");
  rec.item = { id, key, at: now() };
  c.records.put(rec);
  if (wrote) c.log(`doc ${doc.id}: collection item ${cur ? "updated" : "added"}`);
  return wrote ? "written" : null;
}
