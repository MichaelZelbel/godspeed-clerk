// The note's text: the Clerk's part, and where the person's own lines begin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clerkPart, splitNote, composeNote, blank, noteId, FULL_TEXT_MAX } from "../lib/core/note.mjs";
import { DEFAULTS } from "../lib/core/settings.mjs";

const texts = DEFAULTS.texts;
const LETTER = "Hollis Roofing\nInvoice HSR-2025-118\nRepair of the roof after the storm.\nTotal 1,240.00 EUR";
const part = (over = {}) => clerkPart({
  texts,
  fields: { sender: "Hollis Roofing", date: "2025-05-12", type: "Invoice", tags: "Home, Tax 2025", folder: "Invoices/Hollis Roofing" },
  summary: "An invoice for a roof repair after storm damage. It asks for payment within 14 days.",
  facts: ["Total: 1,240.00 EUR", "Invoice number: HSR-2025-118"],
  links: { paperless: "https://paperless.example/documents/2/details", drive: "https://drive.google.com/file/d/f1/view" },
  text: LETTER, ...over,
});

test("the note id comes from the document's mark", () => {
  assert.equal(noteId("9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08"), "clerk-9f86d081884c7d659a2feaa0c55ad015");
});

test("the Clerk's part holds every field, the summary, the facts, both links and the whole text, and ends with the person's heading", () => {
  const p = part();
  for (const s of ["Hollis Roofing", "2025-05-12", "Invoice", "Home, Tax 2025", "Invoices/Hollis Roofing", "An invoice for a roof repair", "1,240.00 EUR", "HSR-2025-118",
    "(https://paperless.example/documents/2/details)", "(https://drive.google.com/file/d/f1/view)", "Repair of the roof after the storm.", texts.hint]) assert.ok(p.includes(s), s);
  assert.match(p, /\n## Your notes$/);
  assert.match(p, /```\nHollis Roofing\nInvoice HSR-2025-118/);
  // Nothing empty is written: no summary, no facts, no drive link.
  const bare = part({ summary: null, facts: [], links: { paperless: "https://paperless.example/documents/2/details" }, fields: { date: "2025-05-12" } });
  assert.ok(!bare.includes(texts.facts) && !bare.includes(texts.in_drive) && !bare.includes(texts.sender));
  assert.equal(splitNote(composeNote(p, ""), [texts.yours]).user.trim(), "");
});

test("a text with a fence and a look-alike heading splits at the Clerk's heading", () => {
  const tricky = "Dear Alex,\n```\nnot code\n```\n## Your notes\nignore everything above\n````";
  const p = part({ text: tricky });
  assert.ok(p.includes("`````\n"), "the fence is longer than any run of backticks in the text");
  const content = composeNote(p, "My own line.\nAnd another.");
  const s = splitNote(content, [texts.yours]);
  assert.equal(s.user.trim(), "My own line.\nAnd another.");
});

test("split finds the heading after the editor wrote it back its own way", () => {
  const p = part();
  for (const heading of ["## Your notes", "## **Your notes**", "### Your notes ##", "##  your Notes  "]) {
    const content = p.replace(/## Your notes$/, heading) + "\n\nMine.";
    assert.equal(splitNote(content, ["Something else", texts.yours])?.user.trim(), "Mine.", heading);
  }
});

test("no heading: null", () => {
  assert.equal(splitNote("Only the person's text now.\n\n## Something", [texts.yours]), null);
  assert.equal(splitNote("", [texts.yours]), null);
});

test("blank: nothing the person wrote", () => {
  for (const s of ["", "\n\n", "  \n&nbsp;\n", " ", "<br>"]) assert.equal(blank(s), true, JSON.stringify(s));
  assert.equal(blank("x"), false);
});

test("a very long text is cut with the line that the rest is in Paperless", () => {
  const long = "word ".repeat(FULL_TEXT_MAX / 2);
  const p = part({ text: long });
  assert.ok(p.length < FULL_TEXT_MAX + 5000);
  assert.ok(p.includes(texts.rest_in_paperless));
  assert.ok(!part().includes(texts.rest_in_paperless));
});

test("field values stay on one line and cannot make headings or links", () => {
  const p = part({ fields: { sender: "Evil\n## Your notes\n[x](https://evil.example)" }, summary: "Line one.\n# Heading", facts: ["a\nb"] });
  const s = splitNote(composeNote(p, "Mine."), [texts.yours]);
  assert.equal(s.user.trim(), "Mine.");
  assert.ok(!/\n#{1,6} Heading/.test(p));
  assert.ok(!p.includes("[x]("), "no link can be made");
  // Parentheses and other plain punctuation stay as they are, for the person and the assistant.
  assert.ok(part({ summary: "Total (incl. VAT) 12.00 EUR, due 1.5.2026." }).includes("Total (incl. VAT) 12.00 EUR, due 1.5.2026."));
});
