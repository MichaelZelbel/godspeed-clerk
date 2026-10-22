// One paper, all the way through, over the whole kit: the acceptance tests of F5, F6, F7, F8 and
// F18 against a pretend Paperless and a pretend Drive.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { kitWorld, DOCS, expected } from "./kit-world.mjs";

const ALEX = DOCS.filter((d) => d.owner === "alex").map((d) => d.slug);

// Every kit document as its expected-result file says (F5, F6, F7, F8).
function checkKit(w) {
  for (const slug of ALEX) {
    const e = expected(slug);
    const d = w.doc(slug);
    const tags = w.tagNames(d);
    if (e.title) assert.equal(d.title, e.title, `${slug}: title`);
    assert.ok(d.title && d.title !== d.original_file_name.replace(/\.pdf$/, "") || e.check, `${slug}: a real title`);
    if ("correspondent" in e) assert.equal(w.senderName(d), e.correspondent, `${slug}: sender`);
    if (e.document_type) assert.equal(w.typeName(d), e.document_type, `${slug}: type`);
    if (e.created) assert.equal(d.created, e.created, `${slug}: date`);
    for (const t of e.tags_include || []) assert.ok(tags.includes(t), `${slug}: tag ${t} in ${tags}`);
    for (const t of e.tags_exclude || []) assert.ok(!tags.includes(t), `${slug}: no tag ${t}`);
    const files = w.fileOf(slug);
    assert.equal(files.length, 1, `${slug}: exactly one file`);
    const where = w.drive.pathOf(files[0].id);
    assert.equal(where.split("/").slice(0, -1).join("/"), `Paperwork/${e.folder}`, `${slug}: folder`);
    if (!e.check) {
      const name = where.split("/").pop();
      assert.equal(name.replace(/ \(\d+\)\.pdf$/, ".pdf"), `${d.created} ${d.title}.pdf`, `${slug}: named <date> <title>.pdf`);
    }
  }
}

// What the world looks like, for comparing two runs.
function picture(w) {
  return Object.fromEntries(ALEX.map((slug) => {
    const d = w.doc(slug);
    return [slug, { title: d.title, created: d.created, sender: w.senderName(d), type: w.typeName(d), tags: w.tagNames(d), files: w.fileOf(slug).map((f) => w.drive.pathOf(f.id)).sort() }];
  }));
}

test("F5, F8: the kit ends up sorted, one correctly named file per document in its folder", async () => {
  const w = await kitWorld();
  try {
    await w.runUntilQuiet();
    checkKit(w);
    for (const p of ["Paperwork/Invoices/Hollis Roofing", "Paperwork/Taxes/2024", "Paperwork/Payslips/2025"]) assert.ok(w.drive.byPath(p), `${p} was made`);
  } finally { await w.close(); }
});

test("F8: every document is in \"To sort\" before any sorting starts", async () => {
  const w = await kitWorld();
  try {
    const r = await w.run({ steps: ["copy"] });
    assert.equal(r.copied, ALEX.length);
    for (const slug of ALEX) assert.match(w.pathOf(slug), /^Paperwork\/To sort\/2026-10-22 /, slug);
    assert.deepEqual(w.pl.writes, []);
    for (const slug of ALEX) {
      const f = w.fileOf(slug)[0];
      assert.equal(f.appProperties.clerkDoc, String(w.ids[slug]));
      assert.match(f.appProperties.clerkSum, /^[0-9a-f]{64}$/);
    }
  } finally { await w.close(); }
});

test("F6: a typed title and an extra tag stay; a document sorted before the run is unchanged", async () => {
  const w = await kitWorld();
  try {
    const before = JSON.stringify(w.doc("bank-certificate"));
    await w.runUntilQuiet();
    const ins = w.doc("insurance-statement");
    assert.equal(ins.title, "Car insurance yearly statement");
    assert.ok(w.tagNames(ins).includes("Car"));
    const after = { ...w.doc("bank-certificate") };
    assert.equal(JSON.stringify({ ...after, modified: null }), JSON.stringify({ ...JSON.parse(before), modified: null }));
    assert.equal(w.pl.writes.filter((x) => x.path === `/api/documents/${w.ids["bank-certificate"]}/`).length, 0);
  } finally { await w.close(); }
});

test("F7: the blurry scan and an answer unusable twice: Check this, nothing new, only file in To sort", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "unusable-answer", "utility-invoice"] });
  try {
    await w.runUntilQuiet();
    for (const slug of ["blurry-scan", "unusable-answer"]) {
      assert.ok(w.tagNames(w.doc(slug)).includes("Check this"), slug);
      assert.equal(w.doc(slug).correspondent, null, slug);
      assert.equal(w.fileOf(slug).length, 1, slug);
      assert.match(w.pathOf(slug), /^Paperwork\/To sort\//, slug);
    }
    const madeTags = w.pl.writes.filter((x) => x.path === "/api/tags/").map((x) => JSON.parse(x.body).name);
    assert.deepEqual(madeTags, ["Check this"]);
    assert.equal(w.pl.writes.filter((x) => x.path === "/api/correspondents/").length, 0);
    assert.equal(w.prompts.filter((p) => p.prompt.includes("LIB-UNUSABLE-ANSWER")).length, 2);
    // Not retried every hour: a second round asks nothing more about them.
    const asked = w.prompts.length;
    await w.run();
    assert.equal(w.prompts.length, asked);
  } finally { await w.close(); }
});

