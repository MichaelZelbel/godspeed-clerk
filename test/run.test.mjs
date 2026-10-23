// One run over the kit: F4 (who sorts), F12 (only the chosen AI), F13 (batches), F14 (privacy),
// lost Google access (F8), the household's second account, pause.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { kitWorld, DOCS, text } from "./kit-world.mjs";
import { writeJson, readJson } from "../lib/core/files.mjs";
import { statusReport } from "../lib/core/status.mjs";
import { runOnce } from "../lib/core/run.mjs";

const ALEX = DOCS.filter((d) => d.owner === "alex").map((d) => d.slug);

for (const sorting of ["paperless", "nobody"]) {
  test(`F4: with "${sorting === "paperless" ? "Paperless sorts" : "nobody sorts"}" nothing reaches Paperless and every document is filed`, async () => {
    const w = await kitWorld({ sorting });
    try {
      const before = w.pl.snapshot();
      await w.runUntilQuiet();
      assert.deepEqual(w.pl.writes, []);
      assert.equal(w.pl.snapshot(), before);
      for (const slug of ALEX) assert.equal(w.fileOf(slug).length, 1, slug);
      // The document sorted before the run follows the plan; the rest wait in To sort.
      assert.match(w.pathOf("bank-certificate"), /^Paperwork\/Taxes\/2024\/2025-02-14 Yearly tax certificate 2024\.pdf$/);
      assert.match(w.pathOf("utility-invoice"), /^Paperwork\/To sort\//);
    } finally { await w.close(); }
  });
}

test("F4: once Paperless or a person has sorted a document, the file follows", async () => {
  const w = await kitWorld({ sorting: "paperless", only: ["pay-slip"] });
  try {
    await w.runUntilQuiet();
    assert.match(w.pathOf("pay-slip"), /^Paperwork\/To sort\//);
    const d = w.doc("pay-slip");
    Object.assign(d, { title: "Pay slip March 2025", created: "2025-03-31", document_type: [...w.pl.state.types.values()].find((t) => t.name === "Pay slip").id, tags: [], modified: new Date().toISOString() });
    await w.runUntilQuiet();
    assert.equal(w.pathOf("pay-slip"), "Paperwork/Payslips/2025/2025-03-31 Pay slip March 2025.pdf");
    assert.deepEqual(w.pl.writes, []);
  } finally { await w.close(); }
});

test("F13: with a batch size of 2 and five documents, 2 are sorted and 3 wait; the next runs finish", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "roofing-invoice", "tax-assessment", "pay-slip", "council-letter"], settings: { batch_size: 2 } });
  try {
    const first = await w.run();
    assert.equal(first.sorted + first.check, 2);
    assert.equal(first.waiting, 3);
    assert.match(first.progress, /^2 of 5 sorted$/);
    const second = await w.run();
    assert.equal(second.waiting, 1);
    const third = await w.run();
    assert.equal(third.waiting, 0);
    assert.match(third.progress, /^5 of 5 sorted$/);
  } finally { await w.close(); }
});

test("F13: an archive of five documents with a note batch of 2: the notes come 2 per run, \"2 of 5 noted\"", async () => {
  // Paperless sorts and the documents were there before the Clerk: the archive, noted in batches.
  // (A document the Clerk sorts in a run is noted in that run; see notes.test.mjs.)
  const w = await kitWorld({ sorting: "paperless", only: ["utility-invoice", "roofing-invoice", "tax-assessment", "pay-slip", "council-letter"], settings: { note_batch: 2 } });
  try {
    const first = await w.run();
    assert.equal(first.noted, 2);
    assert.equal(first.notes_progress, "2 of 5 noted");
    assert.equal(first.notes_waiting, 3);
    assert.match(first.notes.join(" "), /more notes wait for the next run/);
    const second = await w.run();
    assert.equal(second.notes_progress, "4 of 5 noted");
    const third = await w.run();
    assert.equal(third.notes_progress, "5 of 5 noted");
    assert.equal(third.notes_waiting, 0);
    assert.equal(w.notes().length, 5);
    assert.equal(w.nb.rows("collection_items").length, 5);
  } finally { await w.close(); }
});

