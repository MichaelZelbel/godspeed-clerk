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
import { readJson, writeJson } from "./files.mjs";
import { now } from "./records.mjs";

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
    const confined = await new Confined(ctx.drive(), { rootId: plan.root.id }).load();
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

export async function runOnce(ctx) {
  const s = ctx.settings;
  const out = { paused: !s.active, copied: 0, sorted: 0, check: 0, filed: 0, waiting: 0, total: 0, progress: "", notes: [] };
  if (!s.active) return out;
  if (!ctx.paperless) throw new Error("Paperless is not connected yet (godspeed-clerk connect)");
  const deadline = ctx.clock() + Number(s.run_minutes) * 60000;
  const timeUp = () => ctx.clock() > deadline;
  const pl = ctx.paperless;
  const me = await pl.me();
  const tax = await Taxonomy.load(pl);
  const c = {
    ctx, settings: s, pl, tax, inboxIds: tax.inboxIds(), checkTagId: tax.tag(s.tags.check)?.id ?? null,
    plan: ctx.plan?.status === "confirmed" ? ctx.plan : null, folderChoices: ctx.plan?.status === "confirmed" ? folderChoices(ctx.plan) : [],
    writer: s.sorting === "godspeed" ? pl.writer("godspeed") : null, records: ctx.records, log: ctx.log, notes: out.notes, aiDown: null, failures: 0, confined: null,
  };
  if (!c.inboxIds.length && s.sorting === "godspeed") out.notes.push("Paperless has no inbox tag, so no document counts as new");

  let docs = await pl.all("documents/", { owner__id: me.id, ordering: "added", fields: FIELDS });
  if (s.include_unowned) docs = docs.concat(await pl.all("documents/", { owner__isnull: "true", ordering: "added", fields: FIELDS }));
  // Checked here too: a Paperless that ignored the filter must not hand over someone else's papers.
  docs = docs.filter((d) => d.owner === me.id || (s.include_unowned && (d.owner === null || d.owner === undefined)))
    .sort((a, b) => String(a.added).localeCompare(String(b.added)) || a.id - b.id);
  const steps = new Set(ctx.steps);
  const rec = (doc) => ctx.records.get(doc.id) || { id: doc.id };

  await openDrive(c);

  // 1. First copies: every document, sorted or not, gets its checked copy in "To sort".
  if (c.confined && steps.has("copy")) {
    let n = 0;
    for (const doc of docs) {
      if (!c.confined) break;
      const r = rec(doc);
      if (r.copy || r.trashed) continue;
      if (n >= s.copy_batch || timeUp()) { out.notes.push("more first copies wait for the next run"); break; }
      try { if (await copyStep(c, doc, r)) { n++; out.copied++; } } catch (e) { if (failed(c, e, doc, "the first copy") === "stop-drive") break; }
    }
  }

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

  // 3. Filing: into the folder from the plan, and again when the document changed in Paperless.
  if (c.confined && steps.has("file")) {
    let n = 0;
    for (const doc of docs) {
      if (!c.confined) break;
      if (n >= s.copy_batch || timeUp()) { out.notes.push("more filing waits for the next run"); break; }
      const r = rec(doc);
      try { if (await fileStep(c, doc, r)) { n++; out.filed++; } } catch (e) { if (failed(c, e, doc, "filing") === "stop-drive") break; }
    }
  }

  // 4. Documents gone from Paperless: their files stay in the drive, and the person hears it once.
  const ids = new Set(docs.map((d) => d.id));
  for (const r of ctx.records.all()) {
    if (ids.has(r.id) || r.gone) continue;
    r.gone = { at: now() };
    ctx.records.put(r);
    ctx.log(`doc ${r.id}: no longer in Paperless${r.copy ? "; its file stays in the drive" : ""}`);
    if (r.copy) ctx.outbox({ kind: "deleted-in-paperless", doc: r.id });
  }

  const recs = new Map(docs.map((d) => [d.id, rec(d)]));
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
