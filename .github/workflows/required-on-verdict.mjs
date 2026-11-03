#!/usr/bin/env node
// When Archon's review verdict lands on a pull request, the pull request's `required` check runs again.
//
// Archon publishes its verdict as a conversation comment (the marked comment its `publish-review`
// stamps), and a comment reruns no check by itself: the `required` run of the head commit may have
// failed for want of a review before the verdict was there. So for a marked comment from a login in
// .archon/sdlc/policy/maintainers.json on the default branch (the same logins the gate trusts), the
// failed jobs of the newest `required` run on the pull request's head are rerun, and the gate then
// reads the verdict itself. A run still going needs nothing: the gate reads the comments at its end.
// It decides nothing about the merge; required-gate.mjs does.
//
// Node 22, Node's own modules only. `--self-test` proves the decision from fixtures.
const API = "https://api.github.com";
const MARKER = "<!-- archon-review-report -->";

// The maintainer list, read as Archon reads it: logins, or { login, merge_queue } entries.
export function maintainerLogins(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("maintainers.json is not a JSON array");
  return new Set(
    parsed.map((entry) => {
      const login = typeof entry === "string" ? entry : entry && entry.login;
      if (typeof login !== "string" || login.trim() === "") throw new Error("maintainers.json has an entry with no login");
      return login.trim().toLowerCase();
    }),
  );
}

// What to do for one comment event: { act: false, why } or { act: true }.
export function decide(event, maintainers) {
  const comment = event.comment || {};
  if (!event.issue || !event.issue.pull_request) return { act: false, why: "the comment is not on a pull request" };
  if (String(comment.body ?? "").split(/\r?\n/)[0] !== MARKER) return { act: false, why: "the comment is not Archon's review verdict" };
  const login = String((comment.user && comment.user.login) || "").toLowerCase();
  if (!maintainers.has(login)) return { act: false, why: `${login || "nobody"} is not in .archon/sdlc/policy/maintainers.json on the default branch` };
  return { act: true };
}

// Which run to rerun: the newest `required` run of the head commit, when it finished without success.
export function pickRun(runs) {
  const newest = [...runs].sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))[0];
  if (!newest) return { rerun: null, why: "no required run on the head commit yet" };
  if (newest.status !== "completed") return { rerun: null, why: `required run ${newest.id} is still ${newest.status}; it reads the verdict at its end` };
  if (newest.conclusion === "success") return { rerun: null, why: `required run ${newest.id} passed already` };
  return { rerun: newest.id, why: `required run ${newest.id} ended ${newest.conclusion}` };
}

async function api(method, path, token, accept = "application/vnd.github+json") {
  const response = await fetch(`${API}${path}`, { method, headers: { accept, authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28", "user-agent": "godspeed-required-on-verdict" } });
  return response;
}

async function run() {
  const fs = await import("node:fs");
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const info = await (await api("GET", `/repos/${repo}`, token)).json();
  const listed = await api("GET", `/repos/${repo}/contents/.archon/sdlc/policy/maintainers.json?ref=${encodeURIComponent(info.default_branch)}`, token, "application/vnd.github.raw+json");
  const maintainers = listed.status === 404 ? new Set() : maintainerLogins(await listed.text());
  const d = decide(event, maintainers);
  if (!d.act) return console.log(`Nothing to rerun: ${d.why}.`);
  const pr = await (await api("GET", `/repos/${repo}/pulls/${event.issue.number}`, token)).json();
  const runs = await (await api("GET", `/repos/${repo}/actions/workflows/required.yml/runs?head_sha=${pr.head.sha}&per_page=50`, token)).json();
  const pick = pickRun((runs.workflow_runs || []).filter((r) => r.event === "pull_request" || r.event === "pull_request_review"));
  if (!pick.rerun) return console.log(`Nothing to rerun: ${pick.why}.`);
  const r = await api("POST", `/repos/${repo}/actions/runs/${pick.rerun}/rerun-failed-jobs`, token);
  if (!r.ok) throw new Error(`rerunning required run ${pick.rerun} answered ${r.status}: ${(await r.text()).slice(0, 300)}`);
  console.log(`Archon's verdict from ${event.comment.user.login} is on pull request ${event.issue.number}; ${pick.why}, so its failed jobs run again and the gate reads the verdict.`);
}

function selfTest() {
  const m = maintainerLogins('["MichaelZelbel", {"login": "godspeed-dev-builder[bot]", "merge_queue": "own-prs"}]');
  const ev = (body, login, pr = true) => ({ issue: { number: 7, ...(pr ? { pull_request: {} } : {}) }, comment: { body, user: { login } } });
  const verdict = `${MARKER}\nReviewed commit: \`abc1234\`\nVerdict: ready\n`;
  const cases = [
    ["a listed maintainer's verdict reruns", decide(ev(verdict, "godspeed-dev-builder[bot]"), m).act === true],
    ["logins compare case-blind", decide(ev(verdict, "michaelzelbel"), m).act === true],
    ["an outsider's marked comment reruns nothing", decide(ev(verdict, "stranger"), m).act === false],
    ["an ordinary comment reruns nothing", decide(ev("looks good", "MichaelZelbel"), m).act === false],
    ["the marker must be the first line", decide(ev(` ${verdict}`, "MichaelZelbel"), m).act === false],
    ["an issue's comment reruns nothing", decide(ev(verdict, "MichaelZelbel", false), m).act === false],
    ["a failed run is rerun", pickRun([{ id: 1, status: "completed", conclusion: "failure", created_at: "2026-01-01T00:00:00Z" }]).rerun === 1],
    ["only the newest run counts", pickRun([{ id: 1, status: "completed", conclusion: "failure", created_at: "2026-01-01T00:00:00Z" }, { id: 2, status: "completed", conclusion: "success", created_at: "2026-01-01T01:00:00Z" }]).rerun === null],
    ["a run still going is left to read the verdict itself", pickRun([{ id: 3, status: "in_progress", conclusion: null, created_at: "2026-01-01T00:00:00Z" }]).rerun === null],
    ["no run yet, nothing to rerun", pickRun([]).rerun === null],
  ];
  let failed = 0;
  for (const [name, ok] of cases) {
    console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
    if (!ok) failed += 1;
  }
  console.log(`required-on-verdict self-test: ${cases.length - failed} of ${cases.length} pass.`);
  return failed === 0;
}

if (process.argv.includes("--self-test")) process.exitCode = selfTest() ? 0 : 1;
else
  run().catch((error) => {
    console.log(`required-on-verdict: ${error.message}`);
    process.exitCode = 1;
  });
