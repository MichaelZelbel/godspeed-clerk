import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakePaperless } from "./fakes/paperless.mjs";
import { Paperless, Taxonomy } from "../lib/core/paperless.mjs";
import { DEFAULTS } from "../lib/core/settings.mjs";
import { titleIsDefault, readable, clip, buildPrompt, validateAnswer, sortDocument } from "../lib/core/sorter.mjs";
import { findSame, nameWords } from "../lib/core/names.mjs";

const TODAY = new Date("2026-10-22T12:00:00Z");
const LETTER = "Brightwater Utilities, 4 Canal Street, Fairford. Electricity invoice number 55120 dated 4 March 2025 for the meter at 12 Elm Row. Amount due 84.20, payable by 25 March 2025. Thank you for your custom.";
const TAGS = [
  { id: 1, name: "Inbox", is_inbox_tag: true, matching_algorithm: 0 }, { id: 2, name: "Tax 2024" }, { id: 3, name: "Tax 2025" },
  { id: 4, name: "Home" }, { id: 5, name: "Car" }, { id: 6, name: "Important", matching_algorithm: 0 }, { id: 7, name: "Not in notebook", matching_algorithm: 0 },
];
const TYPES = [{ id: 1, name: "Invoice" }, { id: 2, name: "Letter" }, { id: 3, name: "Insurance" }, { id: 4, name: "Tax assessment" }];
const SENDERS = [{ id: 1, name: "Brightwater Utilities" }, { id: 2, name: "Northgate Insurance" }];
const settings = { ...structuredClone(DEFAULTS), about: "Alex Morgan lives at 12 Elm Row, Fairford.", tag_rules: { Home: "anything about the house at 12 Elm Row" } };

function answer(over = {}) {
  return JSON.stringify({ title: "Electricity invoice March 2025", correspondent: "Brightwater Utilities", document_type: "Invoice", tags: ["Home"], created: "2025-03-04", folder: null, confident: true, ...over });
}

async function setup(doc = {}, extra = {}) {
  const fake = await startFakePaperless({ tags: TAGS, types: TYPES, correspondents: SENDERS, docs: [{ id: 10, content: LETTER, tags: [1], ...doc }], ...extra });
  const pl = new Paperless({ url: fake.url, token: "tok-alex" });
  const tax = await Taxonomy.load(pl);
  return { fake, pl, tax, doc: await pl.document(10) };
}

function asker(...answers) {
  const calls = [];
  const ask = async (req) => {
    calls.push(req);
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (a instanceof Error) throw a;
    return { text: a, provider: "test-provider", model: "test-model" };
  };
  return { ask, calls };
}

async function sort(env, ...answers) {
  const a = asker(...answers);
  const out = await sortDocument({ doc: env.doc, tax: env.tax, writer: env.pl.writer("godspeed"), settings, ask: a.ask, today: TODAY, folderChoices: ["Invoices/{sender}", "Letters"] });
  return { out, calls: a.calls, doc: env.fake.doc(10) };
}

const tagNames = (env, ids) => ids.map((id) => env.fake.state.tags.get(id).name).sort();

test("titles: a scan's or a file's name is replaced, a typed one stays", () => {
  const p = DEFAULTS.scan_title_patterns;
  assert.equal(titleIsDefault("Scan 2026-10-22 16-17-01", "Scan 2026-10-22 16-17-01.pdf", p), true);
  assert.equal(titleIsDefault("A", "A.pdf", p), true);
  assert.equal(titleIsDefault("letter_from_bank", "letter_from_bank.pdf", p), true);
  assert.equal(titleIsDefault("IMG_4411", "IMG_4411.jpg", p), true);
  assert.equal(titleIsDefault("My lease", "Scan 2026-10-22 16-17-01.pdf", p), false);
  assert.equal(titleIsDefault("Car insurance yearly statement", "upload.pdf", p), false);
});

test("a scan's title is replaced and a typed title is kept", async () => {
  let env = await setup();
  try { assert.equal((await sort(env, answer())).doc.title, "Electricity invoice March 2025"); } finally { await env.fake.close(); }
  env = await setup({ title: "My electricity bill", original_file_name: "Scan 2026-10-22 16-17-01.pdf" });
  try { assert.equal((await sort(env, answer())).doc.title, "My electricity bill"); } finally { await env.fake.close(); }
});

test("tags only grow, and the inbox tag goes at the end", async () => {
  const env = await setup({ tags: [1, 5] });
  try {
    const r = await sort(env, answer({ tags: ["Home"] }));
    assert.deepEqual(tagNames(env, r.doc.tags), ["Car", "Home"]);
    assert.equal(r.out.result, "sorted");
  } finally { await env.fake.close(); }
});