test("F8: a scan that arrives while a run is sorting gets its first copy in that same run", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "roofing-invoice"] });
  try {
    let added = null;
    const ask = w.context().ask;
    // The clock jumps past the run's time limit when the scan arrives: the late copy still goes.
    const r = await runOnce({ ...w.context(), clock: () => (added ? Date.now() + 3600e3 : Date.now()), ask: async (req) => {
      if (!added) added = w.pl.addDoc({ content: "Fairford Library, 14 April 2025. Your reserved book has arrived, reservation code LIB-LATE.", tags: [1], added: "2026-10-22T16:59:00+02:00" });
      return ask(req);
    } });
    assert.ok(added);
    assert.equal(r.copied, 3);
    assert.equal(w.drive.marked(added.id).length, 1);
    assert.equal(r.sorted + r.check, 1);
  } finally { await w.close(); }
});

test("F12: without an AI answer nothing is sorted, nothing is changed, and the first copies still go", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "injection-letter"] });
  try {
    w.aiDown = true;
    const r = await w.run();
    assert.equal(r.copied, 2);
    assert.equal(r.sorted, 0);
    assert.deepEqual(w.pl.writes, []);
    assert.match(r.notes.join(" "), /no AI answered/);
    assert.match(fs.readFileSync(w.paths.log, "utf8"), /no AI answered/);
    w.aiDown = false;
    await w.runUntilQuiet();
    assert.ok(!w.tagNames(w.doc("injection-letter")).includes("Important"));
    assert.equal(w.senderName(w.doc("injection-letter")), "Pinecrest Lettings");
    assert.equal(w.doc("injection-letter").created, "2025-07-09");
  } finally { await w.close(); }
});

test("F8: with Google access withdrawn a run files nothing and leaves one notice; after reconnecting everything waiting is filed once", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "pay-slip", "council-letter"] });
  try {
    w.drive.revoke();
    const r1 = await w.run();
    const r2 = await w.run();
    assert.deepEqual(w.drive.writes, []);
    assert.equal(r1.sorted + r2.sorted, 3); // Paperless work goes on
    const notes = fs.readFileSync(w.paths.outbox, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(notes.filter((n) => n.kind === "drive-lost").length, 1);
    assert.match(statusReport(w.paths), /Google Drive: access LOST/);
    // Reconnect: a fresh sign-in gives a new lasting token (drive finish does this and clears the loss).
    const c = readJson(w.paths.drive);
    writeJson(w.paths.drive, { ...c, refresh_token: w.drive.issue() });
    const st = readJson(w.paths.state);
    delete st.drive.lost_since;
    writeJson(w.paths.state, st);
    await w.runUntilQuiet();
    for (const slug of ["utility-invoice", "pay-slip", "council-letter"]) assert.equal(w.fileOf(slug).length, 1, slug);
    assert.equal(w.drive.writes.filter((x) => x.op === "upload").length, 3);
    assert.doesNotMatch(statusReport(w.paths), /LOST/);
  } finally { await w.close(); }
});

test("F14: no log line, record or temporary file holds a sentence of a kit document", async () => {
  const w = await kitWorld();
  try {
    await w.runUntilQuiet();
    const sentences = [];
    for (const d of DOCS) for (const s of text(d.slug).split(/[.\n]/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 4)) sentences.push(s);
    const titles = ALEX.map((slug) => w.doc(slug).title);
    const files = [];
    const walk = (dir) => { for (const n of fs.existsSync(dir) ? fs.readdirSync(dir) : []) { const p = path.join(dir, n); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } };
    walk(w.paths.records);
    files.push(w.paths.log, w.paths.state, w.paths.outbox, w.paths.links);
    for (const f of files.filter(fs.existsSync)) {
      const body = fs.readFileSync(f, "utf8");
      for (const s of sentences) assert.ok(!body.includes(s), `${path.basename(f)} holds "${s}"`);
      for (const n of w.notes()) for (const x of [n.clerk_summary, ...(n.clerk_facts || [])].filter(Boolean)) assert.ok(!body.includes(x), `${path.basename(f)} holds a note's "${x}"`);
      for (const t of titles) assert.ok(!body.includes(t), `${path.basename(f)} holds the title "${t}"`);
    }
    assert.match(fs.readFileSync(w.paths.log, "utf8"), /doc \d+: /);
    assert.ok(w.notes().length > 0 && w.messages.length === 1, "notes were written and a message sent, and none of it stays here");
    // No temporary file anywhere: the state folder holds the Clerk's own files and nothing else.
    const known = ["settings.json", "paperless.json", "drive.json", "plan.json", "state.json", "clerk.log", "outbox.jsonl", "links.json", "drive-tree.json", "drive-tree-position.json", "records"];
    for (const n of fs.readdirSync(w.paths.root)) assert.ok(known.includes(n), `unexpected ${n} in the state folder`);
    if (process.platform !== "win32") for (const f of files.filter(fs.existsSync)) assert.equal(fs.statSync(f).mode & 0o777, 0o600, f);
  } finally { await w.close(); }
});

