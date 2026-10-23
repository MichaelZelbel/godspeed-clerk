// One run: first copies, then sorting, then filing, each within the run's time and batch limits
// (F13), so a pile of hundreds of documents never blocks Godspeed's AI connection for the other
// add-ons, and a run can always say how far it is ("212 of 640 sorted").
//
// Only documents the signed-in account owns are handled (a partner's documents on a shared
// Paperless are never read, sorted, filed or copied). With "Paperless sorts" or "nobody sorts"
// there is no Paperless writer at all (F4). When Google no longer accepts the connection, the
// work in Paperless goes on and the filing waits; the person hears about it once (F8).
import { Taxonomy } from "./paperless.mjs";
import { Confined } from "./drive.mjs";
import { folderChoices } from "./plan.mjs";
import { copyStep, sortStep, fileStep, hasInbox } from "./pipeline.mjs";
import { senderParents } from "./senders.mjs";
import { readJson, writeJson } from "./files.mjs";
import { now } from "./records.mjs";
import { noteStep, noteReady } from "./notes.mjs";
import { itemStep } from "./documents.mjs";

const FIELDS = "id,title,tags,correspondent,document_type,created,added,modified,owner,original_file_name";
const DRIVE_ERRORS = new Set(["DriveError", "OutsideError", "PaperlessError"]);
const AI_ERRORS = new Set(["ModelUnavailable", "RouteRefused"]);

function markLost(c, why) {
  const st = readJson(c.ctx.paths.state, {});
  st.drive = st.drive || {};
  if (!st.drive.lost_since) {
    st.drive.lost_since = now();
    writeJson(c.ctx.paths.state, st);
    c.ctx.outbox({ kind: "drive-lost" });
    c.log(`Google Drive no longer accepts the connection (${why}); filing waits until it is connected again`);
  }
  c.confined = null;
  c.notes.push("Google Drive access is lost; filing waits until it is connected again (godspeed-clerk drive connect)");
}

async function openDrive(c) {
  const { ctx } = c;
  if (!ctx.driveConn) { c.notes.push("Google Drive is not connected yet"); return; }
  const plan = ctx.plan;
  if (!plan || plan.status !== "confirmed" || !plan.root?.id || !plan.to_sort?.id) { c.notes.push("the folder plan is not confirmed yet, so nothing goes to the drive"); return; }
  try {
    const confined = await new Confined(ctx.drive(), { rootId: plan.root.id }).load({ cachePath: ctx.paths.driveTree });
    let toSort = plan.to_sort.id;
    if (!confined.isInside(toSort)) toSort = await confined.ensurePath(plan.root.id, [{ name: plan.to_sort.name, create: true }]);
    Object.assign(c, { confined, rootId: plan.root.id, toSortId: toSort });
    const st = readJson(ctx.paths.state, {});
    if (st.drive?.lost_since) { delete st.drive.lost_since; st.drive.reconnected_at = now(); writeJson(ctx.paths.state, st); c.log("Google Drive accepts the connection again"); }
  } catch (e) {
    if (e.name === "DriveAccessLost") return markLost(c, e.message);
    if (DRIVE_ERRORS.has(e.name)) { c.notes.push(`the drive could not be read this run: ${e.message}`); return; }
    throw e;
  }
}

// What one failed document means for the run: lost access stops the drive work, no AI stops
// what needs the AI, anything else is that document's problem only. Everything else (a crash in
// the tests, a bug) goes up.
function failed(c, e, doc, step) {
  if (e.name === "DriveAccessLost") { markLost(c, e.message); return "stop-drive"; }
  if (AI_ERRORS.has(e.name)) {
    if (!c.aiDown) { c.aiDown = e; c.notes.push(e.name === "RouteRefused" ? `the AI was refused: ${e.message}` : "no AI answered; the documents wait in the inbox"); c.log(`doc ${doc.id}: left as it was, ${e.name === "RouteRefused" ? "the AI route was refused" : "no AI answered"}`); }
    return "stop-ai";
  }
  if (DRIVE_ERRORS.has(e.name)) { c.log(`doc ${doc.id}: ${step} failed: ${e.message}`); c.failures++; return "next"; }
  throw e;
}

// Whether the notebook answers this run, and since when it has not. Silent for
// `notebook_down_hours`: one notice for the person, once for that stretch (F16).
async function notebookUp(c) {
  const { ctx } = c;
  if (!ctx.notebook) { c.notes.push("no notebook is connected, so no notes are written"); return false; }
  const st = readJson(ctx.paths.state, {});
  const was = st.notebook || {};
  const at = new Date(ctx.clock()).toISOString();
  if (await ctx.notebook.answers()) {
    let web = was.web || null;
    try { web = (await ctx.notebook.address()) || web; } catch { /* the address it gave before stays */ }
    st.notebook = { web, ok_at: at };
    if (was.down_since) c.log("the notebook answers again");
  } else {
    st.notebook = { ...was, down_since: was.down_since || at };
    c.notes.push("the notebook did not answer; the notes wait");
    if (!was.down_since) c.log("the notebook did not answer; the notes wait");
    const hours = (ctx.clock() - Date.parse(st.notebook.down_since)) / 3600000;
    if (hours >= Number(c.settings.notebook_down_hours) && st.notebook.told !== st.notebook.down_since) {
      st.notebook.told = st.notebook.down_since;
      ctx.outbox({ kind: "notebook-down", since: st.notebook.down_since });
    }
  }
  writeJson(ctx.paths.state, st);
  c.web = st.notebook.web || null;
  return !st.notebook.down_since;
}

