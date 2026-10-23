// F19: the person answers in the chat, and the Clerk learns. The acceptance tests of the PRD first,
// then what a real conversation brings: "the second one", a typo, a folder that is not there yet, a
// folder outside, "leave it", a rule for a sender or a kind of paper, one paper moved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kitWorld } from "./kit-world.mjs";
import { readJson } from "../lib/core/files.mjs";
import { loadQuestions } from "../lib/core/questions.mjs";
import { answerWith, placeWith } from "../lib/core/answers.mjs";
import { HOTEL_TREE, booking, bookingPlaces, bookingSorted } from "./fixtures/papers.mjs";

const open = (w) => Object.values(loadQuestions(w.paths).open);
const folderOf = (w, slug) => String(w.pathOf(slug)).split("/").slice(0, -1).join("/");
const hotelWorld = (extra = {}) => kitWorld({ only: [], extra: [booking], tree: HOTEL_TREE, rules: [{ folder: "{sender}" }], answers: [bookingPlaces, bookingSorted], ...extra });

test("F19: answering \"1\" files it into that folder and removes Check this", async () => {
  const w = await kitWorld({ only: ["blurry-scan"] });
  try {
    await w.runUntilQuiet();
    const [q] = open(w);
    assert.equal(q.choices[0].n, 1);
    const r = await answerWith(w.context(), { words: "1" });
    assert.match(r.text, /Paperwork\/Letters/);
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Letters");
    assert.ok(!w.tagNames(w.doc("blurry-scan")).includes("Check this"));
    assert.equal(open(w).length, 0);
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "blurry-scan"), "Paperwork/Letters", "it stays there");
    assert.equal(open(w).length, 0, "and is not asked about again");
    const item = w.nb.rows("collection_items").find((i) => i.source_id === w.record("blurry-scan").sum);
    assert.equal(item.data.status, "sorted");
    assert.equal(item.data.folder, "Letters");
  } finally { await w.close(); }
});

test("F19: answering \"the Travel folder\" files it into Travel", async () => {
  const w = await hotelWorld();
  try {
    await w.runUntilQuiet();
    const r = await answerWith(w.context(), { about: w.ids["hotel-booking"], words: "the Travel folder" });
    assert.match(r.text, /Paperwork\/Travel/);
    assert.equal(folderOf(w, "hotel-booking"), "Paperwork/Travel");
    assert.ok(!w.tagNames(w.doc("hotel-booking")).includes("Check this"));
    assert.equal(open(w).length, 0);
  } finally { await w.close(); }
});

// The PRD's Deutsche Bahn example, made up: Fairway Rail papers go into the person's folder "Trains".
const RAIL_TREE = { Paperwork: { Trains: {}, Letters: {} }, "Holiday photos": {} };
const unsureTicket = { slug: "rail-ticket", owner: "alex", content: "Fairway Rail. Your ticket FR-TICKET-0091. Fairford to Hillport, single, 20 October 2026. Passenger Alex Morgan, 12 Elm Row, 40210 Fairford." };
const railInvoice = { slug: "rail-invoice", owner: "alex", content: "Fairway Rail. Invoice FR-INV-7781 for your season ticket, October 2026, 129.00 EUR. Customer Alex Morgan, 12 Elm Row, 40210 Fairford." };
const RAIL_ANSWERS = [
  { match: ["Suggest places", "FR-TICKET-0091"], answer: { places: [{ new_folder: "Fairway Rail" }] } },
  { match: ["FR-TICKET-0091"], answer: { title: "Train ticket Fairford to Hillport", correspondent: "Fairway Rail", document_type: null, tags: [], created: "2026-10-20", folder: null, confident: false, unsure: ["correspondent", "document_type"] } },
  { match: ["FR-INV-7781"], answer: { title: "Season ticket invoice October 2026", correspondent: "Fairway Rail", document_type: "Invoice", tags: [], created: "2026-10-01", folder: "{sender}", sender_folder: "NEW", confident: true } },
];

