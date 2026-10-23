// Messages only when the person can act (F16): papers waiting to be sorted, Google Drive no longer
// letting it file, a document deleted in Paperless, the notebook silent for hours, a note it could
// not clean for "Not in notebook", a deadline counted from a day the letter does not print ("check
// the date"), a letter with a period but no printed date to count from, a Godspeed too old to keep
// deadlines (F15). Godspeed's own reminders say when a deadline comes up; the Clerk does not say it
// again. Everything of that kind from one run comes as ONE short message with ONE link; everything
// else is silent.
//
// PAPERS TO SORT (F19) are one line, "2 papers are waiting to be sorted.", counting every paper
// waiting, and the link opens Paperless's "To sort" page, which lists exactly them with a picture of
// each (without that page: Paperless's list of exactly the papers with "Check this"). It is said when
// a paper is newly waiting, never twice for the same wait (keys "sort:<doc>:<since>").
//
// The steps write what happened into the outbox (records.mjs), by number. This step reads what is
// new there since the last message, drops what is no longer true (a paper resolved, the drive
// back, the notebook back) and what the person already heard (`state.notify.sent`, keys such as
// "check:12"), and hands one message to the channels. A message no channel took stays for the next
// run. The keys are marked as being sent before the channels get the message, so a crash in that
// moment can never make the person hear it twice.
//
// A PILE. While a run leaves documents waiting to be sorted (a first import of hundreds), or
// letters whose requests are still to be read (the papers an earlier version noted, after an
// update), papers to check are held, so the person gets one message when the pile is done
// instead of one every few minutes; held at most HOLD_HOURS. Everything urgent (the drive, a deletion, the notebook) goes at
// once.
import fs from "node:fs";
import { readJson, writeJson } from "./files.mjs";
import { now } from "./records.mjs";
import { statusOf, STATUS } from "./documents.mjs";
import { keptOut, paperlessWeb } from "./notes.mjs";
import { viewLink } from "./mirror.mjs";
import { keyOf } from "./deadlines.mjs";

export const HOLD_HOURS = 24;

