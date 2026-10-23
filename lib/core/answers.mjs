// The person answers in the chat, and the Clerk learns (F19).
//
// ANSWERING A QUESTION (`answer`). A number or "the second one" picks a choice; "yes" makes the
// folder the Clerk asked about; "leave it" closes the question and the paper stays in To sort;
// words name a folder (where.mjs). A folder that is there: the paper gets it. Several, a typo, the
// AI's reading of the words: they become choices of the same question, never a guess. A folder
// that is not there: one more choice, made only after the yes. Outside the documents folder:
// refused.
//
// PLACING A PAPER. When Godspeed sorts: the paper's sender is set when it has none (the sender the
// choice stands for, else the one its sender folder is named after, an existing one or a new one),
// "Check this" comes off, and the paper is filed into that folder at once. When Paperless or nobody
// sorts, nothing is written into Paperless; the paper is filed all the same.
//
// LEARNING. The folder is kept for the paper's sender: inside that sender's own folder of the same
// name the plan already sends it there (its link is kept); anywhere else a sender rule goes to the
// top of the folder plan. Another open question about a paper from the same sender is the same
// question, and is answered with it. "X papers go into Y" (`place --sender`) and "hotel bookings
// go into Travel" (`place --kind`) are rules said at any time; `place --paper` moves one paper.
import fs from "node:fs";
import { prepare, runOnce, listDocuments } from "./run.mjs";
import { loadQuestions, saveQuestions } from "./questions.mjs";
import { parseReply, findFolder, pathOf } from "./where.mjs";
import { findSame, norm, alike, wordsOf } from "./names.mjs";
import { now } from "./records.mjs";
import { readJson, writeJson, appendPrivate } from "./files.mjs";
import { folderChoices } from "./plan.mjs";
import { hasInbox } from "./pipeline.mjs";

const one = (s, max = 100) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const shown = (doc) => `"${one(doc.title, 120)}"`;
const rootName = (c) => c.confined.folders.get(c.rootId)?.name || "your documents folder";

// The folder right below a sender parent on the way down to a folder: the sender folder it is in.
export function senderFolderOf(c, id) {
  for (let at = id, i = 0; at && i < 64; i++) {
    const f = c.confined.folders.get(at);
    if (!f) return null;
    if ((c.senderParents || []).some((p) => p.id === f.parent)) return f;
    at = f.parent;
  }
  return null;
}

const relPath = (c, id) => pathOf(c, id).split("/").slice(1).join("/");

function addRule(c, rule) {
  const plan = readJson(c.ctx.paths.plan, null);
  const same = (r) => (rule.sender && r.sender && findSame([{ name: r.sender }], rule.sender)) || (rule.kind && r.kind && norm(r.kind) === norm(rule.kind));
  plan.rules = [{ ...rule, learned_at: now() }, ...(plan.rules || []).filter((r) => !same(r))];
  writeJson(c.ctx.paths.plan, plan);
  c.ctx.plan = plan;
  c.plan = plan;
  c.folderChoices = folderChoices(plan);
}

function link(c, senderId, folderId) {
  if (senderId === null || senderId === undefined || c.links[senderId] === folderId) return;
  c.links[senderId] = folderId;
  writeJson(c.ctx.paths.links, c.links);
}

// What the Clerk keeps from a paper placed in a folder: { link } | { rule } | null.
function learnFrom(c, senderName, senderId, id) {
  if (!senderName) return null;
  const sf = senderFolderOf(c, id);
  if (sf && findSame([{ name: sf.name }], senderName)) { link(c, senderId, sf.id); return { link: true }; }
  addRule(c, { sender: senderName, folder: relPath(c, id), folder_id: id });
  return { rule: true };
}

