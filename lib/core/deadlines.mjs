// Deadlines from letters (F15), the part that decides: what the AI read in a letter is checked
// here, and the dates are counted here, never by the AI. A deadline set too late is the one mistake
// that costs money, so every rule leans to the earlier day:
//   - a date written in the letter is taken as written;
//   - a period ("within one month of this notice") is counted from the day the letter prints as its
//     start; when it starts on a day the letter does not print (receipt, delivery, notification),
//     from the letter's own printed date, which gives the earliest possible end, and it is marked
//     "check the date";
//   - the upload day is never a day a period counts from;
//   - a period before a printed date ("at the latest six weeks before the lease ends on 31
//     December") counts back from that date;
//   - a date written without a year is the next such day on or after the letter's own date;
//   - no printed date to count from, or a time limit the AI saw but could not give: no deadline,
//     the paper is to check and the person is asked;
//   - vague ("promptly", "as soon as possible"): no deadline and no message, the request goes into
//     the note's key facts;
//   - already passed when the letter is read: into the note, no deadline.
// What is made in Godspeed, and the person's changes there, are deadline-step.mjs's.

export const MAX_REQUESTS = 8;
export const MAX_ASK = 160;
const UNITS = { day: "days", days: "days", week: "weeks", weeks: "weeks", month: "months", months: "months", year: "years", years: "years" };
const FROM = ["document", "date", "receipt", "before"];

export const realDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s && s >= "1990-01-01" && s <= "2100-12-31";
const isoDay = (d) => (typeof d === "string" ? d.slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// The words of the sorting request and the note's reading that ask for a letter's requests. One
// text, so both ask the same.
export function requestsRule(settings) {
  const lang = settings.language || "English";
  return `- "requests": what the document asks the owner to do by a date or within a period, one entry per request, in the order they appear; [] when it asks nothing with a time limit. A date that is only information (a collection day, a service period, a debit the sender takes itself) is no request. Each entry:
  {"ask": in ${lang}, a few words saying what to do, specific enough to stand alone in a list of reminders ("Pay the Ashby Plumbing invoice of 180.00 EUR", "Object to the income tax assessment 2025"),
   "by": "YYYY-MM-DD" when the document writes the last day for it, exactly as written, else null; when it writes the day without a year ("by 15 January", "bis zum 03.12."), give any year and set "no_year": true,
   "no_year": true only when "by" was written without a year, else false,
   "within": {"amount": a whole number, "unit": "days", "weeks", "months" or "years"} when it gives a period instead ("within 14 days", "within one month"), else null,
   "counted_from": for a period, "document" when it runs from the document's own date ("of the invoice date", "of the date of this notice"), "date" when it runs from another date the document prints (that date in "from_date"), "before" when it must be done a period BEFORE a date ("at the latest six weeks before the lease ends", "spätestens drei Monate vor Ablauf"; the date it is before in "from_date", or null when the document does not print it), "receipt" when it runs from when the owner received it, its delivery, notification or announcement, or any day the document does not print; null without a period,
   "from_date": "YYYY-MM-DD" or null,
   "vague": true when it asks without any date or period ("promptly", "as soon as possible"), else false. A request with a time limit you cannot give as "by" or "within" is NOT vague: give it with both null and "vague": false, and the owner is asked.}
  Never count a date yourself: give what the document writes, and the program counts.`;
}

// What an AI answer may say about requests, checked hard: an entry that says nothing, a day that
// does not exist, a period nobody counts in, is dropped, never guessed. No date and no period is
// vague only when the AI says so; otherwise it is a time limit nobody could read, and the person
// is asked (23 October 2026: "confirm your new plan no later than 3 December" came back with no
// date and was filed as vague). At most MAX_REQUESTS, numbered in the order they came.
export function cleanRequests(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const ask = oneLine(r.ask).slice(0, MAX_ASK).trim();
    if (!ask) continue;
    let by = null, within = null;
    if (r.by !== null && r.by !== undefined && r.by !== "") { if (!realDay(r.by)) continue; by = r.by; }
    if (r.within !== null && r.within !== undefined) {
      const n = Number(r.within?.amount ?? r.within?.n), unit = UNITS[String(r.within?.unit || "").toLowerCase()];
      if (!Number.isInteger(n) || n < 1 || n > 3650 || !unit) continue;
      within = { n, unit };
    }
    const from = within && FROM.includes(r.counted_from ?? r.from) ? (r.counted_from ?? r.from) : null;
    const fromDate = within && realDay(r.from_date) ? r.from_date : null;
    out.push({ n: out.length + 1, ask, by, within, from, from_date: fromDate, vague: !by && !within && r.vague === true, ...(by && r.no_year === true ? { no_year: true } : {}) });
    if (out.length >= MAX_REQUESTS) break;
  }
  return out;
}

