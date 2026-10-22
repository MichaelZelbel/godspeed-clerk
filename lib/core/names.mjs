// Names of senders and folders: when are two names the same one?
//
// Exactly the same (ignoring case and spaces) first. Otherwise the words of both, with legal forms
// and filler dropped: when one set of words is contained in the other, it is the same sender
// ("Northgate Insurance" and "Northgate Insurance Ltd"). Two equally good candidates are no
// answer: that is not this program's guess to make. "Fairford Borough Council" and "Fairford
// Water" stay two.
const FILLER = new Set([
  // legal forms
  "gmbh", "ag", "kg", "mbh", "ev", "se", "co", "ltd", "ug", "gbr", "ohg", "vvag", "inc", "llc", "plc", "limited", "corp",
  "corporation", "sa", "sarl", "bv", "nv", "ab", "oy", "spa", "srl", "haftungsbeschränkt", "kgaa",
  // filler
  "and", "the", "of", "und", "der", "die", "das", "für", "fuer", "von", "et", "de", "la", "le",
]);

export const norm = (s) => String(s ?? "").normalize("NFC").toLocaleLowerCase().split(/\s+/).filter(Boolean).join(" ");

export function nameWords(name) {
  const words = String(name ?? "").normalize("NFC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ");
  return new Set(words.filter((w) => w.length > 1 && !FILLER.has(w)));
}

export function findSame(objs, name) {
  const list = [...objs];
  const n = norm(name);
  const exact = list.find((o) => norm(o.name) === n);
  if (exact) return exact;
  const want = nameWords(name);
  if (!want.size) return null;
  const hits = [];
  for (const o of list) {
    const have = nameWords(o.name);
    if (!have.size) continue;
    const inside = [...have].every((w) => want.has(w)) || [...want].every((w) => have.has(w));
    if (inside) hits.push([[...have].filter((w) => want.has(w)).length, o]);
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b[0] - a[0]);
  if (hits.length > 1 && hits[0][0] === hits[1][0]) return null;
  return hits[0][1];
}