// Puts one paper into a folder: { id, path, made, sender, learned }. Throws for a folder it may not take.
async function placePaper(c, doc, rec, { folder_id = null, new: fresh = null, sender = null, learn = true }) {
  let id = folder_id;
  if (fresh) id = await c.confined.ensurePath(fresh.parent_id, fresh.names.map((name) => ({ name, create: true })));
  if (!id || !c.confined.isInside(id) || id === c.toSortId || id === c.rootId) throw new Error("that folder cannot take a paper");
  const now_ = await c.pl.document(doc.id);
  let senderId = now_.correspondent ?? null;
  let senderName = senderId !== null ? c.tax.correspondents.get(senderId)?.name ?? null : sender || senderFolderOf(c, id)?.name || null;
  if (c.writer) {
    const patch = {};
    if (senderId === null && senderName) {
      let s = findSame(c.tax.correspondents.values(), senderName);
      if (!s) { s = await c.writer.createCorrespondent(senderName); c.tax.correspondents.set(s.id, s); }
      senderId = s.id;
      senderName = s.name;
      patch.correspondent = s.id;
    }
    const check = c.tax.tag(c.settings.tags.check);
    if (check && (now_.tags || []).includes(check.id)) patch.tags = now_.tags.filter((t) => t !== check.id);
    if (Object.keys(patch).length) await c.writer.patchDocument(doc.id, patch);
  }
  const learned = learn ? learnFrom(c, senderName, senderId, id) : null;
  rec.answer = { folder_id: id, at: now(), filed: false };
  delete rec.ask_left;
  c.records.put(rec);
  c.log(`doc ${doc.id}: the person said where it goes${fresh ? " (a new folder)" : ""}`);
  return { id, path: pathOf(c, id), made: !!fresh, sender: senderName, learned };
}

function said(doc, r) {
  const parts = [`Filed ${shown(doc)} into "${r.path}"${r.made ? " (a new folder)" : ""}.`];
  if (r.learned?.rule) parts.push(`Papers from ${r.sender} go there from now on.`);
  else if (r.learned?.link) parts.push(`Its sender is ${r.sender}.`);
  return parts.join(" ");
}

// The same question about other papers: open questions about papers from that sender.
async function sameSender(c, q, docs, sender, folderId) {
  const also = [];
  if (!sender) return also;
  for (const o of Object.values(q.open)) {
    const d = docs.find((x) => x.id === o.doc), r = c.records.get(o.doc);
    if (!d || !r) continue;
    const from = d.correspondent !== null && d.correspondent !== undefined ? c.tax.correspondents.get(d.correspondent)?.name : null;
    const asSender = from ? !!findSame([{ name: from }], sender) : o.choices.some((ch) => ch.new?.names?.length === 1 && findSame([{ name: ch.new.names[0] }], sender));
    if (!asSender) continue;
    await placePaper(c, d, r, { folder_id: folderId, sender, learn: false });
    delete q.open[o.doc];
    also.push(d);
  }
  return also;
}

// Adds choices to a question, numbered after every number in use, before "another folder". A
// folder that already is a choice keeps its number. Returns the choices as they are now.
function extend(q, x, adds) {
  const all = Object.values(q.open).flatMap((o) => o.choices.map((ch) => ch.n));
  let n = all.length ? Math.max(...all) : 0;
  const out = [];
  for (const a of adds) {
    const had = a.folder_id && x.choices.find((ch) => ch.folder_id === a.folder_id);
    if (had) { out.push(had); continue; }
    const ch = { n: ++n, ...a };
    x.choices.splice(Math.max(0, x.choices.findIndex((y) => y.other)), 0, ch);
    out.push(ch);
  }
  return out;
}

const choiceWords = (c, ch) => (ch.folder_id ? `"${pathOf(c, ch.folder_id)}"` : ch.new ? `a new folder "${ch.new.names.join("/")}" in "${pathOf(c, ch.new.parent_id)}"` : "another folder");

