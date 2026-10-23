// Messages only when the person can act (F16): one message per run at most, one link in it, never
// twice about the same thing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kitWorld } from "./kit-world.mjs";
import { readJson, writeJson } from "../lib/core/files.mjs";

const links = (text) => text.match(/https?:\/\/\S+/g) || [];
const change = (w, slug, fields) => Object.assign(w.doc(slug), fields, { modified: new Date().toISOString() });
// F16: a paper is linked to its own file in the drive, never to a list where it cannot be found.
const fileLink = (w, slug) => `https://drive.google.com/file/d/${w.fileOf(slug)[0].id}/view`;

test("F16: a run over the kit sends exactly one message, naming the blurry document; a second run with nothing new sends none", async () => {
  const w = await kitWorld();
  try {
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 1);
    const [m] = w.messages;
    assert.ok(m.includes(`"${w.doc("blurry-scan").title}"`), m);
    assert.ok(m.includes(`"${w.doc("unusable-answer").title}"`), "the answer unusable twice is a paper to check too");
    assert.match(m, /waiting in "To sort"/);
    assert.deepEqual(links(m).sort(), [fileLink(w, "blurry-scan"), fileLink(w, "unusable-answer")].sort(), "each paper with a link that opens its own file in the drive");
    assert.ok(!m.includes("/collections/"), "never a link to a list");
    for (const slug of ["utility-invoice", "council-letter", "doctor-letter"]) assert.ok(!m.includes(w.doc(slug).title), `${slug} is not named`);
    await w.run();
    await w.run();
    assert.equal(w.messages.length, 1);
  } finally { await w.close(); }
});

test("one paper to check: the link opens its file in the drive", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "utility-invoice"] });
  try {
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 1);
    assert.deepEqual(links(w.messages[0]), [fileLink(w, "blurry-scan")]);
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
    assert.deepEqual(links(w.messages[0]), [], "no paper in it, so no link to a list instead");
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
    assert.deepEqual(links(w.messages[0]), [fileLink(w, "pay-slip")], "its file, which stays");
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
    assert.ok(w.messages[0].includes(`"${w.doc("blurry-scan").title}"`));
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
    assert.ok(w.messages[0].includes(`"${w.doc("unusable-answer").title}"`), "the paper still to check is named");
    assert.ok(!w.messages[0].includes(`"${scanTitle}"`) && !w.messages[0].includes("Dental check-up reminder"), "the resolved one is not");
  } finally { await w.close(); }
});

test("everything of one run in one message, each paper with its own link", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "pay-slip", "blurry-scan"] });
  try {
    await w.run({ steps: ["copy", "sort", "file", "note"] });
    w.pl.remove(w.ids["pay-slip"]);
    w.drive.revoke();
    await w.run();
    assert.equal(w.messages.length, 1);
    const m = w.messages[0];
    assert.match(m, /^The Clerk:\n/);
    assert.match(m, /Where does "[^"]+" \(2026-10-22\) go\?/);
    assert.match(m, /Google Drive no longer lets the Clerk file/);
    assert.match(m, /Deleted in Paperless/);
    assert.deepEqual(links(m).sort(), [fileLink(w, "blurry-scan"), fileLink(w, "pay-slip")].sort());
  } finally { await w.close(); }
});

test("the person's language: every sentence of a message comes from the settings", async () => {
  const texts = { message_head: "Der Clerk:", question: "Wohin gehört {paper}? Es liegt in \"{to_sort}\".", choice_folder: "Dein Ordner \"{folder}\"", choice_new: "Ein neuer Ordner \"{name}\" in \"{parent}\"",
    choice_other: "Ein anderer Ordner: sag welcher", question_end: "Antworte mit der Nummer oder in deinen Worten." };
  const w = await kitWorld({ only: ["blurry-scan"], settings: { to_sort: "Zu sortieren", texts } });
  try {
    await w.runUntilQuiet();
    const lines = w.messages[0].split("\n");
    assert.equal(lines[0], "Der Clerk:");
    assert.match(lines[1], /^Wohin gehört "[^"]+" \(2026-10-22\)\? Es liegt in "Zu sortieren"\.$/);
    assert.equal(lines[3], "1. Dein Ordner \"Paperwork/Letters\"");
    assert.equal(lines[4], "2. Ein anderer Ordner: sag welcher");
    assert.equal(lines.at(-1), texts.question_end);
    const st = readJson(w.paths.state);
    assert.ok(Object.keys(st.notify.sent).some((k) => k === `ask:${w.ids["blurry-scan"]}:1`));
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
    assert.doesNotMatch(w.messages[0], /Where does/);
    // The person connects the drive again (a paper is asked about once it can be filed: F19).
    writeJson(w.paths.drive, { ...readJson(w.paths.drive), refresh_token: w.drive.issue() });
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 2);
    assert.ok(w.messages[1].includes(`"${w.doc("blurry-scan").title}"`) && w.messages[1].includes(`"${w.doc("unusable-answer").title}"`), w.messages[1]);
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
    assert.ok(w.messages[0].includes(`"${w.doc("blurry-scan").title}"`));
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
      assert.ok(w.messages[0].includes(`"${w.doc(doc.slug).title}"`), w.messages[0]);
      const it = w.nb.rows("collection_items").find((i) => i.source_id === w.record(doc.slug).sum);
      assert.equal(it.data.status, "check this", sorting);
      assert.equal(it.data.title, undefined);
      assert.deepEqual(Object.keys(it.data).sort(), ["added", "folder", "status"]);
      assert.equal(w.notesOf(doc.slug).length, 0);
    } finally { await w.close(); }
  }
});

