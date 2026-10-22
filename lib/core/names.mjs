// Names of senders and folders: when are two names the same one, and how alike are they?
//
// SAME means: the same words once case, umlauts, hyphens, legal forms, titles and filler are set
// aside, and singular or plural ("Ostwald Versicherungen" is "Ostwald Versicherung", "Brightwater
// Utilities plc" is "Brightwater Utilities"). A name with a word the other lacks is NOT the same:
// "Finanzamt Wendmark-Nord" is another office than "Finanzamt Wendmark", and "Zahnarztpraxis Dr.
// Vossberg" may or may not be "Zahnarzt Vossberg". That is for the AI to say, from the real
// names, never for this code to guess.
//
// ALIKE is a score for a shortlist: how many words of a name occur in a text or another name.
const FILLER = new Set([
  // legal forms
  "gmbh", "ag", "kg", "mbh", "ev", "se", "co", "ltd", "ug", "gbr", "ohg", "vvag", "inc", "llc", "plc", "limited", "corp",
  "corporation", "sa", "sarl", "bv", "nv", "ab", "oy", "spa", "srl", "haftungsbeschraenkt", "kgaa", "eg",
  // titles and filler
  "dr", "prof", "med", "dipl", "ing", "herr", "frau", "mr", "mrs", "ms",
  "and", "the", "of", "und", "der", "die", "das", "fuer", "von", "et", "de", "la", "le",
]);

export const norm = (s) => String(s ?? "").normalize("NFC").toLocaleLowerCase().split(/\s+/).filter(Boolean).join(" ");

const fold = (s) => String(s ?? "").normalize("NFC").toLocaleLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .normalize("NFD").replace(/[̀-ͯ]/g, "");

export function nameWords(name) {
  return new Set(fold(name).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !FILLER.has(w)));
}

// A word and its singular forms: German -en, -n, -e and English -s, -es.
function forms(w) {
  const out = new Set([w]);
  if (w.length > 5 && w.endsWith("en")) out.add(w.slice(0, -2));
  if (w.length > 4 && w.endsWith("n")) out.add(w.slice(0, -1));
  if (w.length > 4 && w.endsWith("e")) out.add(w.slice(0, -1));
  if (w.length > 3 && w.endsWith("s")) out.add(w.slice(0, -1));
  if (w.length > 4 && w.endsWith("es")) out.add(w.slice(0, -2));
  return out;
}
const wordMatch = (a, b) => { const fb = forms(b); for (const f of forms(a)) if (fb.has(f)) return true; return false; };
const covered = (from, to) => [...from].every((w) => [...to].some((x) => wordMatch(w, x)));

export function sameName(a, b) {
  const wa = nameWords(a), wb = nameWords(b);
  return wa.size > 0 && wb.size > 0 && covered(wa, wb) && covered(wb, wa);
}

// The one object of that name (exactly, or the same name as above); two candidates are no answer.
export function findSame(objs, name) {
  const list = [...objs];
  const n = norm(name);
  const exact = list.filter((o) => norm(o.name) === n);
  if (exact.length === 1) return exact[0];
  const hits = list.filter((o) => sameName(o.name, name));
  return hits.length === 1 ? hits[0] : null;
}

// How many words of `name` occur among `words` (a Set from wordsOf), in any of their forms.
export function wordsOf(text) {
  const out = new Set();
  for (const w of nameWords(text)) for (const f of forms(w)) out.add(f);
  return out;
}
// Only words of three or more letters count: a house number or a year says nothing about a sender.
export function alike(name, words) {
  let n = 0;
  for (const w of nameWords(name)) if (/\p{L}{3}/u.test(w) && [...forms(w)].some((f) => words.has(f))) n++;
  return n;
}
