// Messages only when the person can act (F16): one message per run at most, one link in it, never
// twice about the same thing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kitWorld } from "./kit-world.mjs";
import { readJson, writeJson } from "../lib/core/files.mjs";

const links = (text) => text.match(/https?:\/\/\S+/g) || [];
const change = (w, slug, fields) => Object.assign(w.doc(slug), fields, { modified: new Date().toISOString() });
// F16 and F19: papers to sort are counted in one line, with one link that opens Paperless's "To sort"
// page, which lists exactly them.
const yes = { storage_paths: "yes" };
const viewOf = (w) => [...w.pl.state.savedViews.values()][0];
const viewLink = (w) => `${w.pl.url}/view/${viewOf(w).id}`;

test("F16: a run over the kit sends exactly one message, counting the blurry document and naming the letter whose deadline needs a check, with a link that opens the To sort page listing exactly the papers waiting; a second run with nothing new sends none", async () => {
  const w = await kitWorld({ settings: yes });
  try {
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 1);
    const [m] = w.messages;
    assert.match(m, /2 papers are waiting to be sorted\./, "the blurry document and the answer unusable twice");
    // F15: the letter whose deadline was counted from a day it does not print, in one plain
    // sentence; the one with no workable day is not in a message at all (PRD of cbe871c4).
    assert.ok(m.includes(`by 9 November 2026: counted from the letter's date, 9 October 2026; the real day may be later, check it on the paper "${w.doc("parking-notice").title}".`), m);
    for (const slug of ["water-invoice", "tax-office-letter", "gym-letter", "library-reminder", "meter-letter"]) assert.ok(!m.includes(w.doc(slug).title), `${slug} is not named`);
    assert.ok(!/tell your assistant|Set the letter's date/i.test(m), m);
    // The To sort page last; the deadline to check carries its own paper's link (PRD F16 of cbe871c4).
    assert.deepEqual(links(m), [`${w.pl.url}/documents/${w.ids["parking-notice"]}/details`, viewLink(w)]);
    assert.deepEqual(w.pl.viewDocs(viewOf(w).id), [w.ids["blurry-scan"], w.ids["unusable-answer"]].sort((a, b) => a - b), "the page lists exactly the papers waiting to be sorted");
    for (const slug of ["utility-invoice", "council-letter", "doctor-letter"]) assert.ok(!m.includes(w.doc(slug).title), `${slug} is not named`);
    await w.run();
    await w.run();
    assert.equal(w.messages.length, 1);
  } finally { await w.close(); }
});

test("one paper to sort: one line with the link to the To sort page", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "utility-invoice"], settings: yes });
  try {
    await w.runUntilQuiet();
    assert.deepEqual(w.messages, [`The Clerk: 1 paper is waiting to be sorted. ${viewLink(w)}`]);
  } finally { await w.close(); }
});

test("without the To sort page (no yes), the link opens Paperless's list of exactly the papers with Check this", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "utility-invoice"] });
  try {
    await w.runUntilQuiet();
    const check = [...w.pl.state.tags.values()].find((t) => t.name === "Check this").id;
    assert.deepEqual(w.messages, [`The Clerk: 1 paper is waiting to be sorted. ${w.pl.url}/documents?tags__id__all=${check}`]);
  } finally { await w.close(); }
});

test("a paper newly waiting after earlier ones were told is told too, counting all that wait", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: yes });
  try {
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 1);
    w.pl.addDoc({ id: 70, content: "Larchmont Services. A notice about account LATE-3001 for Alex Morgan, 12 Elm Row, 40210 Fairford. Please read it carefully.", title: "Scan 2026-10-22 19-40-00", original_file_name: "Scan 2026-10-22 19-40-00.pdf", tags: [1], owner: 2, created: "2026-10-22", added: "2026-10-22T19:40:00+02:00" });
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 2);
    assert.match(w.messages[1], /2 papers are waiting to be sorted\./);
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 2, "once");
  } finally { await w.close(); }
});

test("lost drive access: one message, never twice", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 0, "nothing to act on: silence");
    w.drive.revoke();
    await w.run();
    await w.run();
    await w.run();
    assert.equal(w.messages.length, 1);
    assert.match(w.messages[0], /Google Drive no longer lets the Clerk file your papers/);
    assert.equal(links(w.messages[0]).length, 1);
  } finally { await w.close(); }
});

test("a document deleted in Paperless: one message naming it", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "pay-slip"] });
  try {
    await w.runUntilQuiet();
    const title = w.doc("pay-slip").title;
    w.pl.remove(w.ids["pay-slip"]);
    await w.runUntilQuiet();
    await w.run();
    assert.equal(w.messages.length, 1);
    assert.match(w.messages[0], /Deleted in Paperless, its file stays in your drive/);
    assert.ok(w.messages[0].includes(`"${title}"`), w.messages[0]);
  } finally { await w.close(); }
});