const unsureDocs = (n, prefix, extra = {}) => Array.from({ length: n }, (_, i) => ({ slug: `${prefix}-${i}`, owner: "alex", content: `Harlow Services. A notice about account ${prefix.toUpperCase()}-${1000 + i}, for Alex Morgan, 12 Elm Row, 40210 Fairford. Please read it carefully.`, ...extra }));

test("many papers to check: one short message, three asked, each with its own link, the rest counted and asked once those are answered", async () => {
  const w = await kitWorld({ only: [], extra: unsureDocs(13, "many"), answers: [], settings: { batch_size: 20 } });
  try {
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 1);
    const m = w.messages[0];
    assert.equal((m.match(/^Where does "[^"]+" \(2026-10-22\) go\?/gm) || []).length, 3, m);
    assert.equal(links(m).length, 3);
    assert.match(m, /10 more papers are waiting in "To sort"/);
    assert.ok(m.length < 1200, `${m.length} characters`);
    await w.run();
    assert.equal(w.messages.length, 1, "nothing more while those three are open");
    const { answerWith } = await import("../lib/core/answers.mjs");
    const asked = Object.values(readJson(w.paths.questions).open).filter((q) => q.sent);
    for (const q of asked) await answerWith(w.context(), { about: q.doc, words: "leave it" });
    await w.run();
    assert.equal(w.messages.length, 2);
    assert.equal((w.messages[1].match(/^Where does /gm) || []).length, 3, "the next three");
    assert.match(w.messages[1], /7 more papers/);
  } finally { await w.close(); }
});

test("a web address in a paper's title never becomes the message's link", async () => {
  const [doc] = unsureDocs(1, "url", { upload: { title: "Order from https://shop.example/orders/77" } });
  const w = await kitWorld({ only: [], extra: [doc], answers: [] });
  try {
    const seen = [];
    await w.runUntilQuiet({ tell: async (text, opts = {}) => { seen.push({ text, link: opts.link }); return { delivered: true }; } });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].link, fileLink(w, "url-0"));
    assert.deepEqual(seen[0].text.match(/https?:\/\/\S+/g), [seen[0].link]);
    assert.ok(seen[0].text.includes("Order from shop.example/orders/77"), seen[0].text);
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

test("F19: the question reaches the person with its numbered choices, its link, and how to answer", async () => {
  const { HOTEL_TREE, booking, bookingPlaces, bookingSorted } = await import("./fixtures/papers.mjs");
  const w = await kitWorld({ only: [], extra: [booking], tree: HOTEL_TREE, rules: [{ folder: "{sender}" }], answers: [bookingPlaces, bookingSorted] });
  try {
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 1);
    assert.deepEqual(w.messages[0].split("\n"), [
      "The Clerk:",
      `Where does "Hotel booking Hotel Lindenhof Hillport" (2026-10-21) go? It is waiting in "To sort".`,
      fileLink(w, "hotel-booking"),
      "1. A new folder \"Hotel Lindenhof\" in \"Paperwork\"",
      "2. Your folder \"Paperwork/Travel\"",
      "3. Your folder \"Paperwork/Wayfarer Trips Ltd\"",
      "4. Another folder: say which",
      "Answer with the number or in your own words.",
    ]);
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 1, "asked once");
  } finally { await w.close(); }
});

test("a question being sent when a run was killed is never sent again", async () => {
  const w = await kitWorld({ only: ["blurry-scan"] });
  try {
    await w.runUntilQuiet({ steps: ["copy", "sort", "file", "note"] });
    // The run that sends it is killed after the channel took the message, before it was recorded.
    const st = readJson(w.paths.state);
    st.notify = { offset: 0, sent: {}, sending: { keys: [`ask:${w.ids["blurry-scan"]}:1`], at: new Date().toISOString() } };
    writeJson(w.paths.state, st);
    await w.runUntilQuiet();
    assert.equal(w.messages.length, 0);
    assert.ok(readJson(w.paths.questions).open[w.ids["blurry-scan"]].sent, "and the question counts as asked");
  } finally { await w.close(); }
});