// 5. and 6. for every document that is filed: its note, then its item in the Documents collection
// (F18 order), in batches (F13). The notebook not answering ends this part of the run only.
async function notebookWork(c, docs, out, rec) {
  let n = 0;
  for (const doc of docs) {
    const r = rec(doc);
    if (!noteReady(r)) continue;
    if (n >= Number(c.settings.note_batch)) { out.notes.push("more notes wait for the next run"); break; }
    try {
      const a = await noteStep(c, doc, r);
      if (a) { out.noted++; n++; }
      if (await itemStep(c, doc, r)) { out.items++; if (!a) n++; }
    } catch (e) {
      if (e.name === "NotebookDown") { out.notes.push("the notebook stopped answering during the run; the other notes wait"); c.log(`doc ${doc.id}: ${e.message}; the other notes wait`); break; }
      if (e.name === "NotebookError" || e.name === "PaperlessError") { c.log(`doc ${doc.id}: the note or its item failed: ${e.message}`); c.failures++; continue; }
      throw e;
    }
  }
}

export async function runOnce(ctx) {
  const s = ctx.settings;
  const out = { paused: !s.active, copied: 0, sorted: 0, check: 0, filed: 0, noted: 0, items: 0, waiting: 0, notes_waiting: 0, total: 0, progress: "", notes_progress: "", notes: [] };
  if (!s.active) return out;
  if (!ctx.paperless) throw new Error("Paperless is not connected yet (godspeed-clerk connect)");
  const deadline = ctx.clock() + Number(s.run_minutes) * 60000;
  // When the Clerk first ran: documents Paperless had before are the archive (notes.mjs).
  const st0 = readJson(ctx.paths.state, {});
  if (!st0.started_at) { st0.started_at = now(); writeJson(ctx.paths.state, st0); }
  const timeUp = () => ctx.clock() > deadline;
  const pl = ctx.paperless;
  const me = await pl.me();
  const tax = await Taxonomy.load(pl);
  const c = {
    ctx, settings: s, pl, tax, inboxIds: tax.inboxIds(),
    plan: ctx.plan?.status === "confirmed" ? ctx.plan : null, folderChoices: ctx.plan?.status === "confirmed" ? folderChoices(ctx.plan) : [],
    writer: s.sorting === "godspeed" ? pl.writer("godspeed") : null, records: ctx.records, log: ctx.log, notes: out.notes, aiDown: null, failures: 0, confined: null,
    startedAt: st0.started_at, summaries: new Map(), timeUp, summariesLeft: Number(s.batch_size), nb: ctx.notebook,
  };
  if (!c.inboxIds.length && s.sorting === "godspeed") out.notes.push("Paperless has no inbox tag, so no document counts as new");

  const list = async () => {
    let all = await pl.all("documents/", { owner__id: me.id, ordering: "added", fields: FIELDS });
    if (s.include_unowned) all = all.concat(await pl.all("documents/", { owner__isnull: "true", ordering: "added", fields: FIELDS }));
    // Checked here too: a Paperless that ignored the filter must not hand over someone else's papers.
    return all.filter((d) => d.owner === me.id || (s.include_unowned && (d.owner === null || d.owner === undefined)))
      .sort((a, b) => String(a.added).localeCompare(String(b.added)) || a.id - b.id);
  };
  let docs = await list();
  const steps = new Set(ctx.steps);
  const rec = (doc) => ctx.records.get(doc.id) || { id: doc.id };

  // Back in Paperless (out of its bin, or owned by this account again): not gone any more.
  for (const d of docs) {
    const r = ctx.records.get(d.id);
    if (r?.gone) { delete r.gone; ctx.records.put(r); ctx.log(`doc ${d.id}: back in Paperless`); }
  }

  await openDrive(c);
  c.senderParents = c.confined && c.plan ? senderParents(c.confined, c.plan) : [];
  c.links = readJson(ctx.paths.links, {});
  // Never offered as a place for a paper: "To sort" itself (and, from a later version, the Clerk's own folder).
  c.excluded = new Set([c.toSortId].filter(Boolean));
  c.picksLeft = Number(s.batch_size); // folder questions to the AI while filing, per run

  // 1. First copies: every document, sorted or not, gets its checked copy in "To sort".
  let copiesLeft = Number(s.copy_batch);
  const copies = async (list, { late = false } = {}) => {
    if (!c.confined || !steps.has("copy")) return;
    for (const doc of list) {
      if (!c.confined) break;
      const r = rec(doc);
      if (r.copy || r.trashed) continue;
      if (copiesLeft <= 0 || (!late && timeUp())) { out.notes.push("more first copies wait for the next run"); break; }
      try { if (await copyStep(c, doc, r)) { copiesLeft--; out.copied++; } } catch (e) { if (failed(c, e, doc, "the first copy") === "stop-drive") break; }
    }
  };
  await copies(docs);

  // 2. Sorting, when Godspeed sorts: in batches, after each document's first copy.
  if (steps.has("sort")) {
    let n = 0;
    for (const doc of docs) {
      const r = rec(doc);
      if (r.sort) continue;
      const needsAi = s.sorting === "godspeed" && hasInbox(c, doc);
      if (needsAi && (c.aiDown || n >= s.batch_size || timeUp() || (c.confined && !r.copy && !r.trashed))) continue;
      try {
        const res = await sortStep(c, doc, r);
        if (res) { n++; if (res === "check") out.check++; else out.sorted++; }
      } catch (e) { failed(c, e, doc, "sorting"); }
    }
  }

  // The documents as they are now: filing works from what sorting just wrote, never from the list
  // read before it. Scans that arrived while the run was sorting get their first copy now, not a
  // run later, so a copy is in the drive within minutes of Paperless reading it however long the
  // sorting took. (Copies are quick; this pass is bounded by copy_batch, not by the run's time.)
  if (steps.has("sort") && (steps.has("file") || steps.has("copy"))) {
    const known = new Set(docs.map((d) => d.id));
    docs = await list();
    const fresh = docs.filter((d) => !known.has(d.id));
    if (fresh.length && steps.has("copy")) await copies(fresh, { late: true });
  }

  // 3. Filing: into the folder from the plan, and again when the document changed in Paperless.
  // Bounded by copy_batch and, for questions to the AI, by batch_size, not by the run's time, so a
  // document sorted in this run is filed in this run.
  if (c.confined && steps.has("file")) {
    let n = 0;
    for (const doc of docs) {
      if (!c.confined) break;
      if (n >= s.copy_batch) { out.notes.push("more filing waits for the next run"); break; }
      const r = rec(doc);
      try { if (await fileStep(c, doc, r)) { n++; out.filed++; } } catch (e) { if (failed(c, e, doc, "filing") === "stop-drive") break; }
    }
  }

  // 4. Documents gone from Paperless: their files stay in the drive, and the person hears it once.
  // Missing from the list is not enough (a moment with another owner); only Paperless saying so
  // for that very document is: not found, or in its bin.
  const ids = new Set(docs.map((d) => d.id));
  for (const r of ctx.records.all()) {
    if (ids.has(r.id) || r.gone) continue;
    let gone = false;
    try { const d = await pl.document(r.id); gone = !!d?.deleted_at; } catch (e) { if (e.status === 404) gone = true; else if (e.name !== "PaperlessError") throw e; }
    if (!gone) continue;
    r.gone = { at: now() };
    ctx.records.put(r);
    ctx.log(`doc ${r.id}: no longer in Paperless${r.copy ? "; its file stays in the drive" : ""}`);
    if (r.copy) ctx.outbox({ kind: "deleted-in-paperless", doc: r.id });
  }

  // 5. Notes (F10, F11) and 6. the Documents collection (F17), after filing.
  if (s.notebook && steps.has("note") && await notebookUp(c)) await notebookWork(c, docs, out, rec);

  const recs = new Map(docs.map((d) => [d.id, rec(d)]));
  const noted = (r) => !!(r.note?.key || r.note?.deleted);
  out.notes_waiting = s.notebook ? docs.filter((d) => noteReady(recs.get(d.id)) && !noted(recs.get(d.id))).length : 0;
  out.notes_progress = s.notebook ? `${docs.filter((d) => noted(recs.get(d.id))).length} of ${docs.length} noted` : "";
  out.total = docs.length;
  if (s.sorting === "godspeed") {
    out.waiting = docs.filter((d) => hasInbox(c, d) && !recs.get(d.id).sort).length;
    out.progress = `${docs.filter((d) => recs.get(d.id).sort).length} of ${docs.length} sorted`;
  } else {
    out.waiting = docs.filter((d) => !recs.get(d.id).file && !recs.get(d.id).user_owned).length;
    out.progress = `${docs.filter((d) => recs.get(d.id).file || recs.get(d.id).user_owned).length} of ${docs.length} filed`;
  }
  out.to_check = docs.filter((d) => recs.get(d.id).sort?.result === "check" || recs.get(d.id).file?.check).length;
  out.in_drive = docs.filter((d) => recs.get(d.id).copy).length;
  const st = readJson(ctx.paths.state, {});
  st.last_run = { at: now(), copied: out.copied, sorted: out.sorted, check: out.check, filed: out.filed, waiting: out.waiting, total: out.total, progress: out.progress, to_check: out.to_check, in_drive: out.in_drive, failures: c.failures, notes: out.notes };
  writeJson(ctx.paths.state, st);
  ctx.log(`run: ${out.copied} copied, ${out.sorted} sorted, ${out.check} to check, ${out.filed} filed; ${out.progress}, ${out.waiting} waiting${c.failures ? `, ${c.failures} failed` : ""}`);
  return out;
}
