// The text of one document's note (F10): the Clerk's part on top, the person's own notes below.
//
// THE CLERK'S PART is the document's fields, its two-sentence summary, its key facts, the links to
// Paperless and to the file in the drive, and its full text, and it ends with a heading of its own
// ("Your notes", in the person's language). Everything below that heading is the person's: the
// Clerk keeps it exactly as it is and only ever rewrites the part above it.
//
// The notebook's editor writes a note back through its own Markdown (an HTML comment would be
// lost there), so the boundary is a visible heading, found by its words. The full text sits in a
// fence longer than any run of backticks in it, and every value from Paperless or the AI is kept
// to one line with its markup escaped, so nothing in a letter can look like that heading, a link
// or a section of its own.
export const SOURCE = "godspeed-clerk";
export const FULL_TEXT_MAX = 200000;

export const noteId = (sum) => `clerk-${String(sum ?? "").toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 32)}`;

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const md = (s) => oneLine(s).replace(/([\\`*_[\]()<>#|~])/g, "\\$1");
// A paragraph must not start a list or a quote either.
const para = (s) => md(s).replace(/^(\d+)([.)])/, "$1\\$2").replace(/^([-+>])/, "\\$1");
const url = (u) => (/^https?:\/\/[^\s()<>]+$/.test(String(u || "")) ? String(u) : null);

export function fence(text) {
  const runs = String(text).match(/`+/g) || [];
  return "`".repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
}

export function clerkPart({ texts, fields = {}, summary = null, facts = [], links = {}, text = "" }) {
  const blocks = [];
  const list = ["sender", "date", "type", "tags", "folder"].filter((k) => oneLine(fields[k])).map((k) => `- **${md(texts[k])}:** ${md(fields[k])}`);
  if (list.length) blocks.push(list.join("\n"));
  if (oneLine(summary)) blocks.push(para(summary));
  const f = (facts || []).map(oneLine).filter(Boolean);
  if (f.length) blocks.push(`## ${md(texts.facts)}\n\n${f.map((x) => `- ${md(x)}`).join("\n")}`);
  const l = [["in_paperless", links.paperless], ["in_drive", links.drive]].filter(([, u]) => url(u)).map(([k, u]) => `- [${md(texts[k])}](${url(u)})`);
  if (l.length) blocks.push(`## ${md(texts.links)}\n\n${l.join("\n")}`);
  let body = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  const cut = body.length > FULL_TEXT_MAX;
  if (cut) body = body.slice(0, FULL_TEXT_MAX);
  if (body) {
    const fc = fence(body);
    blocks.push(`## ${md(texts.full_text)}\n\n${fc}\n${body}\n${fc}${cut ? `\n\n_${md(texts.rest_in_paperless)}_` : ""}`);
  }
  blocks.push(`---\n\n_${md(texts.hint)}_`);
  blocks.push(`## ${md(texts.yours)}`);
  return blocks.join("\n\n");
}

// The whole note: the Clerk's part, then the person's lines as they are.
export function composeNote(clerk, user) {
  const mine = String(user ?? "").replace(/^\s*\n/, "");
  return blank(mine) ? `${clerk}\n` : `${clerk}\n\n${mine}`;
}

const words = (s) => String(s ?? "").replace(/[\\*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// Where the person's lines begin: after the first heading outside a fence whose words are one of
// `headings`. { clerk, user } or null when there is no such heading.
export function splitNote(content, headings) {
  const want = new Set((headings || []).map(words).filter(Boolean));
  const lines = String(content ?? "").replace(/\r\n?/g, "\n").split("\n");
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (open) {
      if (f && f[1][0] === open[0] && f[1].length >= open.length && !f[2].trim()) open = null;
      continue;
    }
    if (f) { open = f[1]; continue; }
    const h = lines[i].match(/^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
    if (h && want.has(words(h[1]))) return { clerk: lines.slice(0, i + 1).join("\n"), user: lines.slice(i + 1).join("\n") };
  }
  return null;
}

// Nothing the person wrote: only empty lines, as the editor leaves them.
export const blank = (user) => !String(user ?? "").replace(/&nbsp;|<br\s*\/?>| |\\/gi, "").trim();

// What an AI answer may put in a note, kept to size: a summary of at most 600 characters on one
// line, and at most 12 key facts of one line and 200 characters each. Anything else is dropped.
export function cleanSummary(s) {
  if (typeof s !== "string") return null;
  const t = oneLine(s);
  if (!t) return null;
  if (t.length <= 600) return t;
  const cut = t.slice(0, 597), sp = cut.lastIndexOf(" ");
  return `${(sp > 300 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, "")}...`;
}

export function cleanFacts(a) {
  if (!Array.isArray(a)) return [];
  return a.filter((x) => typeof x === "string").map(oneLine).filter(Boolean).map((x) => x.slice(0, 200)).slice(0, 12);
}
