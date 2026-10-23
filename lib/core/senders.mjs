// Folders named after senders (a plan rule with {sender}), and the places inside them.
//
// Many people keep one folder per sender, often with subfolders by topic ("Kfz", "Hausrat") or by
// year. Those folder names are the person's own list of senders, so:
//   - the AI chooses the sender folder from the real folder names (all of them up to about a
//     thousand, the likeliest above that; never anything outside the documents folder), or says
//     that none fits;
//   - inside it, the AI chooses among the subfolders a person made (two levels deep), or the
//     sender folder itself;
//   - a folder is made only for a sender the AI is sure has none, and for a missing year where the
//     existing subfolders are clearly years. Nothing else is ever invented.
// A place is written for the AI as a path below the documents folder, "Ostwald Versicherung/Kfz",
// with "<year>" standing for a folder per year.
import { alike, wordsOf, norm, initialsOf, initialsMatch } from "./names.mjs";
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

// The choices for the AI, for one document. Every sender folder's name when there are up to about a
// thousand (a few thousand words for the AI; a name sharing no word with the letter, like "VKO" for
// "Vereinigte Krankenkasse Ostlicht", must still be there to choose), only the likeliest above that.
// ("To sort" and the Clerk's own folder are left out: `exclude`.)
// Subfolders only for the few likeliest senders, listed after all the names, so they never push a
// name off the list. Nothing outside the documents folder is ever offered.
// Returns { list: [paths], map: path -> { sender_id, chain, expand } }; expand means the AI chose the
// sender folder by name and its subfolders are still to be chosen.
export function choicesFor(confined, parents, text, { all = 1000, short = 300, likely = 5, maxSub = 150, exclude = new Set() } = {}) {
  const words = wordsOf(text), ini = initialsOf(text);
  const tops = parents.flatMap((p) => confined.children(p.id).filter((f) => !exclude.has(f.id)).map((folder) => ({
    folder, parent: p, path: `${p.prefix ? `${p.prefix}/` : ""}${folder.name}`, score: alike(folder.name, words) + initialsMatch(folder.name, ini),
  })));
  const byScore = (a, b) => b.score - a.score || a.path.localeCompare(b.path);
  const shown = tops.length <= all ? tops : tops.filter((x) => x.score > 0).sort(byScore).slice(0, short);
  const list = shown.map((x) => x.path).sort((a, b) => a.localeCompare(b));
  const map = new Map(shown.map((x) => [x.path, { sender_id: x.folder.id, chain: [x.folder.id], expand: true }]));
  const subs = [];
  for (const x of tops.filter((y) => y.score > 0).sort(byScore).slice(0, likely)) {
    for (const p of placesIn(confined, x.folder, x.parent.prefix)) {
      if (p.path === x.path) { map.set(p.path, { sender_id: x.folder.id, chain: p.chain, expand: false }); continue; }
      if (subs.length >= maxSub) break;
      subs.push(p.path);
      map.set(p.path, { sender_id: x.folder.id, chain: p.chain, expand: false });
    }
  }
  return { list: [...list, ...subs], map };
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