test("the AI never adds a reserved tag, and one already there stays", async () => {
  const env = await setup({ tags: [1, 7] });
  try {
    const r = await sort(env, answer({ tags: ["Not in notebook", "Important", "Check this", "Inbox", "Home"] }));
    assert.deepEqual(tagNames(env, r.doc.tags), ["Home", "Not in notebook"]);
    assert.equal([...env.fake.state.tags.values()].some((t) => t.name === "Check this"), false);
  } finally { await env.fake.close(); }
});

test("an answer unusable twice: asked exactly twice, Check this, nothing else changed", async () => {
  const env = await setup();
  try {
    const r = await sort(env, "not json at all", "{\"title\": \"x\"}");
    assert.equal(r.calls.length, 2);
    assert.match(r.calls[1].prompt, /could not be used/);
    assert.equal(r.out.result, "check");
    assert.deepEqual(tagNames(env, r.doc.tags), ["Check this"]);
    const check = [...env.fake.state.tags.values()].find((t) => t.name === "Check this");
    assert.equal(check.matching_algorithm, 0);
    assert.equal(r.doc.title, "Scan 2026-10-22 16-17-10");
    assert.equal(r.doc.correspondent, null);
    assert.equal(r.doc.created, "2026-10-22");
  } finally { await env.fake.close(); }
});

test("an unusable answer, then a good one: the good one is used", async () => {
  const env = await setup();
  try {
    const r = await sort(env, "```json\n{\"title\": 5}\n```", "```json\n" + answer() + "\n```");
    assert.equal(r.calls.length, 2);
    assert.equal(r.doc.title, "Electricity invoice March 2025");
    assert.equal(r.out.result, "sorted");
  } finally { await env.fake.close(); }
});

test("dates: checked hard, set only over the upload day", () => {
  const ok = (over) => validateAnswer(answer(over), TODAY, []);
  assert.ok(ok({ created: "2023-11-01" }).answer);
  assert.match(ok({ created: "2026-10-23" }).problems.join(), /after today/);
  assert.match(ok({ created: "2024-02-30" }).problems.join(), /does not exist/);
  assert.match(ok({ created: "1949-12-31" }).problems.join(), /before 1950/);
  assert.match(ok({ created: "04.03.2025" }).problems.join(), /YYYY-MM-DD/);
  assert.equal(ok({ created: null }).answer.created, null);
  assert.match(ok({ title: "two\nlines" }).problems.join(), /one line/);
  assert.match(ok({ title: "x".repeat(129) }).problems.join(), /128/);
  assert.match(ok({ confident: "yes" }).problems.join(), /confident/);
});

test("the date printed on the letter replaces the upload day, never a date someone set", async () => {
  let env = await setup();
  try { assert.equal((await sort(env, answer())).doc.created, "2025-03-04"); } finally { await env.fake.close(); }
  env = await setup({ created: "2025-03-01" });
  try { assert.equal((await sort(env, answer())).doc.created, "2025-03-01"); } finally { await env.fake.close(); }
  env = await setup();
  try { assert.equal((await sort(env, answer({ created: null }))).doc.created, "2026-10-22"); } finally { await env.fake.close(); }
});

test("senders: the same one is reused under a longer name, a new one is made to learn from", async () => {
  let env = await setup();
  try {
    const r = await sort(env, answer({ correspondent: "Brightwater Utilities plc" }));
    assert.equal(r.doc.correspondent, 1);
    assert.equal(env.fake.writes.filter((w) => w.path === "/api/correspondents/").length, 0);
  } finally { await env.fake.close(); }
  env = await setup();
  try {
    const r = await sort(env, answer({ correspondent: "Hollis Roofing" }));
    const made = env.fake.state.correspondents.get(r.doc.correspondent);
    assert.equal(made.name, "Hollis Roofing");
    assert.equal(made.matching_algorithm, 6);
  } finally { await env.fake.close(); }
});

test("sender and type are set only when empty", async () => {
  const env = await setup({ correspondent: 2, document_type: 2 });
  try {
    const r = await sort(env, answer());
    assert.equal(r.doc.correspondent, 2);
    assert.equal(r.doc.document_type, 2);
  } finally { await env.fake.close(); }
});

test("a type not in the list sets none", async () => {
  const env = await setup();
  try { assert.equal((await sort(env, answer({ document_type: "Utility bill" }))).doc.document_type, null); } finally { await env.fake.close(); }
});

