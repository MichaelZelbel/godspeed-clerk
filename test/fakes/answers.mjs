// Recorded AI answers: the first entry whose `match` strings all occur in the request, and that
// still has uses left (`times`), answers. Nothing matches: an unsure answer.
export const UNSURE = JSON.stringify({ title: "Unclear document", correspondent: null, document_type: null, tags: [], created: null, folder: null, confident: false });

// A sorting request is matched on the document's own text only, never on the lists around it
// (a sender made for one document appears in every later request's list of senders).
export function answerFor(answers, used, system, prompt) {
  const fenced = String(prompt).match(/----- DOCUMENT TEXT \(OCR\) -----\n([\s\S]*)\n----- END OF DOCUMENT TEXT -----/);
  // Case and spacing do not count: OCR may read two spaces as one.
  const squash = (s) => String(s).toLowerCase().replace(/\s+/g, " ");
  const all = squash(fenced ? fenced[1] : `${system}\n${prompt}`);
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    if (!(a.match || []).every((m) => all.includes(squash(m)))) continue;
    // `offered`: names that must be in the request's list of sender folders, as a real AI would see them.
    if (a.offered) {
      const line = String(prompt).match(/Sender folders: (.*)/);
      const list = line ? JSON.parse(line[1]) : [];
      if (!a.offered.every((o) => list.includes(o))) continue;
    }
    if (a.times !== undefined && (used[i] || 0) >= a.times) continue;
    used[i] = (used[i] || 0) + 1;
    return typeof a.answer === "string" ? a.answer : JSON.stringify(a.answer);
  }
  return UNSURE;
}
