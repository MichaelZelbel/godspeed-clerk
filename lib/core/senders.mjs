// Folders named after senders (a plan rule with {sender}), and the places inside them.
//
// Many people keep one folder per sender, often with subfolders by topic ("Kfz", "Hausrat") or by
// year. Those folder names are the person's own list of senders, so:
//   - the AI chooses the sender folder from a shortlist of the real folder names that look like
//     the document (never the whole drive), or says that none fits;
//   - inside it, the AI chooses among the subfolders a person made (two levels deep), or the
//     sender folder itself;
//   - a folder is made only for a sender the AI is sure has none, and for a missing year where the
//     existing subfolders are clearly years. Nothing else is ever invented.
// A place is written for the AI as a path below the documents folder, "Ostwald Versicherung/Kfz",
// with "<year>" standing for a folder per year.
import { alike, wordsOf, norm } from "./names.mjs";
import { yearOf } from "./plan.mjs";

export const YEAR = "<year>";
export const NEW = "NEW";
export const isYear = (s) => /^(19|20)\d{2}$/.test(String(s).trim());

// For each plan rule with {sender}: the folder its fixed part names ("" or "Invoices").
export function senderParents(confined, plan) {
  const out = new Map();
  for (const r of plan?.rules || []) {
    const segs = String(r.folder).split("/").map((s) => s.trim()).filter(Boolean);
    const i = segs.indexOf("{sender}");
    if (i < 0 || segs.slice(0, i).some((s) => s.startsWith("{"))) continue;
    let at = confined.rootId;
    for (const s of segs.slice(0, i)) { at = confined.children(at).find((k) => norm(k.name) === norm(s))?.id; if (!at) break; }
    if (at && !out.has(at)) out.set(at, { id: at, prefix: segs.slice(0, i).join("/") });
  }
  return [...out.values()];
}

// The places inside one sender folder: itself (unless it holds only years), its subfolders and
// theirs, with folders holding years written once as <year>.
export function placesIn(confined, sender, prefix = "", max = 30) {
  const out = [];
  const walk = (folder, path, chain, depth) => {
    const kids = confined.children(folder.id);
    const years = kids.filter((k) => isYear(k.name)), others = kids.filter((k) => !isYear(k.name));
    if (!kids.length || others.length) out.push({ path, chain });
    if (years.length >= 2 || (years.length && !others.length)) out.push({ path: `${path}/${YEAR}`, chain: [...chain, YEAR] });
    if (depth < 2) for (const o of others.sort((a, b) => a.name.localeCompare(b.name))) walk(o, `${path}/${o.name}`, [...chain, o.id], depth + 1);
  };
  walk(sender, `${prefix ? `${prefix}/` : ""}${sender.name}`, [sender.id], 0);
  return out.slice(0, max);
}

// The sender folders most like `text` (a document's text, or a sender's name and a title).
export function shortlist(confined, parents, text, limit = 25) {
  const words = wordsOf(text);
  return parents.flatMap((p) => confined.children(p.id).map((f) => ({ folder: f, parent: p, score: alike(f.name, words) })))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.folder.name.localeCompare(b.folder.name))
    .slice(0, limit);
}

// The choices for the AI: every place inside the given sender folders, up to `max`.
export function choicesFor(confined, picks, max = 60) {
  const list = [], map = new Map();
  for (const { folder, parent } of picks) {
    for (const p of placesIn(confined, folder, parent.prefix)) {
      if (list.length >= max) break;
      list.push(p.path);
      map.set(p.path, { sender_id: folder.id, chain: p.chain });
    }
  }
  return { list, map };
}

// The folder a chain ends in, making only a missing year.
export async function placeFolder(confined, chain, meta, settings) {
  let at = chain[0];
  if (!confined.isInside(at)) return null;
  for (const step of chain.slice(1)) {
    if (step === YEAR) {
      const y = yearOf(meta, settings);
      if (!y) return null;
      at = await confined.ensurePath(at, [{ name: y, create: true }]);
    } else {
      if (!confined.isInside(step)) return null;
      at = step;
    }
  }
  return at;
}