test("the notebook unreachable for six hours: one message", async () => {
  const w = await kitWorld({ only: ["utility-invoice"] });
  try {
    await w.runUntilQuiet();
    w.nb.down = true;
    const t0 = Date.now();
    await w.run({ clock: () => t0 });
    await w.run({ clock: () => t0 + 5 * 3600e3 });
    assert.equal(w.messages.length, 0);
    await w.run({ clock: () => t0 + 7 * 3600e3 });
    await w.run({ clock: () => t0 + 8 * 3600e3 });
    assert.equal(w.messages.length, 1);
    assert.match(w.messages[0], /Your notebook has not answered for 6 hours/);
    w.nb.down = false;
    await w.run();
    assert.equal(w.messages.length, 1);
  } finally { await w.close(); }
});

test("a message no channel took is sent next run, once", async () => {
  const w = await kitWorld({ only: ["blurry-scan"] });
  try {
    w.channelDown = true;
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 0);
    w.channelDown = false;
    await w.run();
    await w.run();
    assert.equal(w.messages.length, 1);
    assert.match(w.messages[0], /1 paper is waiting to be sorted\./);
  } finally { await w.close(); }
});

test("what is no longer true by the time a channel takes it is not said", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "unusable-answer"] });
  try {
    w.channelDown = true;
    await w.runUntilQuiet();
    const d = w.doc("blurry-scan");
    const scanTitle = d.title;
    const letter = [...w.pl.state.types.values()].find((t) => t.name === "Letter").id;
    const check = [...w.pl.state.tags.values()].find((t) => t.name === "Check this").id;
    change(w, "blurry-scan", { title: "Dental check-up reminder", document_type: letter, created: "2025-08-20", tags: d.tags.filter((t) => t !== check) });
    w.channelDown = false;
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 1);
    assert.match(w.messages[0], /1 paper is waiting to be sorted\./, "the paper still to check is counted, the resolved one is not");
    assert.ok(!w.messages[0].includes(scanTitle) && !w.messages[0].includes("Dental check-up reminder"));
  } finally { await w.close(); }
});

test("everything of one run in one message, with one link", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "pay-slip", "blurry-scan"] });
  try {
    await w.run({ steps: ["copy", "sort", "file", "note"] });
    w.pl.remove(w.ids["pay-slip"]);
    w.drive.revoke();
    await w.run();
    assert.equal(w.messages.length, 1);
    const m = w.messages[0];
    assert.match(m, /^The Clerk:\n/);
    assert.match(m, /1 paper is waiting to be sorted\./);
    assert.match(m, /Google Drive no longer lets the Clerk file/);
    assert.match(m, /Deleted in Paperless/);
    assert.equal(links(m).length, 1);
  } finally { await w.close(); }
});

test("the person's language: every sentence of a message comes from the settings", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: { ...yes, texts: { message_head: "Der Clerk:", message_to_sort_one: "1 Papier wartet aufs Einsortieren." } } });
  try {
    await w.runUntilQuiet();
    assert.equal(w.messages[0], `Der Clerk: 1 Papier wartet aufs Einsortieren. ${viewLink(w)}`);
    const st = readJson(w.paths.state);
    assert.ok(Object.keys(st.notify.sent).some((k) => k.startsWith(`sort:${w.ids["blurry-scan"]}:`)));
    assert.ok(!JSON.stringify(st.notify).includes(w.doc("blurry-scan").title), "the state keeps numbers, not titles");
    writeJson(w.paths.state, st);
  } finally { await w.close(); }
});

test("a pile being sorted: papers to check come in one message when it is done, not one per run", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "injection-letter", "parking-permit-a", "unusable-answer"], settings: { batch_size: 1 } });
  try {
    const first = await w.run();
    assert.equal(first.check, 1);
    assert.ok(first.waiting > 0);
    assert.equal(w.messages.length, 0, "held while the pile is still being sorted");
    // Something urgent does not wait for the pile.
    w.drive.revoke();
    await w.run();
    assert.equal(w.messages.length, 1);
    assert.match(w.messages[0], /Google Drive/);
    assert.doesNotMatch(w.messages[0], /waiting to be sorted/);
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 2);
    assert.match(w.messages[1], /2 papers are waiting to be sorted\./, w.messages[1]);
  } finally { await w.close(); }
});

test("papers to check are held for a pile at most a day", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "injection-letter", "parking-permit-a"], settings: { batch_size: 1 } });
  try {
    await w.run();
    w.aiDown = true;
    await w.run({ clock: () => Date.now() + 20 * 3600e3 });
    assert.equal(w.messages.length, 0);
    await w.run({ clock: () => Date.now() + 25 * 3600e3 });
    assert.equal(w.messages.length, 1);
    assert.match(w.messages[0], /1 paper is waiting to be sorted\./);
  } finally { await w.close(); }
});

