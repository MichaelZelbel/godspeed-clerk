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
  chat_language: null,       // the language the person talks to Godspeed in (deadline names); null: language
  country: "",               // decides which papers count for the tax return ("DE", "GB", "US")
  about: "",                 // facts from the person's profile that help sorting, one paragraph
  workspace: "",             // the Godspeed folder whose model connection answers
  approved_ai: [],           // providers the person approved at setup; any other is refused (F12)
  tags: { check: "Check this", tax_prefix: "Tax", not_in_notebook: "Not in notebook", important: "Important" },
  tag_rules: {},             // existing tag name -> when to add it
  examples: [],              // the person's own worked examples: { what, answer }
  scan_title_patterns: ["^Scan \\d{4}-\\d{2}-\\d{2}", "^(IMG|DOC|PXL|SCAN|Scan|scan)[_ -]?\\d", "^\\d{4}-\\d{2}-\\d{2}[ _T-]\\d{2}[-_.:]\\d{2}"],
  to_sort: "To sort",
  // F19 with the person's yes (F4): Paperless's storage paths mirror the folder plan, and a "To sort"
  // page lists the papers waiting. "yes", "no", or null: not decided yet (plan confirm decides it).
  storage_paths: null,
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
  copy_hour: 2,              // the nightly restore copy starts after this hour, the server's own time (F9)
  copy_minutes: 4,           // the restore copy uploads at most this long per run, so new scans never wait
  copy_id: null,             // this installation's folder of the restore copy in the drive (made with the first copy)
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
    message_to_sort_one: "1 paper is waiting to be sorted.",
    message_to_sort: "{n} papers are waiting to be sorted.",
    message_drive: "Google Drive no longer lets the Clerk file your papers. Ask your assistant to connect the drive again.",
    message_deleted: "Deleted in Paperless, its file stays in your drive: {list}.",
    message_notebook: "Your notebook has not answered for {hours} hours, so new papers get no notes yet.",
    message_more: "and {n} more",
    message_kept_out: "Kept out of the notebook, but its note was changed so the Clerk could not take its own text out; please remove it by hand: {list}.",
    // Deadlines from letters (F15): in the note, in Godspeed's deadline list, in the item, in the message.
    deadlines: "Deadlines",
    deadline_by: "{ask}: by {date}",
    deadline_check: "{ask}: by {date} at the earliest. The period runs from when the letter reached you, which it does not print, so this counts from its date. Check the date.",
    deadline_passed: "{ask}: by {date}, already passed",

    deadline_unnamed: "A request",
    ask_vague: "{ask} (no date given)",
    ask_unclear: "{ask} (date unclear)",
    deadline_title_check: "{ask} (check the date)",
    deadline_title_kept: "{title}, {date}",
    letter: "Letter",
    deadline_done: "Done what the letter asks.",
    deadline_cost: "A date in a letter that passes can cost a fee, a reminder charge or a right.",
    item_check: "check the date",
    item_passed: "passed",
    item_unclear: "date unclear",
    message_check_date: "{ask} by {day}: counted from the letter's date, {letter}; the real day may be later, check it on the paper \"{title}\".",
    message_godspeed_old: "Your Godspeed cannot keep deadlines from letters yet. Update Godspeed, and the Clerk makes them.",
    // The Paperless the Clerk installed (F2, F3, F9).
    message_phone: "Your phone is connected: your first scan has arrived in Paperless.",
    message_paperless_down: "Paperless has not answered for half an hour, and starting it again did not help. Ask your assistant to look at it.",
    message_disk: "The server's disk is nearly full ({free} GB free). Ask your assistant to make room, or new papers cannot be read.",
    message_update_failed: "Paperless could not be updated to {to}, so it runs {from} again, with every paper and setting as before. The Clerk does not try {to} again by itself; ask your assistant to look at it.",
    message_update_stuck: "Paperless could not be updated to {to}, and {from} did not come back either. Ask your assistant to look at it; a copy of everything is on the server.",
    message_shared: "Your Paperless now holds papers of another account, so the Clerk stopped its nightly restore copy: a shared Paperless needs a backup its owners agree on. Your own papers are still filed in your drive, and updates go on with the copy they keep on the server.",
    message_copy_failed: "The restore copy of your Paperless has failed three times in a row. Ask your assistant to look at it (godspeed-clerk status says why).",
  },
});

export const TALK = ["telegram", "desktop"];

const NUMBERS = ["batch_size", "copy_batch", "run_minutes", "interval_minutes", "ai_timeout_s", "text_chars", "note_batch", "notebook_down_hours", "copy_minutes"];
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
  } else if (NUMBERS.includes(top) || top === "settle_minutes" || top === "copy_hour") {
    const n = Number(raw);
    const min = top === "settle_minutes" || top === "copy_hour" ? 0 : 1;
    if (top === "copy_hour" && n > 23) throw new Error("copy_hour is an hour from 0 to 23");
    if (!Number.isInteger(n) || n < min) throw new Error(`${top} is a whole number of ${min} or more`);
    value = n;
  } else if (top === "chat_language") {
    // The language the person talks to Godspeed in, by name ("English"); "null": the papers' language.
    value = raw === "null" || raw === null ? null : String(raw).trim();
    if (value !== null && (!value || value.length > 40 || /[\r\n{}]/.test(value))) throw new Error("chat_language is a language's name, such as English, or null");
  } else if (top === "storage_paths") {
    if (!["yes", "no"].includes(raw)) throw new Error("storage_paths is yes or no");
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