// The person's words for a folder, for a question: { target } or { text } to say back.
async function fromWords(c, q, x, words) {
  const f = await findFolder(c, words);
  const root = rootName(c);
  if (f.folder) return f.folder.id === c.rootId ? { text: `Which folder inside "${root}"? Say its name.` } : { target: { folder_id: f.folder.id } };
  if (f.outside) return { text: `${f.outside.name ? `"${f.outside.name}" is` : "That folder is"} outside your documents folder "${root}". The Clerk files only inside "${root}": name a folder there.` };
  if (f.toSort) return { text: `"${pathOf(c, c.toSortId)}" is where it waits now. Which folder does it belong in?` };
  if (f.candidates) {
    const chs = extend(q, x, f.candidates.map((k) => ({ folder_id: k.id })));
    return { text: `Not sure which folder that is: ${chs.map((ch) => `${ch.n} = ${choiceWords(c, ch)}`).join("; ")}. Ask them which one, or which other folder.` };
  }
  if (f.missing) {
    const [ch] = extend(q, x, [{ new: { parent_id: f.missing.parent_id, names: f.missing.names } }]);
    x.pending = ch.n;
    return { text: `There is no folder "${f.missing.names.join("/")}" in "${f.missing.parent}" yet. Make it there and file the paper in it? (yes or no)` };
  }
  if (f.unavailable) return { text: "Google Drive is not open for the Clerk right now, so it cannot file the paper yet (godspeed-clerk status says why)." };
  return { text: "Which folder? Say its name." };
}

// Answers one open question. { text, filed: [doc ids] }.
export async function answer(c, { about = null, words }) {
  const q = loadQuestions(c.ctx.paths);
  const reply = parseReply(words);
  const list = Object.values(q.open);
  let x = about !== null && about !== undefined && about !== "" ? q.open[String(Number(about))] : null;
  if (!x && about !== null && about !== undefined && about !== "") return placeOne(c, { docId: Number(about), into: words });
  if (!x) {
    if (reply.kind === "number") x = list.find((o) => o.choices.some((ch) => ch.n === reply.n)) || null;
    if (!x && list.length === 1) x = list[0];
    if (!x && !list.length) return { text: "There is no open question. To file a paper, say which paper and which folder (godspeed-clerk place --paper ... --into ...).", filed: [] };
    if (!x) return { text: `Which paper is that about? Open questions about papers ${list.map((o) => o.doc).join(", ")}. Answer again with --about <the paper's number>.`, filed: [] };
  }
  const docs = await listDocuments(c);
  const doc = docs.find((d) => d.id === x.doc), rec = c.records.get(x.doc);
  if (!doc || !rec) { delete q.open[x.doc]; saveQuestions(c.ctx.paths, q); return { text: "That paper is not in Paperless any more; the question is closed.", filed: [] }; }

  let target = null, text = null;
  const pick = (ch) => {
    if (!ch) return;
    if (ch.other) { text = reply.rest ? null : "Which folder? Say its name."; return; }
    target = ch.folder_id ? { folder_id: ch.folder_id } : { new: ch.new };
  };
  if (reply.kind === "leave") {
    rec.ask_left = { at: now() };
    c.records.put(rec);
    delete q.open[x.doc];
    saveQuestions(c.ctx.paths, q);
    return { text: `${shown(doc)} stays in "${pathOf(c, c.toSortId)}"; the Clerk does not ask about it again.`, filed: [] };
  } else if (reply.kind === "number") {
    const ch = x.choices.find((y) => y.n === reply.n);
    if (!ch) text = `There is no choice ${reply.n} for ${shown(doc)}; the choices are ${x.choices.map((y) => y.n).join(", ")}.`;
    else { pick(ch); if (ch.other && reply.rest) ({ target, text } = await fromWords(c, q, x, reply.rest)); }
  } else if (reply.kind === "ordinal") {
    const ch = x.choices.at(reply.i);
    if (!ch) text = `There are only ${x.choices.length} choices.`;
    else pick(ch);
  } else if (reply.kind === "yes") {
    const ch = x.pending && x.choices.find((y) => y.n === x.pending);
    if (ch) pick(ch); else text = "Which one? Say the number.";
  } else if (reply.kind === "no") {
    if (x.pending) { x.choices = x.choices.filter((y) => y.n !== x.pending); delete x.pending; }
    if (reply.rest) ({ target, text } = await fromWords(c, q, x, reply.rest));
    else text = "Which folder then? Say its name.";
  } else ({ target, text } = await fromWords(c, q, x, reply.text));

  if (!target) { saveQuestions(c.ctx.paths, q); return { text, filed: [] }; }
  const r = await placePaper(c, doc, rec, target);
  delete q.open[x.doc];
  const also = await sameSender(c, q, docs, r.sender, r.id);
  saveQuestions(c.ctx.paths, q);
  return { text: [said(doc, r), ...(also.length ? [`Also from ${r.sender}, filed there too: ${also.map(shown).join(", ")}.`] : [])].join(" "), filed: [doc.id, ...also.map((d) => d.id)] };
}