test("F19: after \"Fairway Rail papers go into the Trains folder\", a second Fairway Rail document is filed there without a question", async () => {
  const w = await kitWorld({ only: [], extra: [unsureTicket], tree: RAIL_TREE, rules: [{ folder: "{sender}" }], answers: RAIL_ANSWERS });
  try {
    await w.runUntilQuiet();
    assert.equal(open(w).length, 1, "the ticket is a question");
    const r = await placeWith(w.context(), { sender: "Fairway Rail", into: "the Trains folder" });
    assert.match(r.text, /Fairway Rail/);
    assert.equal(folderOf(w, "rail-ticket"), "Paperwork/Trains", "the waiting ticket from that sender is the same question: answered too");
    assert.equal(w.senderName(w.doc("rail-ticket")), "Fairway Rail");
    assert.equal(open(w).length, 0);
    const plan = readJson(w.paths.plan);
    assert.equal(plan.rules[0].sender, "Fairway Rail");
    assert.equal(plan.rules[0].folder, "Trains");
    // The second document from that sender.
    w.pl.addDoc({ id: 50, content: railInvoice.content, title: "Scan 2026-10-22 18-00-00", original_file_name: "Scan 2026-10-22 18-00-00.pdf", tags: [1], owner: 2, created: "2026-10-22", added: "2026-10-22T18:00:00+02:00" });
    w.ids["rail-invoice"] = 50;
    const before = w.messages.length;
    await w.runUntilQuiet();
    assert.equal(folderOf(w, "rail-invoice"), "Paperwork/Trains");
    assert.equal(open(w).length, 0, "no question");
    assert.equal(w.messages.length, before, "and no message");
    assert.equal(w.drive.writes.filter((x) => x.op === "create-folder").length, 0, "no look-alike folder made");
  } finally { await w.close(); }
});

test("F19: a folder name outside the documents folder is refused", async () => {
  const w = await kitWorld({ only: ["blurry-scan"] });
  try {
    await w.runUntilQuiet();
    const where = w.pathOf("blurry-scan");
    const writes = w.drive.writes.length;
    for (const words of ["Holiday photos", "My Drive/Holiday photos", `https://drive.google.com/drive/folders/${w.drive.idOf("Holiday photos")}`]) {
      const r = await answerWith(w.context(), { words });
      assert.match(r.text, /outside/i, words);
      assert.match(r.text, /Paperwork/, words);
    }
    const plan = JSON.stringify(readJson(w.paths.plan));
    const r = await placeWith(w.context(), { sender: "Pinecrest Dental Practice", into: "Holiday photos" });
    assert.match(r.text, /outside/i);
    assert.equal(JSON.stringify(readJson(w.paths.plan)), plan, "no rule learned");
    assert.equal(w.pathOf("blurry-scan"), where);
    assert.equal(w.drive.writes.length, writes, "nothing written anywhere");
    assert.equal(open(w).length, 1, "the question is still open");
  } finally { await w.close(); }
});

test("\"the second one\", and a number from the message, pick from the question", async () => {
  const w = await hotelWorld();
  try {
    await w.runUntilQuiet();
    await answerWith(w.context(), { words: "the second one" });
    assert.equal(folderOf(w, "hotel-booking"), "Paperwork/Travel");
  } finally { await w.close(); }
});

test("a new folder the Clerk offered is made when it is chosen, and the paper gets a sender named like it", async () => {
  const w = await hotelWorld();
  try {
    await w.runUntilQuiet();
    const r = await answerWith(w.context(), { words: "1" });
    assert.match(r.text, /new folder/i);
    assert.equal(folderOf(w, "hotel-booking"), "Paperwork/Hotel Lindenhof");
    assert.equal(w.senderName(w.doc("hotel-booking")), "Hotel Lindenhof");
    assert.deepEqual(w.drive.writes.filter((x) => x.op === "create-folder").map((x) => x.name), ["Hotel Lindenhof"]);
  } finally { await w.close(); }
});

