// Deadlines from letters (F15), the step after the collection item (F18 order): each request with a
// day becomes a Godspeed deadline, made through the product's add-on deadlines (the notebook's
// local door, docs/full-version/addon-model.md in the product). Godspeed reminds about it the way
// it reminds about any deadline; the Clerk sends no reminders of its own.
//
// ONCE. Each deadline's key is the document's mark and which request it is (keyOf). Godspeed makes
// one per key, so a crash between making it and recording it, lost records or a rebuilt Paperless
// never make a second one: the next run finds it in the list.
//
// THE PERSON'S. A deadline the person changed (its name or a date) or closed is theirs: Godspeed
// says it was "touched", and the Clerk never changes it again. Only a corrected letter date moves
// an untouched deadline counted from it, and only a "Not in notebook" tag renames one.
//
// WHAT IS SAID. A deadline counted from a day the letter does not print ("check the date") and a
// letter whose period has no printed date to count from go into the one message per run (F16); the
// latter also gets "Check this" when Godspeed sorts. "Important" stays on a paper while one of its
// deadlines is today or later (when Godspeed sorts), and comes off after only when the Clerk put it
// there; once the person took it off, never again.
//
// The records hold the dates, numbers and flags (rec.asks), never a request's words (F14): those
// live in the note (clerk_asks), in this run's memory, and in Godspeed's deadline.
import { now } from "./records.mjs";
import { metaOf, hasCheck, flagCheck } from "./pipeline.mjs";
import { plan, letterDate, keyOf, cleanRequests } from "./deadlines.mjs";
import { isoDay } from "./sorter.mjs";
import { keptOut, noteReady, isArchive, noteTitle, links, summaryRequest, validateSummary } from "./notes.mjs";
import { readJson, writeJson } from "./files.mjs";

const fill = (t, vars) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const AI_ERRORS = new Set(["ModelUnavailable", "RouteRefused"]);

// What a note's header says the letter asked (the words included), or null.
export function asksOfNote(cur) {
  const a = cur?.clerk_asks;
  if (!a || typeof a !== "object" || !Array.isArray(a.items)) return null;
  return { read: typeof a.read === "string" ? a.read : null, requests: cleanRequests(a.items) };
}

// rec.asks from a reading ({ read, requests }), or counted again from what it holds: the letter's
// date may have been corrected in Paperless since. Returns true when the record changed.
export function settleAsks(c, doc, rec, reading = null, { archive = false } = {}) {
  if (!rec.asks && !reading && !archive) return false;
  const meta = metaOf(c, doc, rec);
  const read = rec.asks ? rec.asks.read ?? null : reading?.read ?? null;
  const letter = letterDate({ date: meta.date, uploadDay: meta.uploadDay, dateRead: meta.dateRead, readCreated: read });
  const source = rec.asks ? rec.asks.items : archive && !reading ? [] : reading.requests;
  const items = plan(source, letter, c.ctx.today, rec.asks?.items);
  const next = { ...(rec.asks || {}), read, letter, items, ...(archive && !rec.asks ? { archive: true } : {}) };
  const same = rec.asks && JSON.stringify({ ...rec.asks, at: null }) === JSON.stringify({ ...next, at: null });
  if (same) return false;
  rec.asks = { ...next, at: now() };
  return true;
}

// The words of each request, by number: this run's memory, else the note's header.
export function askWords(c, doc) {
  const m = c.askWords?.get(doc.id);
  if (m) return m;
  const h = c.headerAsks?.get(doc.id);
  return h ? new Map(h.requests.map((r) => [r.n, r.ask])) : new Map();
}

// The note's lines: what needs no doing any more (vague, already passed) for the key facts; the
// deadlines and the period with no date to count from for its "Deadlines" part.
export function noteLines(rec, words, texts) {
  const facts = [], lines = [];
  for (const i of rec.asks?.items || []) {
    const ask = words.get(i.n) || texts.deadline_unnamed;
    if (i.kind === "vague") facts.push(fill(texts.ask_vague, { ask }));
    else if (i.kind === "nodate") lines.push(fill(texts.deadline_nodate, { ask }));
    else if (i.passed) facts.push(fill(texts.deadline_passed, { ask, date: i.due }));
    else lines.push(fill(i.check ? texts.deadline_check : texts.deadline_by, { ask, date: i.due }));
  }
  return { facts, lines };
}

// The item's "Deadlines" column: each day (Godspeed's own, once made), passed, to check, or none to
// count from.
export function deadlinesText(c, rec) {
  const t = c.settings.texts;
  return (rec.asks?.items || []).filter((i) => i.kind !== "vague").map((i) => {
    if (i.kind === "nodate") return t.item_nodate;
    // Godspeed's own day whenever it holds the deadline, also before the records know it is made
    // (lost records), so the item never says another day for a moment.
    const row = c.dl?.get(keyOf(rec.sum, i.n)) || null;
    const day = row?.due || i.made_due || i.due;
    if (i.passed && !row) return `${day} (${t.item_passed})`;
    return i.check && !row?.touched ? `${day} (${t.item_check})` : day;
  }).join("; ");
}

