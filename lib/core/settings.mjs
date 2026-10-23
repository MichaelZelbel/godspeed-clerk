// The person's choices. English names by default; a person who keeps their papers in another
// language sets their own tag names and "To sort" name once (the assistant does it at setup).
// Profile facts (`about`: where they live, their company) come from the person's own profile
// through the assistant, never from this code.
import { readJson, writeJson } from "./files.mjs";

export const SORTING = ["godspeed", "paperless", "nobody"];

export const DEFAULTS = Object.freeze({
  format: 1,
  active: false,             // false: the worker runs but reads and writes nothing
  sorting: "godspeed",       // godspeed | paperless | nobody (F4)
  language: "English",       // the language titles are written in
  country: "",               // decides which papers count for the tax return ("DE", "GB", "US")
  about: "",                 // facts from the person's profile that help sorting, one paragraph
  workspace: "",             // the Godspeed folder whose model connection answers
  approved_ai: [],           // providers the person approved at setup; any other is refused (F12)
  tags: { check: "Check this", tax_prefix: "Tax", not_in_notebook: "Not in notebook", important: "Important" },
  tag_rules: {},             // existing tag name -> when to add it
  examples: [],              // the person's own worked examples: { what, answer }
  scan_title_patterns: ["^Scan \\d{4}-\\d{2}-\\d{2}", "^(IMG|DOC|PXL|SCAN|Scan|scan)[_ -]?\\d", "^\\d{4}-\\d{2}-\\d{2}[ _T-]\\d{2}[-_.:]\\d{2}"],
  to_sort: "To sort",
  include_unowned: false,    // documents without an owner count as the person's
  batch_size: 10,            // documents sorted per run (F13)
  copy_batch: 50,            // first copies and filings per run
  run_minutes: 5,            // a run starts no new document after this
  interval_minutes: 3,       // pause between runs
  settle_minutes: 30,        // "Paperless sorts"/"nobody sorts": file once the inbox tag is gone or this long after arrival
  text_chars: 8000,
  ai_timeout_s: 120,
  // The notebook (F10, F11, F17): one note per document in the folder `notebook_folder`, one item
  // per document in the collection `collection`. Its door is GODSPEED_CLERK_NOTEBOOK, never a setting.
  notebook: true,
  notebook_folder: "Documents",
  collection: "Documents",
  note_batch: 50,            // notes and collection items written per run (F13)
  notebook_down_hours: 6,    // the notebook silent this long: one message (F16)
  paperless_web: "",         // where the person opens Paperless, for links; empty: the connection's address
  // Messages (F16): "telegram" (the assistant's own bot), "desktop". null: desktop on a desktop, else telegram.
  talk: null,
  telegram_env: "",          // the Hermes .env whose bot sends; empty: found by itself
  // Every word a person reads in a note or a message, in their language (the assistant sets them at setup).
  texts: {
    sender: "Sender", date: "Date", type: "Type", tags: "Tags", folder: "Folder", summary: "Summary",
    facts: "Key facts", links: "Links", in_paperless: "In Paperless", in_drive: "In the drive",
    full_text: "Full text", rest_in_paperless: "The rest of the text is in Paperless.",
    hint: "The Clerk rewrites everything above the next heading when the document changes. Write your own notes below it; the Clerk never changes them.",
    yours: "Your notes",
    kept_out_title: "Document kept out of the notebook",
    message_head: "The Clerk:",
    // A paper the Clerk could not place, asked about (F19). {paper} is "<its title>" (<its date>).
    question: "Where does {paper} go? It is waiting in \"{to_sort}\".",
    question_unreadable: "Where does {paper} go? It could not be read, and is waiting in \"{to_sort}\".",
    choice_folder: "Your folder \"{folder}\"",
    choice_new: "A new folder \"{name}\" in \"{parent}\"",
    choice_other: "Another folder: say which",
    question_end: "Answer with the number or in your own words.",
    questions_more: "{n} more papers are waiting in \"{to_sort}\"; the Clerk asks about them once these are answered.",
    message_drive: "Google Drive no longer lets the Clerk file your papers. Ask your assistant to connect the drive again.",
    message_deleted: "Deleted in Paperless, its file stays in your drive:",
    message_notebook: "Your notebook has not answered for {hours} hours, so new papers get no notes yet.",
    message_more: "and {n} more",
    message_kept_out: "Kept out of the notebook, but its note was changed so the Clerk could not take its own text out; please remove it by hand:",
  },
});

export const TALK = ["telegram", "desktop"];

const NUMBERS = ["batch_size", "copy_batch", "run_minutes", "interval_minutes", "ai_timeout_s", "text_chars", "note_batch", "notebook_down_hours"];
const BOOLEANS = ["active", "include_unowned", "notebook"];

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) ? { ...base[k], ...v } : v;
  }
  return out;
}

export function loadSettings(paths) {
  return merge(structuredClone(DEFAULTS), readJson(paths.settings, {}));
}

export function saveSettings(paths, patch) {
  const next = merge(loadSettings(paths), patch);
  writeJson(paths.settings, next);
  return next;
}

// One setting from the command line: `sorting nobody`, `tags.check "Prüfen"`, `batch_size 2`.
export function setSetting(settings, key, raw) {
  const [top, sub] = String(key).split(".");
  const obj = DEFAULTS[top] && typeof DEFAULTS[top] === "object" && !Array.isArray(DEFAULTS[top]) ? DEFAULTS[top] : null;
  if (!(top in DEFAULTS) || (sub && !obj) || (sub && Object.keys(obj).length && !(sub in obj))) throw new Error(`there is no setting ${key}`);
  const out = structuredClone(settings);
  let value = raw;
  if (top === "sorting") {
    if (!SORTING.includes(raw)) throw new Error("sorting is godspeed, paperless or nobody");
  } else if (NUMBERS.includes(top) || top === "settle_minutes") {
    const n = Number(raw);
    const min = top === "settle_minutes" ? 0 : 1;
    if (!Number.isInteger(n) || n < min) throw new Error(`${top} is a whole number of ${min} or more`);
    value = n;
  } else if (top === "talk") {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (value !== null && (!Array.isArray(value) || !value.length || !value.every((t) => TALK.includes(t)))) throw new Error("talk is a list of telegram or desktop, or null");
  } else if (BOOLEANS.includes(top)) {
    if (!["true", "false", true, false].includes(raw)) throw new Error(`${top} is true or false`);
    value = raw === true || raw === "true";
  } else if (Array.isArray(DEFAULTS[top]) || (typeof DEFAULTS[top] === "object" && !sub)) {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  }
  if (sub) out[top] = { ...out[top], [sub]: value };
  else out[top] = value;
  return out;
}