// A deadline's name without the "(check the date)" its template adds.
function askOf(title, template) {
  if (!title) return null;
  const [pre, post] = String(template || "{ask}").split("{ask}");
  const t = String(title);
  return t.startsWith(pre) && t.endsWith(post ?? "") ? t.slice(pre.length, t.length - (post ?? "").length).trim() || t : t;
}
// "9 November 2026", in the language the person talks to Godspeed in.
const LOCALES = { english: "en-GB", german: "de-DE", deutsch: "de-DE", french: "fr-FR", spanish: "es-ES", italian: "it-IT", dutch: "nl-NL", portuguese: "pt-PT", polish: "pl-PL" };
export function dayWords(day, settings) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return String(day || "");
  const lang = String(settings.chat_language || settings.language || "English").toLowerCase();
  try { return new Intl.DateTimeFormat(LOCALES[lang] || "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`)); }
  catch { return day; }
}
// A title in a sentence: one line, no web address.
const plain = (title) => String(title ?? "").replace(/\s+/g, " ").replace(/\bhttps?:\/\//gi, "").trim();
export const MAX_NAMES = 10; // a message names at most this many papers, and counts the rest

const fill = (t, vars) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
// A paper's name in a message, without a web address's scheme, so the message has one link only.
const named = (title, date) => `"${String(title).replace(/\s+/g, " ").replace(/\bhttps?:\/\//gi, "").trim()}"${date ? ` (${date})` : ""}`;

// What is new in the outbox: the notices and the byte where the next read starts.
function fresh(paths, offset) {
  let buf;
  try { buf = fs.readFileSync(paths.outbox); } catch { return { notices: [], end: 0 }; }
  const from = offset > buf.length ? 0 : offset;
  const last = buf.lastIndexOf(0x0a);
  if (last < from) return { notices: [], end: from };
  const notices = [];
  for (const line of buf.subarray(from, last + 1).toString("utf8").split("\n")) {
    try { if (line.trim()) notices.push(JSON.parse(line)); } catch { /* a broken line says nothing */ }
  }
  return { notices, end: last + 1 };
}

async function deletedName(c, id, r) {
  // Its note's title, unless it was kept out of the notebook: then its file's name, never "kept out".
  try {
    if (c.nbUp && r?.note?.id && !r.note.deleted) {
      const n = await c.nb.note(r.note.id);
      if (n?.title && !n.clerk_kept_out && !n.clerk_trashed && n.title !== c.settings.texts.kept_out_title) return named(n.title);
    }
  } catch { /* the drive's name, then */ }
  try { if (c.confined && r?.copy?.file_id) { const f = await c.confined.drive.get(r.copy.file_id); if (f?.name) return named(f.name.replace(/\.pdf$/i, "")); } } catch { /* the number, then */ }
  return `document ${id}`;
}

export async function notifyStep(c, docs, { waiting = 0 } = {}) {
  const { ctx, settings } = c;
  const texts = settings.texts;
  const list = (names) => (names.length <= MAX_NAMES ? names.join(", ") : `${names.slice(0, MAX_NAMES).join(", ")}, ${fill(texts.message_more, { n: names.length - MAX_NAMES })}`);
  const st = readJson(ctx.paths.state, {});
  const n = { offset: 0, sent: {}, ...(st.notify || {}) };
  // Keys being sent when the last run ended: the person may have heard them; never again.
  if (n.sending) { for (const k of n.sending.keys) n.sent[k] = n.sending.at; delete n.sending; }
  const { notices, end } = fresh(ctx.paths, n.offset);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const deleted = new Map(), unclear = new Map(), dates = new Map();
  let drive = null, notebook = null, old = null;
  // Papers waiting to be sorted, as they are now; those not said yet since they began to wait.
  // (Waiting to be sorted: to check and not filed anywhere else, so on the To sort page. A filed
  // letter whose deadline needs its date has "Check this" too, and is said with the deadlines.)
  const waitingNow = docs.map((d) => [d, ctx.records.get(d.id)]).filter(([d, r]) => r && !r.user_owned && (!r.file || r.file.check) && statusOf(c, d, r) === STATUS.check);
  // (The wait began when the paper was sorted, or, when nobody sorts it here, when it was filed.)
  const sortKey = (d, r) => `sort:${d.id}:${r.sort?.at || r.file?.at || ""}`;
  const check = new Map(waitingNow.filter(([d, r]) => !n.sent[sortKey(d, r)]).map(([d, r]) => [d.id, { key: sortKey(d, r), d, r, at: r.sort?.at || r.file?.at }]));
  for (const x of notices) {
    // (A paper to check, kind "check", is counted from the papers themselves, above.)
    if (x.kind === "deleted-in-paperless") {
      const r = ctx.records.get(x.doc), key = `deleted:${x.doc}`;
      if (r?.gone && !n.sent[key]) deleted.set(x.doc, { key, r });
    } else if (x.kind === "drive-lost") {
      const since = st.drive?.lost_since, key = `drive-lost:${since}`;
      if (since && !n.sent[key]) drive = { key };
    } else if (x.kind === "notebook-down") {
      const key = `notebook-down:${x.since}`;
      if (st.notebook?.down_since === x.since && !n.sent[key]) notebook = { key };
    } else if (x.kind === "deadline-check") {
      // Still counted from the letter's date, and the person has not changed it in Godspeed.
      const d = byId.get(x.doc), r = ctx.records.get(x.doc), key = `deadline-check:${x.doc}:${x.n}`;
      const it = r?.asks?.items?.find((i) => i.n === x.n);
      if (d && it?.check && it.made && !it.touched && !n.sent[key]) dates.set(key, { key, d, r, it, at: x.at });
    } else if (x.kind === "deadlines-unsupported") {
      const key = `deadlines-unsupported:${x.since}`;
      if (st.deadlines?.unsupported_since === x.since && !n.sent[key]) old = { key };
    } else if (x.kind === "kept-out-unclear") {
      const d = byId.get(x.doc), key = `kept-out-unclear:${x.doc}`;
      if (d && keptOut(c, d) && !n.sent[key]) unclear.set(x.doc, { key, d });
    }
  }
  // Held for a pile: the outbox is read from the same place next run.
  let upTo = end;
  const papers = [...check.values(), ...dates.values()];
  const oldest = Math.min(...papers.map((x) => Date.parse(x.at)).filter(Number.isFinite));
  if (papers.length && waiting > 0 && ctx.clock() - oldest < HOLD_HOURS * 3600e3) { check.clear(); dates.clear(); upTo = n.offset; }
  const keys = [...check.values(), ...dates.values(), ...deleted.values(), ...unclear.values(), drive, notebook, old].filter(Boolean).map((x) => x.key);
  if (!keys.length) {
    if (upTo !== n.offset) { st.notify = { ...n, offset: upTo }; writeJson(ctx.paths.state, st); }
    return { sent: false };
  }

  const lines = [texts.message_head];
  if (check.size) lines.push(waitingNow.length === 1 ? texts.message_to_sort_one : fill(texts.message_to_sort, { n: waitingNow.length }));
  // Each deadline to check: one plain sentence, what to do by which day, counted from which paper's
  // date (F16). Its name and day as Godspeed has them now; the day in the person's language.
  for (const { d, r, it } of dates.values()) {
    const row = c.dl?.get(keyOf(r.sum, it.n));
    const ask = askOf(row?.title, texts.deadline_title_check) || texts.deadline_unnamed;
    lines.push(fill(texts.message_check_date, { ask, day: dayWords(row?.due || it.made_due || it.due, settings), title: plain(d.title) }));
  }
  if (drive) lines.push(texts.message_drive);
  if (deleted.size) {
    const names = [];
    for (const [id, { r }] of deleted) names.push(await deletedName(c, id, r));
    lines.push(fill(texts.message_deleted, { list: list(names) }));
  }
  if (unclear.size) lines.push(fill(texts.message_kept_out, { list: list([...unclear.values()].map(({ d }) => named(d.title, String(d.created || "").slice(0, 10)))) }));
  if (notebook) lines.push(fill(texts.message_notebook, { hours: settings.notebook_down_hours }));
  if (old) lines.push(texts.message_godspeed_old);
  // The one link, always to where the thing is, never to the notebook's collection. Papers to
  // sort: the "To sort" page, which lists exactly them (without it, Paperless's list of the papers
  // with Check this, when Godspeed sorts). A deadline to check: its paper in Paperless. A document
  // deleted in Paperless: its file in the drive. A kept-out note to clean: that note. Else
  // Paperless.
  const checkTag = c.tax.tag(settings.tags.check)?.id;
  const sortLink = check.size ? viewLink(c, paperlessWeb(c)) || (settings.sorting === "godspeed" && checkTag !== undefined ? `${paperlessWeb(c)}/documents?tags__id__all=${checkTag}` : null) : null;
  const firstDate = [...dates.values()][0];
  const firstGone = [...deleted.values()].find(({ r }) => r.copy?.file_id);
  const firstUnclear = [...unclear.values()].map(({ d }) => ctx.records.get(d.id)).find((r) => r?.note?.id && !r.note.deleted);
  const link = sortLink || (firstDate && `${paperlessWeb(c)}/documents/${firstDate.d.id}/details`)
    || (firstGone && `https://drive.google.com/file/d/${encodeURIComponent(firstGone.r.copy.file_id)}/view`)
    || (firstUnclear && c.web && `${c.web}/dashboard/notes/${encodeURIComponent(firstUnclear.note.id)}`)
    || `${paperlessWeb(c)}/documents`;
  // One thing to say: one line. More: one line each, the link last.
  const text = lines.length === 2 ? `${lines[0]} ${lines[1]} ${link}` : [...lines, link].filter(Boolean).join("\n");

  st.notify = { ...n, sending: { keys, at: now() } };
  writeJson(ctx.paths.state, st);
  let res;
  try { res = await ctx.tell(text, { link }); } catch (e) { res = { delivered: false, results: { error: e.message } }; }
  const after = readJson(ctx.paths.state, {});
  const sent = { ...n.sent };
  if (res.delivered) for (const k of keys) sent[k] = now();
  after.notify = { offset: res.delivered ? upTo : n.offset, sent };
  writeJson(ctx.paths.state, after);
  ctx.log(res.delivered ? `message sent: ${keys.length} thing(s) to act on (${Object.entries(res.results || {}).map(([k, v]) => `${k} ${v}`).join(", ")})` : `the message was not taken by any channel (${Object.entries(res.results || {}).map(([k, v]) => `${k}: ${v}`).join("; ")}); again next run`);
  return { sent: !!res.delivered, text };
}
