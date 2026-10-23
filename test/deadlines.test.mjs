// Deadlines from letters (F15), the pure part: what the AI read is checked, and the dates are
// counted here, never by the AI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanRequests, addPeriod, letterDate, plan, keyOf, requestsRule } from "../lib/core/deadlines.mjs";
import { buildPrompt, validateAnswer } from "../lib/core/sorter.mjs";
import { summaryRequest, validateSummary } from "../lib/core/notes.mjs";
import { DEFAULTS } from "../lib/core/settings.mjs";

const TODAY = new Date("2026-10-22T12:00:00Z");
// Several requests of one letter, numbered in order, as an AI answer gives them.
const reqs = (...os) => cleanRequests(os.map((o) => ({ ask: "Pay the made-up invoice", ...o })));
const req = (o) => cleanRequests([{ ask: "Pay the made-up invoice", by: null, within: null, counted_from: null, from_date: null, vague: false, ...o }])[0];

test("periods: days, weeks, months to the month's end, years over a leap day", () => {
  assert.equal(addPeriod("2026-10-15", { n: 14, unit: "days" }), "2026-10-29");
  assert.equal(addPeriod("2026-12-24", { n: 10, unit: "days" }), "2027-01-03");
  assert.equal(addPeriod("2026-10-15", { n: 2, unit: "weeks" }), "2026-10-29");
  assert.equal(addPeriod("2026-10-15", { n: 1, unit: "months" }), "2026-11-15");
  assert.equal(addPeriod("2027-01-31", { n: 1, unit: "months" }), "2027-02-28", "never into March");
  assert.equal(addPeriod("2028-01-31", { n: 1, unit: "months" }), "2028-02-29");
  assert.equal(addPeriod("2026-08-31", { n: 3, unit: "months" }), "2026-11-30");
  assert.equal(addPeriod("2028-02-29", { n: 1, unit: "years" }), "2029-02-28");
  assert.equal(addPeriod("2026-10-15", { n: 1, unit: "years" }), "2027-10-15");
});

test("requests the AI got wrong are dropped, never guessed", () => {
  const got = cleanRequests([
    { ask: "Pay the invoice", by: "2026-11-20" },
    { ask: "Object to the notice", within: { amount: 1, unit: "month" }, counted_from: "receipt" },
    { ask: "", by: "2026-11-20" },                                   // says nothing
    { ask: "Send the form", by: "2026-02-30" },                      // a day that does not exist
    { ask: "Reply", within: { amount: 0, unit: "days" } },           // no period
    { ask: "Reply", within: { amount: 3, unit: "fortnights" } },     // a unit nobody counts in
    { ask: "Return the signed form", vague: true },
    { ask: "Call back" },                                            // no date and no period: vague
    "pay something",
  ]);
  assert.deepEqual(got.map((r) => [r.n, r.ask, r.by, r.within, r.from, r.vague]), [
    [1, "Pay the invoice", "2026-11-20", null, null, false],
    [2, "Object to the notice", null, { n: 1, unit: "months" }, "receipt", false],
    [3, "Return the signed form", null, null, null, true],
    [4, "Call back", null, null, null, true],
  ]);
  assert.deepEqual(cleanRequests("none"), []);
  assert.equal(cleanRequests(Array.from({ length: 20 }, (_, i) => ({ ask: `Request ${i}`, vague: true }))).length, 8);
  assert.equal(cleanRequests([{ ask: "x".repeat(400), vague: true }])[0].ask.length, 160);
  assert.equal(cleanRequests([{ ask: "Pay\nnow", vague: true }])[0].ask, "Pay now");
});

test("a written date is taken as written", () => {
  const [i] = plan([req({ by: "2026-11-20" })], "2026-10-12", TODAY);
  assert.deepEqual([i.kind, i.due, i.basis, i.check, i.passed], ["date", "2026-11-20", "written", false, false]);
});

test("a period from the document's date", () => {
  const [i] = plan([req({ within: { amount: 14, unit: "days" }, counted_from: "document" })], "2026-10-15", TODAY);
  assert.deepEqual([i.kind, i.due, i.basis, i.check], ["period", "2026-10-29", "letter", false]);
});

test("a period from another printed date", () => {
  const [i] = plan([req({ within: { amount: 2, unit: "weeks" }, counted_from: "date", from_date: "2026-11-03" })], "2026-10-15", TODAY);
  assert.deepEqual([i.kind, i.due, i.basis, i.check], ["period", "2026-11-17", "fixed", false]);
});

test("a period from receipt counts from the letter's date and is marked check", () => {
  const [i] = plan([req({ within: { amount: 1, unit: "months" }, counted_from: "receipt" })], "2026-10-09", TODAY);
  assert.deepEqual([i.kind, i.due, i.basis, i.check], ["period", "2026-11-09", "letter", true]);
  // A period that says nothing about where it starts is counted the same, careful way.
  const [j] = plan([req({ within: { amount: 1, unit: "months" } })], "2026-10-09", TODAY);
  assert.deepEqual([j.due, j.check], ["2026-11-09", true]);
});