test("only documents the signed-in account owns are handled", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "second-account-letter"] });
  try {
    const sams = JSON.stringify(w.doc("second-account-letter"));
    await w.runUntilQuiet();
    assert.equal(w.fileOf("second-account-letter").length, 0);
    assert.equal(JSON.stringify(w.doc("second-account-letter")), sams);
    assert.ok(!w.prompts.some((p) => p.prompt.includes("Riverside Book Club")));
    assert.equal(w.fileOf("utility-invoice").length, 1);
  } finally { await w.close(); }
});

test("paused: nothing is read, nothing is written", async () => {
  const w = await kitWorld({ settings: { active: false } });
  try {
    const r = await w.run();
    assert.equal(r.paused, true);
    assert.deepEqual(w.pl.state.requests, []);
    assert.deepEqual(w.drive.writes, []);
  } finally { await w.close(); }
});

test("without a confirmed plan nothing goes to the drive, and sorting goes on", async () => {
  const w = await kitWorld({ only: ["utility-invoice"], confirm: false });
  try {
    const r = await w.run();
    assert.equal(r.copied, 0);
    assert.equal(r.sorted, 1);
    assert.deepEqual(w.drive.writes, []);
    assert.match(r.notes.join(" "), /folder plan is not confirmed/);
  } finally { await w.close(); }
});

for (const sorting of ["godspeed", "paperless", "nobody"]) {
  test(`sorted by someone else without a title (${sorting}): filed by its type and sender, named <date> <type> <sender>`, async () => {
    const w = await kitWorld({ sorting, only: ["pay-slip"] });
    try {
      const d = w.doc("pay-slip");
      const type = [...w.pl.state.types.values()].find((t) => t.name === "Pay slip").id;
      const sender = [...w.pl.state.correspondents.values()].find((c) => c.name === "Kestrel Labs").id;
      Object.assign(d, { document_type: type, correspondent: sender, created: "2025-03-31", tags: sorting === "godspeed" ? [] : d.tags, modified: new Date().toISOString() });
      await w.runUntilQuiet();
      assert.equal(w.pathOf("pay-slip"), "Paperwork/Payslips/2025/2025-03-31 Pay slip Kestrel Labs.pdf");
      assert.equal(d.title, "Scan 2026-10-22 16-17-01");
    } finally { await w.close(); }
  });
}

test("a year never comes from the upload day: sorted by hand without a date, it waits in To sort and no year folder is made", async () => {
  const w = await kitWorld({ sorting: "nobody", only: ["tax-assessment"] });
  try {
    const type = [...w.pl.state.types.values()].find((t) => t.name === "Tax assessment").id;
    Object.assign(w.doc("tax-assessment"), { document_type: type, modified: new Date().toISOString() });
    await w.runUntilQuiet();
    assert.match(w.pathOf("tax-assessment"), /^Paperwork\/To sort\//);
    assert.equal(w.drive.byPath("Paperwork/Taxes/2026"), null);
  } finally { await w.close(); }
});

test("a year rule followed by a catch-all: a paper whose year is unknown waits, it does not fall into the catch-all", async () => {
  const doc = { slug: "taxnodate", owner: "alex", content: "Fairford Tax Office. Information about your tax account. Reference TAXNODATE. Addressed to Alex Morgan, 12 Elm Row, 40210 Fairford." };
  const answers = [{ match: ["TAXNODATE"], answer: { title: "Information about the tax account", correspondent: "Fairford Tax Office", document_type: "Tax assessment", tags: [], created: null, folder: null, confident: true } }];
  const w = await kitWorld({ only: [], extra: [doc], answers, rules: [{ type: "Tax assessment", folder: "Taxes/{year}" }, { folder: "Letters" }] });
  try {
    await w.runUntilQuiet();
    assert.match(w.pathOf("taxnodate"), /^Paperwork\/To sort\//);
    assert.ok(w.tagNames(w.doc("taxnodate")).includes("Check this"));
  } finally { await w.close(); }
});