// A folder from words for a rule or a moved paper: { id } or { text }. `make`: the person said yes.
async function folderFor(c, into, make) {
  const f = await findFolder(c, into);
  const root = rootName(c);
  if (f.folder && f.folder.id !== c.rootId) return { id: f.folder.id };
  if (f.folder) return { text: `Name a folder inside "${root}".` };
  if (f.outside) return { text: `${f.outside.name ? `"${f.outside.name}" is` : "That folder is"} outside your documents folder "${root}". The Clerk files only inside "${root}": name a folder there.` };
  if (f.toSort) return { text: `"${pathOf(c, c.toSortId)}" holds papers waiting to be placed; name the folder they belong in.` };
  if (f.candidates) return { text: `Not sure which folder that is: ${f.candidates.map((k) => `"${k.path}"`).join(", ")}. Ask them which, then run the command again with that folder's path.` };
  if (f.missing && make) return { id: await c.confined.ensurePath(f.missing.parent_id, f.missing.names.map((name) => ({ name, create: true }))), made: true };
  if (f.missing) return { text: `There is no folder "${f.missing.names.join("/")}" in "${f.missing.parent}" yet. If they want it made, run the same command again with --make.` };
  if (f.unavailable) return { text: "Google Drive is not open for the Clerk right now (godspeed-clerk status says why)." };
  return { text: "Which folder? Name it." };
}

// The papers whose titles (and senders) best match the words, best first.
export function findPaper(c, docs, words) {
  const w = wordsOf(words);
  const scored = docs.map((d) => {
    const sender = d.correspondent !== null && d.correspondent !== undefined ? c.tax.correspondents.get(d.correspondent)?.name || "" : "";
    return [alike(`${d.title || ""} ${sender}`, w), d];
  }).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0] || String(b[1].added).localeCompare(String(a[1].added)));
  if (!scored.length) return [];
  const best = scored.filter(([s]) => s === scored[0][0]).map(([, d]) => d);
  return best.length === 1 ? best : best.slice(0, 5);
}

async function placeOne(c, { docId = null, paper = null, into, make = false }) {
  const docs = await listDocuments(c);
  let doc = docId !== null ? docs.find((d) => d.id === docId) : null;
  if (docId !== null && !doc) return { text: `There is no paper ${docId} in Paperless.`, filed: [] };
  if (!doc) {
    const found = findPaper(c, docs, paper);
    if (!found.length) return { text: `No paper matches "${one(paper, 80)}".`, filed: [] };
    if (found.length > 1) return { text: `Which paper? ${found.map((d) => `${d.id} = ${shown(d)} (${String(d.created || "").slice(0, 10)})`).join("; ")}. Ask them, then run the command again with --about <the number>.`, filed: [] };
    doc = found[0];
  }
  const rec = c.records.get(doc.id);
  if (!rec?.copy) return { text: `${shown(doc)} is not in the drive yet; it is copied there within minutes.`, filed: [] };
  if (rec.user_owned) return { text: `${shown(doc)} was moved or renamed in the drive by hand, so it is the person's and the Clerk does not move it.`, filed: [] };
  if (c.settings.sorting === "godspeed" && hasInbox(c, doc)) return { text: `${shown(doc)} is still waiting to be sorted; it is sorted within minutes, then it can be moved.`, filed: [] };
  const f = await folderFor(c, into, make);
  if (!f.id) return { text: f.text, filed: [] };
  const r = await placePaper(c, doc, rec, { folder_id: f.id });
  const q = loadQuestions(c.ctx.paths);
  if (q.open[doc.id]) { delete q.open[doc.id]; saveQuestions(c.ctx.paths, q); }
  return { text: said(doc, { ...r, made: !!f.made }), filed: [doc.id] };
}

