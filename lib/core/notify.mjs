// Messages only when the person can act (F16): a paper the Clerk could not place, asked as a
// question with numbered choices (F19); Google Drive no longer letting it file; a document deleted
// in Paperless; the notebook silent for hours; a note it could not clean for "Not in notebook".
// (Deadlines join with the next version.) Everything of that kind from one run comes as ONE short
// message; everything else is silent.
//
// EACH PAPER BY ITS TITLE, WITH ITS OWN LINK: the paper's file in the drive (its page in Paperless
// while it has none; for a note to clean, the note). Never a link to a list where the paper cannot
// be found. Every word comes from the settings (`texts`), in the language the person talks to
// Godspeed in.
//
// QUESTIONS (questions.mjs) are asked at most MAX_QUESTIONS at a time: while that many asked ones
// are open, a new one waits, and the message counts the ones still waiting, so a pile never
// becomes a wall of text and the person answers a few at a time.
//
// The steps write what happened into the outbox (records.mjs), by number. This step reads what is
// new there since the last message, drops what is no longer true (a paper resolved, the drive
// back, the notebook back) and what the person already heard (`state.notify.sent`, keys such as
// "ask:12:1"), and hands one message to the channels. A message no channel took stays for the next
// run. The keys are marked as being sent before the channels get the message, so a crash in that
// moment can never make the person hear it twice.
//
// A PILE. While a run leaves documents waiting to be sorted (a first import of hundreds), papers to
// ask about are held, so the person gets one message when the pile is done instead of one every few
// minutes; held at most HOLD_HOURS. Everything urgent (the drive, a deletion, the notebook) goes at
// once.
import fs from "node:fs";
import { readJson, writeJson } from "./files.mjs";
import { now } from "./records.mjs";
import { keptOut, paperlessWeb, inDrive } from "./notes.mjs";
import { loadQuestions, saveQuestions, choiceText, askKey, fill } from "./questions.mjs";

export const HOLD_HOURS = 24;
export const MAX_NAMES = 10; // a list of papers names at most this many, and counts the rest
export const MAX_QUESTIONS = 3; // papers asked about at a time

// A paper's name in a message, without a web address's scheme, so its own link is the only one.
const named = (title, date) => `"${String(title).replace(/\s+/g, " ").replace(/\bhttps?:\/\//gi, "").trim()}"${date ? ` (${date})` : ""}`;
const day = (d) => String(d?.created || "").slice(0, 10);

// The paper itself: its file in the drive, else its page in Paperless.
export function paperLink(c, id, rec) {
  return rec && inDrive(rec) ? `https://drive.google.com/file/d/${encodeURIComponent(rec.copy.file_id)}/view` : `${paperlessWeb(c)}/documents/${id}/details`;
}

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

// Keys being sent when a run ended: the person may have heard them; never again. A question among
// them counts as asked.
function settleSending(c, n) {
  if (!n.sending) return;
  const q = loadQuestions(c.ctx.paths);
  let asked = false;
  for (const k of n.sending.keys) {
    n.sent[k] = n.sending.at;
    const m = k.match(/^ask:(\d+):(\d+)$/);
    const x = m && q.open[m[1]];
    if (x && askKey(x) === k && !x.sent) { x.sent = n.sending.at; asked = true; }
  }
  if (asked) saveQuestions(c.ctx.paths, q);
  delete n.sending;
}