// A period added to a day: days and weeks as days; months to the same day number, or the month's
// last day when it has none (31 January plus one month is 28 or 29 February, never March); years
// as twelve months.
// `sign` -1 counts back: six weeks before 31 December is 19 November, three months before 31
// March is 31 December, one month before 31 March is the end of February.
export function addPeriod(day, { n, unit }, sign = 1) {
  const d = new Date(`${day}T00:00:00Z`);
  if (unit === "days" || unit === "weeks") { d.setUTCDate(d.getUTCDate() + sign * n * (unit === "weeks" ? 7 : 1)); return d.toISOString().slice(0, 10); }
  const months = sign * (unit === "years" ? n * 12 : n);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d.getUTCDate(), last));
  return t.toISOString().slice(0, 10);
}

// The letter's printed date, the day periods count from. Paperless's date, unless it is the upload
// day (what phone apps put there) and nobody read that day off the letter or set it since
// (`corrected`: Paperless's date changed after the Clerk first saw it); else the date the AI read
// off it; else none.
export function letterDate({ date, uploadDay, dateRead, readCreated, corrected = false }) {
  const read = realDay(readCreated) ? readCreated : null;
  if (realDay(date) && (date !== uploadDay || dateRead || corrected || read === date)) return date;
  return read;
}

// A day written without a year: the same day and month on or after `from` (the letter's date, or
// today). null for a day that is not in that year (29 February).
function nextOn(by, from) {
  const md = by.slice(5), y = Number(from.slice(0, 4));
  for (const year of [y, y + 1]) {
    const day = `${year}-${md}`;
    if (realDay(day) && day >= from) return day;
  }
  return null;
}

// Each request with its deadline counted. `old`: the items as they were (by n): what was made in
// Godspeed, and what the person was told, stays. An item not made is "passed" when its day is
// before today; one made is never "passed": it is in Godspeed, which says the rest.
export function plan(requests, letter, today, old = null) {
  const day = isoDay(today);
  const before = new Map((old || []).map((i) => [i.n, i]));
  return (requests || []).map((r) => {
    const base = { n: r.n, by: r.by ?? null, within: r.within ?? null, from: r.from ?? null, from_date: r.from_date ?? null, vague: !!r.vague, ...(r.no_year ? { no_year: true } : {}) };
    let kind, due = null, basis = null, check = false;
    if (base.vague) kind = "vague";
    else if (!base.by && !base.within) kind = "nodate";
    else if (base.by && base.no_year) { due = nextOn(base.by, letter || day); kind = due ? "date" : "nodate"; basis = due ? "written" : null; }
    else if (base.by) { kind = "date"; due = base.by; basis = "written"; }
    else if (base.from === "before") { if (base.from_date) { kind = "period"; due = addPeriod(base.from_date, base.within, -1); basis = "fixed"; } else kind = "nodate"; }
    else if (base.from === "date" && base.from_date) { kind = "period"; due = addPeriod(base.from_date, base.within); basis = "fixed"; }
    else if (!letter) kind = "nodate";
    else { kind = "period"; due = addPeriod(letter, base.within); basis = "letter"; check = base.from !== "document"; }
    const was = before.get(r.n) || {};
    const kept = Object.fromEntries(["made", "made_due", "touched", "told"].filter((k) => was[k] !== undefined).map((k) => [k, was[k]]));
    return { ...base, kind, due, basis, check, ...kept, passed: !kept.made && !!due && due < day };
  });
}

// The deadline's key in Godspeed: the document's mark (the start of the checksum Paperless keeps of
// the original, as the note's id) and which request in the letter it is.
export const keyOf = (sum, n) => `${String(sum ?? "").toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 32)}#${n}`;