export const needsDate = (rec) => (rec.asks?.items || []).some((i) => i.kind === "nodate");

// The deadline's name: what the letter asks, or, kept out of the notebook (F11), only the
// document's title and date. "(check the date)" when it was counted from a day the letter does not
// print. Without the request's words (a later run, lost records) the name is the title and date
// too, and `sure` says it is only a stand-in, so an existing deadline is never renamed for that.
function titleFor(c, doc, rec, item, words) {
  const t = c.settings.texts, meta = metaOf(c, doc, rec);
  const out = keptOut(c, doc), kept = out || !words.get(item.n);
  const base = kept ? fill(t.deadline_title_kept, { title: noteTitle(c, doc, meta), date: meta.date }) : words.get(item.n);
  return { title: (item.check ? fill(t.deadline_title_check, { ask: base }) : base).replace(/\s+/g, " ").trim().slice(0, 300), kind: kept ? "kept" : "ask", sure: out || !kept };
}

// The Clerk's deadlines in Godspeed, once per run: a Map by key, or null when this Godspeed cannot
// keep them (it says so once) or the notebook did not answer.
export async function loadDeadlines(c) {
  const st = readJson(c.ctx.paths.state, {});
  try {
    const got = await c.nb.deadlines({ action: "list" });
    c.dl = new Map((got?.deadlines || []).map((d) => [d.key, d]));
    if (st.deadlines?.unsupported_since) { delete st.deadlines.unsupported_since; writeJson(c.ctx.paths.state, st); c.log("Godspeed keeps deadlines now"); }
  } catch (e) {
    c.dl = null;
    if (e.name !== "NotebookError" || !e.missing) throw e;
    if (!st.deadlines?.unsupported_since) {
      st.deadlines = { ...(st.deadlines || {}), unsupported_since: now() };
      writeJson(c.ctx.paths.state, st);
      c.ctx.outbox({ kind: "deadlines-unsupported", since: st.deadlines.unsupported_since });
      c.log("this Godspeed cannot keep deadlines from letters yet; they are made once it is updated");
    }
    c.notes.push("this Godspeed cannot keep deadlines from letters yet (update Godspeed)");
  }
  return c.dl;
}

// A reading for a paper that has no note to read it (kept out of the notebook): the letter's date
// and its requests. From this run's sorting, else one AI call, in the same batches as the notes'.
// null: not now (no AI, no turn left, or a paper to check that waits for the person).
async function readFor(c, doc, rec) {
  const mem = c.summaries?.get(doc.id);
  if (mem?.requests) return { read: mem.created ?? null, requests: mem.requests };
  if (c.summaries?.has(doc.id) || (rec.sort?.result === "check" && hasCheck(c, doc))) return null;
  if (c.aiDown || c.summariesLeft <= 0 || c.timeUp?.()) return null;
  c.summariesLeft -= 1;
  try {
    const full = await c.pl.document(doc.id);
    const r = await c.ctx.ask({ ...summaryRequest(full, c.settings), timeoutMs: (Number(c.settings.ai_timeout_s) || 120) * 1000 });
    const v = validateSummary(r.text, c.ctx.today);
    return { read: v?.created ?? null, requests: v?.requests ?? [] };
  } catch (e) {
    if (!AI_ERRORS.has(e.name)) throw e;
    if (!c.aiDown) { c.aiDown = e; c.log(`doc ${doc.id}: its deadlines wait, no AI answered`); }
    return null;
  }
}

// "Important" while a deadline is ahead (F15), when Godspeed sorts. Returns true when it changed
// the document in Paperless.
async function important(c, doc, rec) {
  if (c.settings.sorting !== "godspeed" || !c.writer) return false;
  const today = isoDay(c.ctx.today);
  const days = rec.asks.items.filter((i) => i.made).map((i) => c.dl.get(keyOf(rec.sum, i.n))?.due || i.made_due).filter(Boolean);
  const ahead = days.some((d) => d >= today);
  const was = rec.asks.important;
  const tag = c.tax.tag(c.settings.tags.important);
  const has = !!tag && (doc.tags || []).includes(tag.id);
  const patch = async (tags) => {
    const fresh = await c.pl.document(doc.id);
    const next = tags(fresh.tags || []);
    const patched = await c.writer.patchDocument(doc.id, { tags: next });
    doc.tags = patched.tags;
    doc.modified = patched.modified;
  };
  if (ahead && (!was || was === "removed")) {
    if (has) { rec.asks.important = "had"; return false; }
    let t = tag;
    if (!t) { t = await c.writer.createTag(c.settings.tags.important); c.tax.tags.set(t.id, t); }
    await patch((tags) => [...new Set([...tags, t.id])]);
    rec.asks.important = "added";
    c.log(`doc ${doc.id}: tagged important while its deadline is ahead`);
    return true;
  }
  if (was === "added" && !has) { rec.asks.important = "person"; return false; }
  if (!ahead && was === "added" && has) {
    await patch((tags) => tags.filter((x) => x !== tag.id));
    rec.asks.important = "removed";
    c.log(`doc ${doc.id}: its deadlines have passed; the important tag is off again`);
    return true;
  }
  return false;
}