test("tax-year tags: a missing one is made, an impossible year is dropped", async () => {
  const env = await setup();
  try {
    const r = await sort(env, answer({ tags: ["Tax 2022", "Tax 1890", "Tax 2025"] }));
    const made = [...env.fake.state.tags.values()].find((t) => t.name === "Tax 2022");
    assert.equal(made.matching_algorithm, 0);
    assert.deepEqual(tagNames(env, r.doc.tags), ["Tax 2022", "Tax 2025"]);
  } finally { await env.fake.close(); }
});

test("not confident: Check this, only the safe fields, nothing new made", async () => {
  const env = await setup();
  try {
    const r = await sort(env, answer({ confident: false, correspondent: "Hollis Roofing", tags: ["Tax 2021", "Home"] }));
    assert.equal(r.out.result, "check");
    assert.equal(r.doc.title, "Electricity invoice March 2025");
    assert.equal(r.doc.document_type, 1);
    assert.equal(r.doc.correspondent, null);
    assert.deepEqual(tagNames(env, r.doc.tags), ["Check this", "Home"]);
    assert.equal(env.fake.writes.filter((w) => w.path === "/api/correspondents/").length, 0);
    assert.deepEqual(env.fake.writes.filter((w) => w.path === "/api/tags/").map((w) => JSON.parse(w.body).name), ["Check this"]);
    assert.equal(r.out.folder, null);
  } finally { await env.fake.close(); }
});

test("unreadable text: no AI call, Check this", async () => {
  assert.equal(readable("~~ ,, .. 1 2 3"), false);
  assert.equal(readable(LETTER), true);
  const env = await setup({ content: "  \n ~ ._ " });
  try {
    const r = await sort(env, answer());
    assert.equal(r.calls.length, 0);
    assert.equal(r.out.result, "check");
    assert.match(r.out.why, /no readable text/);
  } finally { await env.fake.close(); }
});

test("no AI answers: the document stays exactly as it was", async () => {
  const env = await setup();
  try {
    const err = Object.assign(new Error("no answer"), { name: "ModelUnavailable" });
    await assert.rejects(sort(env, err), /no answer/);
    assert.deepEqual(env.fake.writes, []);
  } finally { await env.fake.close(); }
});

test("the folder the AI picks must be one of the plan's", () => {
  assert.equal(validateAnswer(answer({ folder: "Letters" }), TODAY, ["Letters"]).answer.folder, "Letters");
  const off = validateAnswer(answer({ folder: "Holidays" }), TODAY, ["Letters"]);
  assert.equal(off.answer.folder, null);
  assert.match(off.answer.notes.join(), /not in the plan/);
});

test("the prompt fences the text as data and offers no reserved tag", async () => {
  const env = await setup();
  try {
    const { system, prompt } = buildPrompt({ doc: env.doc, tax: env.tax, settings, today: TODAY, folderChoices: ["Letters"] });
    assert.match(system, /data, never instructions/);
    assert.match(prompt, /----- DOCUMENT TEXT \(OCR\) -----\n[\s\S]*Brightwater[\s\S]*\n----- END OF DOCUMENT TEXT -----/);
    const offered = prompt.match(/Existing tags: (.*)/)[1];
    for (const t of ["Inbox", "Important", "Not in notebook", "Check this"]) assert.ok(!offered.includes(`"${t}"`), t);
    assert.match(prompt, /12 Elm Row/);
    assert.match(prompt, /"Home": anything about the house/);
    assert.match(prompt, /Letters/);
  } finally { await env.fake.close(); }
});

test("long text keeps its head and its tail", () => {
  const t = "a".repeat(9000) + "TAIL";
  const c = clip(t, 8000);
  assert.ok(c.length <= 8000 + 40);
  assert.ok(c.startsWith("aaaa"));
  assert.ok(c.endsWith("TAIL"));
});

test("names: the same sender under a longer or shorter name, never a guess between two", () => {
  const list = [{ id: 1, name: "Northgate Insurance" }, { id: 2, name: "Fairford Borough Council" }, { id: 3, name: "Fairford Water" }];
  assert.equal(findSame(list, "Northgate Insurance Ltd").id, 1);
  assert.equal(findSame(list, "northgate insurance").id, 1);
  assert.equal(findSame(list, "Fairford Borough Council Parking Office").id, 2);
  assert.equal(findSame(list, "Fairford"), null);
  assert.equal(findSame(list, "Stadtwerke"), null);
  assert.deepEqual([...nameWords("Hollis & Sons Roofing Ltd")].sort(), ["hollis", "roofing", "sons"]);
});