test("F7: a document the person resolves (Check this taken off) is filed then", async () => {
  const w = await kitWorld({ only: ["blurry-scan"] });
  try {
    await w.runUntilQuiet();
    const d = w.doc("blurry-scan");
    const letter = [...w.pl.state.types.values()].find((t) => t.name === "Letter").id;
    const check = [...w.pl.state.tags.values()].find((t) => t.name === "Check this").id;
    Object.assign(d, { title: "Dental check-up reminder", document_type: letter, created: "2025-08-20", tags: d.tags.filter((t) => t !== check), modified: new Date().toISOString() });
    await w.runUntilQuiet();
    assert.equal(w.pathOf("blurry-scan"), "Paperwork/Letters/2025-08-20 Dental check-up reminder.pdf");
  } finally { await w.close(); }
});

test("F8: two documents with the same date and title become two files", async () => {
  const w = await kitWorld({ only: ["parking-permit-a", "parking-permit-b"] });
  try {
    await w.runUntilQuiet();
    const names = [w.pathOf("parking-permit-a"), w.pathOf("parking-permit-b")].sort();
    assert.deepEqual(names, ["Paperwork/Letters/2025-07-01 Residents parking permit renewal (2).pdf", "Paperwork/Letters/2025-07-01 Residents parking permit renewal.pdf"]);
  } finally { await w.close(); }
});

test("F8: a title changed in Paperless renames the file; a file moved by hand stays; a hand-placed file is untouched", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "council-letter", "pay-slip"] });
  try {
    await w.runUntilQuiet();
    const note = w.drive.byPath("Paperwork/Letters/handwritten note.pdf");
    // Renamed in Paperless: the file follows.
    Object.assign(w.doc("utility-invoice"), { title: "Electricity bill for February", modified: new Date().toISOString() });
    // Moved by hand in the drive, then renamed in Paperless: the file stays the person's.
    const council = w.fileOf("council-letter")[0];
    w.drive.userMove(council.id, "Paperwork/Insurance");
    Object.assign(w.doc("council-letter"), { title: "New bin collection days", modified: new Date().toISOString() });
    // Renamed by hand in the drive: also the person's.
    const slip = w.fileOf("pay-slip")[0];
    w.drive.userRename(slip.id, "march pay.pdf");
    Object.assign(w.doc("pay-slip"), { title: "Salary statement March 2025", modified: new Date().toISOString() });
    await w.runUntilQuiet();
    assert.equal(w.pathOf("utility-invoice"), "Paperwork/Invoices/Brightwater Utilities/2025-03-04 Electricity bill for February.pdf");
    assert.match(w.pathOf("council-letter"), /^Paperwork\/Insurance\/2025-06-02 Changes to the waste collection/);
    assert.equal(w.pathOf("pay-slip"), "Paperwork/Payslips/2025/march pay.pdf");
    assert.equal(w.drive.writes.filter((x) => x.id === note.id).length, 0);
    assert.equal(w.drive.pathOf(note.id), "Paperwork/Letters/handwritten note.pdf");
    // A type change that moves the document moves the file.
    const invoice = [...w.pl.state.types.values()].find((t) => t.name === "Letter").id;
    Object.assign(w.doc("utility-invoice"), { document_type: invoice, modified: new Date().toISOString() });
    await w.runUntilQuiet();
    assert.equal(w.pathOf("utility-invoice"), "Paperwork/Letters/2025-03-04 Electricity bill for February.pdf");
  } finally { await w.close(); }
});

test("F8: a document deleted in Paperless leaves its file, and the record says so", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "pay-slip"] });
  try {
    await w.runUntilQuiet();
    const where = w.pathOf("pay-slip");
    w.pl.remove(w.ids["pay-slip"]);
    await w.runUntilQuiet();
    assert.equal(w.pathOf("pay-slip"), where);
    assert.ok(w.record("pay-slip").gone);
    const notes = fs.readFileSync(w.paths.outbox, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(notes.filter((x) => x.kind === "deleted-in-paperless" && x.doc === w.ids["pay-slip"]).length, 1);
  } finally { await w.close(); }
});

test("F18: killed after each step in turn, and once in the middle of an upload: the same end as a run never interrupted", async () => {
  const clean = await kitWorld();
  let want;
  try { await clean.runUntilQuiet(); want = picture(clean); } finally { await clean.close(); }

  const w = await kitWorld({ settings: { batch_size: 3 } });
  try {
    const killed = (point, nth = 1) => {
      let seen = 0;
      return (p) => { if (p === point && ++seen === nth) { const e = new Error(`killed at ${point}`); e.name = "Killed"; throw e; } };
    };
    for (const [point, nth] of [["after-copy", 2], ["mid-upload", 1], ["after-sort", 1], ["after-sort", 2], ["after-file", 1], ["after-file", 3]]) {
      await assert.rejects(w.run({ crash: killed(point, nth), chunkSize: 1024 }), /killed/, point);
    }
    await w.runUntilQuiet();
    assert.deepEqual(picture(w), want);
    for (const slug of ALEX) assert.equal(w.fileOf(slug).length, 1, slug);
  } finally { await w.close(); }
});

test("F18: with the records deleted, a run finds every file again and makes none twice", async () => {
  const w = await kitWorld();
  try {
    await w.runUntilQuiet();
    const want = picture(w);
    fs.rmSync(w.paths.records, { recursive: true, force: true });
    const before = w.drive.writes.length;
    const plBefore = w.pl.writes.length;
    await w.runUntilQuiet();
    assert.deepEqual(picture(w), want);
    assert.deepEqual(w.drive.writes.slice(before), []);
    assert.deepEqual(w.pl.writes.slice(plBefore), []);
  } finally { await w.close(); }
});