// Returns { made, moved, paperless } (counts, and whether the document changed in Paperless), or
// null when there was nothing to do.
export async function deadlineStep(c, doc, rec) {
  if (!noteReady(rec) || !c.dl) return null;
  let changed = false;
  if (!rec.asks) {
    // Usually the note step read the letter already. When it did not (kept out of the notebook,
    // a note in the trash or changed by the person, lost records): the note's header, else the
    // deadlines Godspeed holds for this paper, else a reading of its own.
    const archive = isArchive(c, doc, rec);
    const header = c.headerAsks?.get(doc.id);
    const prefix = keyOf(rec.sum, "");
    const found = header ? [] : [...c.dl.values()].filter((d) => d.key.startsWith(prefix));
    if (header) {
      settleAsks(c, doc, rec, header);
      c.askWords?.set(doc.id, new Map(header.requests.map((r) => [r.n, r.ask])));
    } else if (found.length) {
      // What was made is all that is known: nothing more is made, and no AI is asked.
      rec.asks = { read: null, letter: null, recovered: true, at: now(),
        items: found.map((d) => ({ n: Number(d.key.slice(prefix.length)), by: d.due, within: null, from: null, from_date: null, vague: false, kind: "date", due: d.due, basis: "written", check: false, passed: false, made: true, made_due: d.due })) };
    } else {
      const reading = archive ? null : await readFor(c, doc, rec);
      if (!reading && !archive) return null;
      settleAsks(c, doc, rec, reading, { archive });
      if (reading) c.askWords?.set(doc.id, new Map(reading.requests.map((r) => [r.n, r.ask])));
    }
    changed = true;
  } else if (!rec.asks.recovered && settleAsks(c, doc, rec)) changed = true;

  const words = askWords(c, doc);
  const texts = c.settings.texts;
  const out = { made: 0, moved: 0, paperless: false };
  for (const item of rec.asks.items) {
    const key = keyOf(rec.sum, item.n);
    const row = c.dl.get(key);
    if (row && !item.made) { item.made = true; item.made_due = row.due; changed = true; }
    if (item.made) {
      if (!row) continue; // its file is gone from Godspeed by hand: never made again
      if (row.touched) { if (!item.touched) { item.touched = true; changed = true; } continue; }
      const want = titleFor(c, doc, rec, item, words);
      const patch = {};
      if (item.due && item.due !== item.made_due && item.basis === "letter") patch.due = item.due;
      if (item.titled && want.sure && want.kind !== item.titled) patch.title = want.title;
      if (!Object.keys(patch).length) continue;
      const r = await c.nb.deadlines({ action: "update", key, ...patch });
      if (r?.deadline) c.dl.set(key, r.deadline);
      if (r?.updated) { if (patch.due) item.made_due = patch.due; if (patch.title) item.titled = want.kind; out.moved++; c.log(`doc ${doc.id}: deadline ${item.n} ${patch.due ? "moved to the corrected letter date" : "renamed"} in Godspeed`); }
      else item.touched = true;
      changed = true;
      continue;
    }
    if (!item.due || item.passed || item.kind === "vague" || item.kind === "nodate") continue;
    const { title, kind } = titleFor(c, doc, rec, item, words);
    const r = await c.nb.deadlines({ action: "create", key, title, due: item.due, done_when: texts.deadline_done, cost: texts.deadline_cost, link: links(c, doc, rec).paperless });
    c.ctx.crash("after-deadline");
    c.dl.set(key, r.deadline);
    Object.assign(item, { made: true, made_due: r.deadline?.due || item.due, titled: kind });
    changed = true;
    if (r.created) out.made++;
    c.log(`doc ${doc.id}: deadline ${item.n} ${r.created ? "made" : "found"} in Godspeed`);
  }
  // A deadline counted from a day the letter does not print: the person is asked to check it, once
  // (also when it was made in a run that stopped before it was recorded).
  for (const item of rec.asks.items) {
    if (item.made && item.check && !item.told && !item.touched) { c.ctx.outbox({ kind: "deadline-check", doc: doc.id, n: item.n }); item.told = true; changed = true; }
  }
  // A period with no printed date to count from: the person is asked for the date, once.
  if (needsDate(rec) && !rec.asks.nodate_told) {
    const before = doc.modified;
    await flagCheck(c, doc, "no date to count the deadline from", false);
    if (doc.modified !== before) out.paperless = true;
    c.ctx.outbox({ kind: "deadline-nodate", doc: doc.id });
    rec.asks.nodate_told = true;
    changed = true;
  }
  if (await important(c, doc, rec)) { out.paperless = true; changed = true; }
  if (changed) c.records.put(rec);
  return changed ? out : null;
}
