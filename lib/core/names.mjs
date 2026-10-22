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
// Singular and plural count as the same word only for generic words like these. Any other word
// must match exactly: Peters is not Petersen, Lang is not Lange, Kühn is not Kühne. A name pair
// that differs by such an ending is for the AI to judge, never for this code.
const GENERIC = [
  ["versicherung", "versicherungen"], ["krankenversicherung", "krankenversicherungen"], ["kasse", "kassen"], ["krankenkasse", "krankenkassen"],
  ["sparkasse", "sparkassen"], ["bausparkasse", "bausparkassen"], ["bank", "banken", "banks"], ["werk", "werke"], ["stadtwerk", "stadtwerke"],
  ["praxis", "praxen"], ["partner", "partners"], ["gesellschaft", "gesellschaften"], ["verwaltung", "verwaltungen"], ["beratung", "beratungen"],
  ["dienst", "dienste"], ["betrieb", "betriebe"], ["finanz", "finanzen"], ["leistung", "leistungen"], ["immobilie", "immobilien"],
  ["genossenschaft", "genossenschaften"], ["kanzlei", "kanzleien"], ["anlage", "anlagen"],
  ["insurance", "insurances"], ["service", "services"], ["utility", "utilities"], ["solution", "solutions"], ["system", "systems"],
  ["holding", "holdings"], ["group", "groups"], ["association", "associations"], ["office", "offices"], ["clinic", "clinics"],
  ["practice", "practices"], ["agency", "agencies"], ["company", "companies"], ["investment", "investments"], ["fund", "funds"],
];
const CANON = new Map(GENERIC.flatMap(([one, ...more]) => [[one, one], ...more.map((m) => [m, one])]));
const canonSet = (name) => new Set([...nameWords(name)].map((w) => CANON.get(w) || w));

export function sameName(a, b) {
  const wa = canonSet(a), wb = canonSet(b);
  return wa.size > 0 && wa.size === wb.size && [...wa].every((w) => wb.has(w));
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

// The significant words of a text in order, for initials: "Vereinigte Krankenkasse Ostlicht" gives
// vereinigte, krankenkasse, ostlicht.
export function wordList(text) {
  return fold(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && /\p{L}/u.test(w) && !FILLER.has(w));
}

// What a text offers for matching names written as initials: the initials of every run of two to
// six words in it, and the words themselves (for a folder named in full when the text uses initials).
export function initialsOf(text) {
  const words = wordList(text), runs = new Set();
  for (let i = 0; i < words.length; i++) {
    let s = "";
    for (let n = 0; n < 6 && i + n < words.length; n++) { s += words[i + n][0]; if (n >= 1) runs.add(s); }
  }
  return { runs, words: new Set(words) };
}

// 2 when a name and a text meet through initials: "VKO" and "Vereinigte Krankenkasse Ostlicht" in the
// text, or a folder named in full and its initials in the text; else 0.
export function initialsMatch(name, ini) {
  const w = wordList(name);
  if (w.length === 1 && /^\p{L}{2,6}$/u.test(w[0]) && ini.runs.has(w[0])) return 2;
  if (w.length >= 2 && w.length <= 6 && ini.words.has(w.map((x) => x[0]).join(""))) return 2;
  return 0;
}
