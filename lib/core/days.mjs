// A date that is the upload day as a phone app saw it: that day, or the day before or after. A
// phone in another time zone than Paperless (a server on UTC, a person in Berlin scanning after
// midnight), or a scan Paperless reads just after midnight, gives the day next to it; the phone
// app puts that day as the document's date (PRD section 12), and it says nothing about the paper.
export function nearUploadDay(date, day) {
  const a = Date.parse(`${String(date || "").slice(0, 10)}T00:00:00Z`), b = Date.parse(`${String(day || "").slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 86400000;
}