test("a folder that is not there yet: made only after the person's yes", async () => {
  const w = await hotelWorld();
  try {
    await w.runUntilQuiet();
    const r = await answerWith(w.context(), { words: "put it in Holidays 2026" });
    assert.match(r.text, /no folder "Holidays 2026"/i);
    assert.equal(w.drive.writes.filter((x) => x.op === "create-folder").length, 0);
    assert.match(w.pathOf("hotel-booking"), /^Paperwork\/To sort\//);
    const no = await answerWith(w.context(), { words: "no" });
    assert.match(no.text, /which folder/i);
    assert.equal(w.drive.writes.filter((x) => x.op === "create-folder").length, 0);
    await answerWith(w.context(), { words: "Holidays 2026" });
    await answerWith(w.context(), { words: "yes" });
    assert.equal(folderOf(w, "hotel-booking"), "Paperwork/Holidays 2026");
  } finally { await w.close(); }
});

test("a typo is offered back as a choice, never filed straight away", async () => {
  const w = await hotelWorld();
  try {
    await w.runUntilQuiet();
    const r = await answerWith(w.context(), { words: "Travle" });
    assert.match(r.text, /Paperwork\/Travel/);
    assert.match(w.pathOf("hotel-booking"), /^Paperwork\/To sort\//);
    const [q] = open(w);
    const travel = q.choices.find((c) => c.folder_id === w.drive.idOf("Paperwork/Travel"));
    await answerWith(w.context(), { words: String(travel.n) });
    assert.equal(folderOf(w, "hotel-booking"), "Paperwork/Travel");
  } finally { await w.close(); }
});

test("\"leave it\": the paper stays in To sort, the question is closed and never asked again", async () => {
  const w = await hotelWorld();
  try {
    await w.runUntilQuiet();
    await answerWith(w.context(), { words: "leave it" });
    assert.equal(open(w).length, 0);
    await w.runUntilQuiet();
    assert.equal(open(w).length, 0);
    assert.match(w.pathOf("hotel-booking"), /^Paperwork\/To sort\//);
  } finally { await w.close(); }
});

test("\"hotel bookings go into Travel\": the next hotel booking goes there, though the plan files by sender", async () => {
  const second = { slug: "hotel-two", owner: "alex", content: "Wayfarer Trips. Booking confirmation WT-55900 for the Harbour Inn, Port Ellis, 1 to 2 December 2026. Guest Alex Morgan, 12 Elm Row, 40210 Fairford." };
  const answers = [{ match: ["WT-55900"], answer: { title: "Hotel booking Harbour Inn Port Ellis", correspondent: "Wayfarer Trips", document_type: null, tags: [], created: "2026-10-22", folder: "Travel", sender_folder: "Wayfarer Trips Ltd", kind: "hotel bookings", confident: true } }];
  const w = await kitWorld({ only: [], extra: [], tree: HOTEL_TREE, rules: [{ folder: "{sender}" }], answers });
  try {
    const r = await placeWith(w.context(), { kind: "hotel bookings", into: "Travel" });
    assert.match(r.text, /hotel bookings/);
    w.pl.addDoc({ id: 60, content: second.content, title: "Scan 2026-10-22 18-30-00", original_file_name: "Scan 2026-10-22 18-30-00.pdf", tags: [1], owner: 2, created: "2026-10-22", added: "2026-10-22T18:30:00+02:00" });
    w.ids["hotel-two"] = 60;
    await w.runUntilQuiet();
    const sorting = w.prompts.find((p) => p.prompt.includes("WT-55900"));
    assert.match(sorting.prompt, /hotel bookings/, "the AI is told the person's kinds of papers");
    assert.equal(folderOf(w, "hotel-two"), "Paperwork/Travel");
  } finally { await w.close(); }
});

test("one paper moved by name: \"the hotel booking goes into Travel\" moves the filed paper and learns its sender", async () => {
  const w = await hotelWorld();
  try {
    await w.runUntilQuiet();
    await answerWith(w.context(), { words: "1" });
    assert.equal(folderOf(w, "hotel-booking"), "Paperwork/Hotel Lindenhof");
    const r = await placeWith(w.context(), { paper: "the hotel booking", into: "Travel" });
    assert.match(r.text, /Paperwork\/Travel/);
    assert.equal(folderOf(w, "hotel-booking"), "Paperwork/Travel");
    assert.equal(w.fileOf("hotel-booking").length, 1, "moved, not copied");
    const plan = readJson(w.paths.plan);
    assert.deepEqual([plan.rules[0].sender, plan.rules[0].folder], ["Hotel Lindenhof", "Travel"]);
  } finally { await w.close(); }
});

test("with \"nobody sorts\" an answer files the paper and writes nothing into Paperless", async () => {
  const contract = { slug: "storage-contract", owner: "alex", content: "Westbrook Storage. Your storage unit contract, unit 14B, reference KEPT-CONTRACT-2, starts on 1 May 2025 for Alex Morgan.",
    presorted: { title: "Storage unit contract", correspondent: "Westbrook Storage", document_type: "Contract", tags: [], created: "2025-04-20" } };
  const tree = { Paperwork: { Storage: {}, Letters: {} } };
  const w = await kitWorld({ sorting: "nobody", only: [], extra: [contract], tree, rules: [{ type: "Letter", folder: "Letters" }], answers: [{ match: ["Pick the folder"], answer: { folder: null, confident: false } }] });
  try {
    await w.runUntilQuiet();
    const before = w.pl.snapshot();
    await answerWith(w.context(), { words: "Storage" });
    assert.equal(folderOf(w, "storage-contract"), "Paperwork/Storage");
    assert.deepEqual(w.pl.writes, []);
    assert.equal(w.pl.snapshot(), before);
    assert.equal(open(w).length, 0);
    const item = w.nb.rows("collection_items").find((i) => i.source_id === w.record("storage-contract").sum);
    assert.equal(item.data.status, "sorted");
  } finally { await w.close(); }
});

test("filing an answered paper at once leaves the last run's numbers as they were", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "utility-invoice"] });
  try {
    await w.runUntilQuiet();
    const before = readJson(w.paths.state).last_run;
    await answerWith(w.context(), { words: "1" });
    const after = readJson(w.paths.state).last_run;
    assert.equal(after.at, before.at);
    assert.equal(after.total, 2);
  } finally { await w.close(); }
});