export async function notifyStep(c, docs, { waiting = 0 } = {}) {
  const { ctx, settings } = c;
  const texts = settings.texts;
  const toSort = c.plan?.to_sort?.name || settings.to_sort;
  const st = readJson(ctx.paths.state, {});
  const n = { offset: 0, sent: {}, ...(st.notify || {}) };
  settleSending(c, n);
  const { notices, end } = fresh(ctx.paths, n.offset);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const deleted = new Map(), unclear = new Map();
  let drive = null, notebook = null;
  for (const x of notices) {
    // (A paper to check, kind "check", is asked as a question below.)
    if (x.kind === "deleted-in-paperless") {
      const r = ctx.records.get(x.doc), key = `deleted:${x.doc}`;
      if (r?.gone && !n.sent[key]) deleted.set(x.doc, { key, r });
    } else if (x.kind === "drive-lost") {
      const since = st.drive?.lost_since, key = `drive-lost:${since}`;
      if (since && !n.sent[key]) drive = { key };
    } else if (x.kind === "notebook-down") {
      const key = `notebook-down:${x.since}`;
      if (st.notebook?.down_since === x.since && !n.sent[key]) notebook = { key };
    } else if (x.kind === "kept-out-unclear") {
      const d = byId.get(x.doc), key = `kept-out-unclear:${x.doc}`;
      if (d && keptOut(c, d) && !n.sent[key]) unclear.set(x.doc, { key, d, r: ctx.records.get(x.doc) });
    }
  }

  // The questions: the ones not asked yet, as many as there is room for, unless a pile is still
  // being sorted (held at most HOLD_HOURS).
  const q = loadQuestions(ctx.paths);
  const open = Object.values(q.open).filter((x) => byId.has(x.doc));
  const waitingQs = open.filter((x) => !x.sent && !n.sent[askKey(x)]).sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.doc - b.doc);
  const oldest = Math.min(...waitingQs.map((x) => Date.parse(x.at)).filter(Number.isFinite));
  const held = waitingQs.length && waiting > 0 && ctx.clock() - oldest < HOLD_HOURS * 3600e3;
  const room = Math.max(0, MAX_QUESTIONS - open.filter((x) => x.sent).length);
  const asking = held ? [] : waitingQs.slice(0, room);

  const keys = [...asking.map(askKey), ...[...deleted.values(), ...unclear.values(), drive, notebook].filter(Boolean).map((x) => x.key)];
  if (!keys.length) {
    if (end !== n.offset) { st.notify = { ...n, offset: end }; writeJson(ctx.paths.state, st); }
    return { sent: false };
  }

  const lines = [texts.message_head];
  let first = null;
  for (const x of asking) {
    const d = byId.get(x.doc), link = paperLink(c, x.doc, ctx.records.get(x.doc));
    first ||= link;
    lines.push(fill(x.unreadable ? texts.question_unreadable : texts.question, { paper: named(d.title, day(d)), to_sort: toSort }), link);
    for (const ch of x.choices) lines.push(`${ch.n}. ${choiceText(c, ch, texts)}`);
  }
  if (asking.length) {
    const more = waitingQs.length - asking.length;
    if (more > 0) lines.push(fill(texts.questions_more, { n: more, to_sort: toSort }));
    lines.push(texts.question_end);
  }
  if (drive) lines.push(texts.message_drive);
  const papers = (header, items) => {
    lines.push(header);
    for (const it of items.slice(0, MAX_NAMES)) { lines.push(it.name, it.link); first ||= it.link; }
    if (items.length > MAX_NAMES) lines.push(fill(texts.message_more, { n: items.length - MAX_NAMES }));
  };
  if (deleted.size) {
    const items = [];
    for (const [id, { r }] of deleted) items.push({ name: await deletedName(c, id, r), link: paperLink(c, id, r) });
    papers(texts.message_deleted, items);
  }
  if (unclear.size) {
    papers(texts.message_kept_out, [...unclear.values()].map(({ d, r }) => ({ name: named(d.title, day(d)),
      link: c.web && r?.note?.id ? `${c.web}/dashboard/notes/${encodeURIComponent(r.note.id)}` : paperLink(c, d.id, r) })));
  }
  if (notebook) lines.push(fill(texts.message_notebook, { hours: settings.notebook_down_hours }));
  const text = lines.filter(Boolean).join("\n");

  st.notify = { ...n, sending: { keys, at: now() } };
  writeJson(ctx.paths.state, st);
  let res;
  try { res = await ctx.tell(text, { link: first }); } catch (e) { res = { delivered: false, results: { error: e.message } }; }
  const after = readJson(ctx.paths.state, {});
  const sent = { ...n.sent };
  if (res.delivered) {
    for (const k of keys) sent[k] = now();
    if (asking.length) {
      const q2 = loadQuestions(ctx.paths);
      for (const x of asking) if (q2.open[x.doc] && askKey(q2.open[x.doc]) === askKey(x)) q2.open[x.doc].sent = now();
      saveQuestions(ctx.paths, q2);
    }
  }
  after.notify = { offset: res.delivered ? end : n.offset, sent };
  writeJson(ctx.paths.state, after);
  ctx.log(res.delivered ? `message sent: ${keys.length} thing(s) to act on (${Object.entries(res.results || {}).map(([k, v]) => `${k} ${v}`).join(", ")})` : `the message was not taken by any channel (${Object.entries(res.results || {}).map(([k, v]) => `${k}: ${v}`).join("; ")}); again next run`);
  return { sent: !!res.delivered, text };
}