test("the upload day is never the day a period counts from", () => {
  // A phone scan: Paperless's date is the upload day, and nobody read a date off the letter.
  assert.equal(letterDate({ date: "2026-10-22", uploadDay: "2026-10-22", dateRead: false, readCreated: null }), null);
  // The AI read another date off the letter: that one.
  assert.equal(letterDate({ date: "2026-10-22", uploadDay: "2026-10-22", dateRead: false, readCreated: "2026-10-09" }), "2026-10-09");
  // A letter dated the day it was scanned: only when the date was read off the letter.
  assert.equal(letterDate({ date: "2026-10-22", uploadDay: "2026-10-22", dateRead: true, readCreated: null }), "2026-10-22");
  assert.equal(letterDate({ date: "2026-10-22", uploadDay: "2026-10-22", dateRead: false, readCreated: "2026-10-22" }), "2026-10-22");
  // A date someone set in Paperless: that one, whatever the AI read.
  assert.equal(letterDate({ date: "2026-10-01", uploadDay: "2026-10-22", dateRead: false, readCreated: "2026-10-09" }), "2026-10-01");
  assert.equal(letterDate({ date: "", uploadDay: "2026-10-22", dateRead: false, readCreated: "2026-02-30" }), null);
});

test("no letter date: nodate; vague: no date; passed: never made", () => {
  const items = plan(reqs(
    { within: { amount: 2, unit: "weeks" }, counted_from: "receipt" },
    { within: { amount: 2, unit: "weeks" }, counted_from: "document" },
    { vague: true },
    { by: "2026-08-31" },
  ), null, TODAY);
  assert.deepEqual(items.map((i) => [i.n, i.kind, i.due, i.passed]), [[1, "nodate", null, false], [2, "nodate", null, false], [3, "vague", null, false], [4, "date", "2026-08-31", true]]);
});

test("a corrected letter date moves only what was counted from it", () => {
  const three = reqs({ by: "2026-11-20" }, { within: { amount: 1, unit: "months" }, counted_from: "receipt" }, { within: { amount: 2, unit: "weeks" }, counted_from: "date", from_date: "2026-11-03" });
  const first = plan(three, "2026-10-09", TODAY).map((i) => ({ ...i, made: true, made_due: i.due }));
  const again = plan(three, "2026-10-12", TODAY, first);
  assert.deepEqual(again.map((i) => i.due), ["2026-11-20", "2026-11-12", "2026-11-17"]);
  assert.deepEqual(again.map((i) => [i.made, i.made_due]), [[true, "2026-11-20"], [true, "2026-11-09"], [true, "2026-11-17"]], "what was made is remembered");
  // A made deadline whose date has passed meanwhile is not "passed": it exists in Godspeed.
  const later = plan(three, "2026-10-09", new Date("2026-12-01T12:00:00Z"), first);
  assert.deepEqual(later.map((i) => i.passed), [false, false, false]);
  // No letter date first; the person sets it later: then it is counted.
  const none = plan([three[1]], null, TODAY);
  assert.equal(none[0].kind, "nodate");
  assert.deepEqual(plan([three[1]], "2026-10-09", TODAY, none).map((i) => [i.kind, i.due]), [["period", "2026-11-09"]]);
});

test("the deadline's key: the document's mark and which request", () => {
  assert.equal(keyOf("5D41402ABC4B2A76B9719D911017C592AAAA", 2), "5d41402abc4b2a76b9719d911017c592#2");
});

test("the sorting request asks for the requests and never for a computed date", () => {
  const tax = { tags: new Map([[1, { id: 1, name: "Inbox", is_inbox_tag: true }]]), correspondents: new Map(), types: new Map(), inboxIds: () => [1], name: () => null, tag: () => null };
  const settings = structuredClone(DEFAULTS);
  const { system } = buildPrompt({ doc: { content: "A made-up letter", tags: [1] }, tax, settings, today: TODAY });
  assert.ok(system.includes(requestsRule(settings)));
  assert.match(system, /"requests"/);
  assert.match(system, /Never count a date yourself/);
  const ok = validateAnswer(JSON.stringify({ title: "A letter", correspondent: null, document_type: null, tags: [], created: "2026-10-12", confident: true,
    requests: [{ ask: "Pay the made-up invoice", by: "2026-11-20" }] }), TODAY);
  assert.deepEqual(ok.answer.requests.map((r) => [r.n, r.by]), [[1, "2026-11-20"]]);
  const none = validateAnswer(JSON.stringify({ title: "A letter", correspondent: null, document_type: null, tags: [], created: null, confident: true }), TODAY);
  assert.deepEqual(none.answer.requests, [], "no requests field: none, and never a reason to check");
});

test("the note's reading asks for the letter's date and its requests", () => {
  const { system } = summaryRequest({ content: "A made-up letter" }, DEFAULTS);
  assert.match(system, /"created"/);
  assert.match(system, /"requests"/);
  const v = validateSummary(JSON.stringify({ summary: "A made-up letter.", key_facts: [], created: "2026-10-09", requests: [{ ask: "Object", within: { amount: 1, unit: "months" }, counted_from: "receipt" }] }), TODAY);
  assert.equal(v.created, "2026-10-09");
  assert.equal(v.requests[0].from, "receipt");
  assert.equal(validateSummary(JSON.stringify({ summary: "x", key_facts: [], created: "2027-01-01" }), TODAY).created, null, "a date after today is no letter's date");
  assert.deepEqual(validateSummary(JSON.stringify({ summary: "", key_facts: [], created: null, requests: [] }), TODAY), { summary: null, facts: [], created: null, requests: [] }, "read, with nothing in it");
});