test("status says how far the notes are, where the notebook is, and where messages go", async () => {
  const { statusReport } = await import("../lib/core/status.mjs");
  const w = await kitWorld({ only: ["utility-invoice", "doctor-letter"], settings: { talk: ["telegram"] } });
  try {
    await w.runUntilQuiet();
    const s = statusReport(w.paths, { env: {}, home: w.paths.root });
    assert.match(s, /Notebook: answers \(https:\/\/notebook\.example\); 2 of 2 noted; collection "Documents"\./);
    assert.match(s, /Messages: telegram NOT ready \(no Telegram bot was found/);
    w.nb.down = true;
    await w.run();
    assert.match(statusReport(w.paths, { env: {}, home: w.paths.root }), /Notebook: NOT answering since \d{4}-/);
  } finally { await w.close(); }
});

test("a kept-out paper the Clerk could not place is still reported, and its item says check this without a title", async () => {
  const unsure = { slug: "kept-unsure", owner: "alex", upload: { tags: ["Not in notebook"] }, content: "Marlow Clinic. Results of your scan, reference KEPT-UNSURE-1. Addressed to Alex Morgan, 12 Elm Row, 40210 Fairford. Please call us to talk about them." };
  const byHand = { slug: "kept-contract", owner: "alex", content: "Westbrook Storage. Your storage unit contract, unit 14B, reference KEPT-CONTRACT-2, starts on 1 May 2025 for Alex Morgan.",
    presorted: { title: "Storage unit contract", correspondent: "Westbrook Storage", document_type: "Contract", tags: ["Not in notebook"], created: "2025-04-20" } };
  for (const [sorting, doc] of [["godspeed", unsure], ["nobody", byHand]]) {
    const w = await kitWorld({ sorting, only: [], extra: [doc], answers: [{ match: ["Pick the folder"], answer: { folder: null, confident: false } }] });
    try {
      await w.runUntilQuiet();
      assert.match(w.pathOf(doc.slug), /^Paperwork\/To sort\//, sorting);
      assert.equal(w.messages.length, 1, `${sorting}: one message`);
      assert.match(w.messages[0], /1 paper is waiting to be sorted\./, w.messages[0]);
      const it = w.nb.rows("collection_items").find((i) => i.source_id === w.record(doc.slug).sum);
      assert.equal(it.data.status, "check this", sorting);
      assert.equal(it.data.title, undefined);
      assert.deepEqual(Object.keys(it.data).sort(), ["added", "folder", "status"]);
      assert.equal(w.notesOf(doc.slug).length, 0);
    } finally { await w.close(); }
  }
});

const unsureDocs = (n, prefix, extra = {}) => Array.from({ length: n }, (_, i) => ({ slug: `${prefix}-${i}`, owner: "alex", content: `Harlow Services. A notice about account ${prefix.toUpperCase()}-${1000 + i}, for Alex Morgan, 12 Elm Row, 40210 Fairford. Please read it carefully.`, ...extra }));

test("many papers to sort: one short line, all counted, one link to the page that lists them", async () => {
  const w = await kitWorld({ only: [], extra: unsureDocs(13, "many"), answers: [], settings: { ...yes, batch_size: 20 } });
  try {
    await w.runUntilQuiet();
    assert.deepEqual(w.messages, [`The Clerk: 13 papers are waiting to be sorted. ${viewLink(w)}`]);
    assert.equal(w.pl.viewDocs(viewOf(w).id).length, 13);
  } finally { await w.close(); }
});

test("a web address in a paper's title never becomes the message's link", async () => {
  // A paper named in a message (here: deleted in Paperless) keeps its title without the scheme, and
  // the message's one link is never the address in its title.
  const [doc] = unsureDocs(1, "url", { upload: { title: "Order from https://shop.example/orders/77" } });
  const w = await kitWorld({ only: ["utility-invoice"], extra: [{ ...doc, presorted: { title: "Order from https://shop.example/orders/77", correspondent: "Brightwater Utilities", document_type: "Invoice", tags: [], created: "2025-04-02" } }], answers: [] });
  try {
    await w.runUntilQuiet();
    const seen = [];
    w.pl.remove(w.ids["url-0"]);
    await w.runUntilQuiet({ tell: async (text, opts = {}) => { seen.push({ text, link: opts.link }); return { delivered: true }; } });
    assert.equal(seen.length, 1);
    assert.match(seen[0].text, /Deleted in Paperless/);
    assert.ok(seen[0].text.includes("Order from shop.example/orders/77"), seen[0].text);
    assert.deepEqual(seen[0].text.match(/https?:\/\/\S+/g), [seen[0].link]);
    assert.ok(!seen[0].link.includes("shop.example"), seen[0].link);
  } finally { await w.close(); }
});

test("a kept-out document deleted in Paperless is named by its file, never as kept out", async () => {
  const w = await kitWorld({ only: ["doctor-letter", "council-letter", "utility-invoice"] });
  try {
    await w.runUntilQuiet();
    const keep = [...w.pl.state.tags.values()].find((t) => t.name === "Not in notebook").id;
    change(w, "council-letter", { tags: [...w.doc("council-letter").tags, keep] });
    await w.runUntilQuiet();
    const before = w.messages.length;
    w.pl.remove(w.ids["doctor-letter"]);
    w.pl.remove(w.ids["council-letter"]);
    await w.runUntilQuiet();
    assert.equal(w.messages.length, before + 1);
    const m = w.messages[w.messages.length - 1];
    assert.ok(!m.includes("Document kept out of the notebook"), m);
    assert.ok(m.includes('"2025-09-03 Blood test results"') && m.includes('"2025-06-02 Changes to the waste collection from July 2025"'), m);
  } finally { await w.close(); }
});
