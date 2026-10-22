#!/usr/bin/env node
// A stand-in for Godspeed's `godspeed-model`, for the tests. Same contract: `--check` describes the
// connection; otherwise one JSON request on standard input, one JSON answer on standard output.
//
//   GODSPEED_CLERK_FAKE_ANSWERS   a JSON file: [{ "match": ["text that must occur", ...], "answer": "..." or {...}, "times": n }]
//                                 the first entry whose match strings all occur in system+prompt
//                                 and that still has uses answers; uses are counted in <file>.used.json
//   GODSPEED_CLERK_FAKE_PROMPTS   a JSONL file every request is appended to (in the test's own folder)
//   GODSPEED_CLERK_FAKE_PROVIDER  the provider it claims to be (default test-provider)
//   GODSPEED_CLERK_FAKE_BACKUP    a backup provider it reports in --check
//   GODSPEED_CLERK_FAKE_FAIL=1    no answer at all (exit 1)
import fs from "node:fs";

const env = process.env;
const provider = env.GODSPEED_CLERK_FAKE_PROVIDER || "test-provider";

if (process.argv.includes("--check") || process.argv.includes("--describe")) {
  if (env.GODSPEED_CLERK_FAKE_UNCONFIGURED === "1") { console.log(JSON.stringify({ configured: false })); process.exit(0); }
  const out = { configured: true, provider, model: "test-model" };
  if (env.GODSPEED_CLERK_FAKE_BACKUP) out.backup = { provider: env.GODSPEED_CLERK_FAKE_BACKUP, model: "backup-model" };
  console.log(JSON.stringify(out));
  process.exit(0);
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
const req = JSON.parse(input);
if (env.GODSPEED_CLERK_FAKE_PROMPTS) fs.appendFileSync(env.GODSPEED_CLERK_FAKE_PROMPTS, JSON.stringify(req) + "\n");
if (env.GODSPEED_CLERK_FAKE_FAIL === "1") { console.error("the selected connection did not answer"); process.exit(1); }

const file = env.GODSPEED_CLERK_FAKE_ANSWERS;
const answers = file ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
const usedFile = file ? `${file}.used.json` : null;
const used = usedFile && fs.existsSync(usedFile) ? JSON.parse(fs.readFileSync(usedFile, "utf8")) : {};
const all = `${req.system}\n${req.prompt}`;
let text = JSON.stringify({ title: "Unclear document", correspondent: null, document_type: null, tags: [], created: null, folder: null, confident: false });
for (let i = 0; i < answers.length; i++) {
  const a = answers[i];
  if (!(a.match || []).every((m) => all.includes(m))) continue;
  if (a.times !== undefined && (used[i] || 0) >= a.times) continue;
  used[i] = (used[i] || 0) + 1;
  text = typeof a.answer === "string" ? a.answer : JSON.stringify(a.answer);
  break;
}
if (usedFile) fs.writeFileSync(usedFile, JSON.stringify(used));
console.log(JSON.stringify({ text, provider, model: "test-model" }));