// "X papers go into Y", "hotel bookings go into Travel", "the hotel booking goes into Travel".
export async function place(c, { sender = null, kind = null, paper = null, about = null, into, make = false }) {
  if (paper || (about !== null && about !== undefined && about !== "")) return placeOne(c, { docId: about !== null && about !== undefined && about !== "" ? Number(about) : null, paper, into, make });
  if (!sender && !kind) return { text: "Say whose papers (--sender), which kind of papers (--kind), or which paper (--paper) go there.", filed: [] };
  const f = await folderFor(c, into, make);
  if (!f.id) return { text: f.text, filed: [] };
  const path = pathOf(c, f.id);
  if (kind) {
    const k = one(kind, 60);
    addRule(c, { kind: k, folder: relPath(c, f.id), folder_id: f.id });
    return { text: `From now on ${k} go into "${path}"${f.made ? " (a new folder)" : ""}.`, filed: [] };
  }
  const known = findSame(c.tax.correspondents.values(), sender);
  const name = known?.name || one(sender, 100);
  addRule(c, { sender: name, folder: relPath(c, f.id), folder_id: f.id });
  const sf = senderFolderOf(c, f.id);
  if (known && sf && findSame([{ name: sf.name }], name)) link(c, known.id, sf.id);
  const q = loadQuestions(c.ctx.paths);
  const docs = await listDocuments(c);
  const also = await sameSender(c, q, docs, name, f.id);
  if (also.length) saveQuestions(c.ctx.paths, q);
  return { text: [`From now on papers from ${name} go into "${path}"${f.made ? " (a new folder)" : ""}.`, ...(also.length ? [`Filed there now: ${also.map(shown).join(", ")}.`] : [])].join(" "), filed: also.map((d) => d.id) };
}

// The paper or papers just placed, filed now: the filing and note steps for them alone.
async function fileNow(ctx, ids) {
  if (ids.length) await runOnce({ ...ctx, steps: ["file", "note"], only: new Set(ids) });
}

export async function answerWith(ctx, args) {
  const c = await prepare(ctx);
  if (!c.confined) return { text: `Google Drive is not open for the Clerk right now (${c.notes.join("; ") || "see godspeed-clerk status"}), so nothing can be filed yet.`, filed: [] };
  const r = await answer(c, args);
  await fileNow(ctx, r.filed);
  return r;
}

export async function placeWith(ctx, args) {
  const c = await prepare(ctx);
  if (!c.confined) return { text: `Google Drive is not open for the Clerk right now (${c.notes.join("; ") || "see godspeed-clerk status"}), so nothing can be filed yet.`, filed: [] };
  const r = await place(c, args);
  await fileNow(ctx, r.filed);
  return r;
}

// Answers said while a run held the lock wait in answers.jsonl; the next run applies them first.
export function queueAnswer(paths, entry) {
  appendPrivate(paths.answers, `${JSON.stringify({ at: now(), ...entry })}\n`);
}
export async function applyQueued(c) {
  let text = "";
  try { text = fs.readFileSync(c.ctx.paths.answers, "utf8"); } catch { return []; }
  fs.rmSync(c.ctx.paths.answers, { force: true });
  const filed = [];
  for (const line of text.split("\n").filter((l) => l.trim())) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const r = e.type === "place" ? await place(c, e.args || {}) : await answer(c, e.args || {});
    filed.push(...(r.filed || []));
    c.log(`an answer saved while a run was going is applied${r.filed?.length ? `: ${r.filed.length} paper(s) placed` : ""}`);
    // What still needs the person (a follow-up) goes to them in the run's message.
    const q = loadQuestions(c.ctx.paths);
    let changed = false;
    for (const x of Object.values(q.open)) if (x.sent && x.answered_at === undefined && r.filed?.length === 0 && (e.args?.about === undefined || Number(e.args.about) === x.doc)) { x.round = (x.round || 1) + 1; delete x.sent; changed = true; }
    if (changed) saveQuestions(c.ctx.paths, q);
  }
  return filed;
}
