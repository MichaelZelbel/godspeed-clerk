#!/usr/bin/env node
// The decision of the `required` check: may this commit be merged into main?
//
// Two conditions, one plain line each:
//   1. Every other check run on the head commit passed. The latest run per check name counts;
//      runs named `required` (this gate itself) and runs that were `skipped` are left out; runs
//      still queued or in progress are waited for.
//   2. On a pull request, a review of the head commit, in one of two ways:
//      a. the latest review of the head commit from each login listed in the repository variable
//         REQUIRED_REVIEWERS is read: at least one of those latest reviews must be an approval, and
//         none of them may ask for changes. "Latest" means the latest review of any kind, so a later
//         comment leaves a login with no approval standing (the release step's own pull requests);
//      b. or Archon's review verdict, trusted exactly as Archon's merge queue trusts it (coleam00/Archon
//         v0.13.2, .archon/workflows/sdlc/.shared/merge.ts `trustedReview` and review-comment.ts
//         `readReviewStamp`): the one comment on the pull request whose first line is the marker
//         `<!-- archon-review-report -->` and whose author is a login listed in
//         .archon/sdlc/policy/maintainers.json on the default branch; two such comments count as none;
//         its stamp must say "Verdict: ready" for exactly the head commit. Nothing more is checked
//         than Archon checks (godspeed-dev process.md, section 12, says why).
//      A push to main or a manual run needs no review.
//
// Everything below the environment is a plain function over data, and the waiting takes its
// clock, its sleeping and its reading of the checks as arguments. That is what lets `--self-test`
// prove all the cases the ticket names from fixtures, with no network and no real waiting.
//
// This file lives in .github/workflows/ on purpose: only a key with GitHub's `workflows`
// permission may change files there, and builder keys do not have it.
//
// Node 22, Node's own modules only, no npm packages.
import { parseArgs } from "node:util";

const API = "https://api.github.com";
const GOOD = new Set(["success", "neutral"]);

// ---------------------------------------------------------------------------
// The checks on the head commit
// ---------------------------------------------------------------------------

// When a check run happened: a finished one counts from its end, an unfinished one from its start.
function when(run) {
  const ms = Date.parse(run.completed_at || run.started_at || "");
  return Number.isNaN(ms) ? 0 : ms;
}

// The runs that count: not this gate, not skipped, and only the newest run of each check name.
// Skipped runs go out before the newest-per-name step on purpose. On a pull_request_review event
// this workflow's own `suite` job is skipped, and the real `suite` result from the earlier run on
// the same commit is the one that must count.
export function latestPerName(runs) {
  const considered = runs
    .filter((run) => run.name !== "required")
    .filter((run) => run.conclusion !== "skipped");
  const newest = new Map();
  for (const run of considered) {
    const seen = newest.get(run.name);
    const newer =
      !seen ||
      when(run) > when(seen) ||
      (when(run) === when(seen) && Number(run.id) > Number(seen.id));
    if (newer) newest.set(run.name, run);
  }
  return [...newest.values()];
}

// good: concluded success or neutral. bad: concluded anything else. pending: not finished yet.
export function checksVerdict(runs) {
  const kept = latestPerName(runs);
  const pending = kept.filter((run) => run.status !== "completed");
  const finished = kept.filter((run) => run.status === "completed");
  return {
    kept,
    pending,
    good: finished.filter((run) => GOOD.has(run.conclusion)),
    bad: finished.filter((run) => !GOOD.has(run.conclusion)),
    done: pending.length === 0,
  };
}

// Reads the checks over and over until none of them is unfinished, or until the limit passes. A
// run still unfinished then is reported as such, and fails the gate. The clock, the sleeping and
// the reading all come in as arguments, so the self-test can drive this without waiting.
export async function waitForChecks({
  fetchRuns,
  sleep,
  now,
  intervalMs = 30_000,
  limitMs = 80 * 60_000,
  log = () => {},
}) {
  const start = now();
  for (;;) {
    const verdict = checksVerdict(await fetchRuns());
    const waitedMs = now() - start;
    if (verdict.done) return { ...verdict, timedOut: false, waitedMs };
    if (waitedMs >= limitMs) return { ...verdict, timedOut: true, waitedMs };
    const which = verdict.pending.map((run) => `${run.name} ${run.status}`).join(", ");
    log(
      `${verdict.pending.length} not finished yet (${which}): ` +
        `${Math.round(waitedMs / 60_000)} of ${Math.round(limitMs / 60_000)} minutes gone`,
    );
    await sleep(intervalMs);
  }
}

// ---------------------------------------------------------------------------
// The review
// ---------------------------------------------------------------------------

export function reviewerList(value) {
  return String(value || "")
    .split(",")
    .map((login) => login.trim())
    .filter((login) => login.length > 0);
}

// Passes when at least one listed login's latest review of this very commit approves it, and no
// listed login's latest review asks for changes. Every review of that commit counts towards
// "latest", whatever its state: a login who comments after approving has no approval standing any
// more, which is what the ticket's "the latest review from each login is considered" asks for.
export function reviewVerdict({
  reviews = [],
  headSha,
  requiredReviewers,
  needsReview,
  event = "",
}) {
  if (!needsReview) return { ok: true, line: `no review is required (${event})` };

  const listed = reviewerList(requiredReviewers);
  if (listed.length === 0) {
    return {
      ok: false,
      line: "no reviewer is configured (repository variable REQUIRED_REVIEWERS)",
    };
  }
  const wanted = new Map(listed.map((login) => [login.toLowerCase(), login]));

  // The latest review of the head commit from each listed login, of whatever kind.
  const latest = new Map();
  for (const item of reviews) {
    const login = String(item.user?.login || "").toLowerCase();
    if (!wanted.has(login)) continue;
    if (item.commit_id !== headSha) continue;
    const at = Date.parse(item.submitted_at || "") || 0;
    const seen = latest.get(login);
    const newer = !seen || at > seen.at || (at === seen.at && Number(item.id) > Number(seen.item.id));
    if (newer) latest.set(login, { at, item });
  }

  for (const [login, { item }] of latest) {
    if (item.state === "CHANGES_REQUESTED") {
      return { ok: false, line: `the review failed: ${wanted.get(login)} requested changes` };
    }
  }
  for (const [login, { item }] of latest) {
    if (item.state === "APPROVED") {
      return { ok: true, line: `the review passed: ${wanted.get(login)} approved ${headSha}` };
    }
  }
  const states = [...latest]
    .map(([login, { item }]) => `${wanted.get(login)} ${item.state}`)
    .join(", ");
  return {
    ok: false,
    line:
      `the review failed: no listed reviewer approved ${headSha} ` +
      `(REQUIRED_REVIEWERS: ${listed.join(", ")})` +
      (states ? `; latest: ${states}` : "; no listed reviewer reviewed this commit"),
  };
}

// ---------------------------------------------------------------------------
// Archon's review verdict: the same rule as Archon's merge queue, nothing added
// ---------------------------------------------------------------------------

export const REVIEW_MARKER = "<!-- archon-review-report -->";

// Archon's readReviewStamp: the marker on the first line, the reviewed commit on the second, the
// verdict on the third. Null when the body is not a review comment.
export function readReviewStamp(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  if (lines[0] !== REVIEW_MARKER) return null;
  const reviewed = /^Reviewed commit: `([0-9a-f]{7,64})`$/.exec(lines[1] ?? "")?.[1];
  if (reviewed === undefined) return null;
  const verdict = /^Verdict: (ready|not ready)$/.exec(lines[2] ?? "")?.[1];
  return { reviewed, ready: verdict === undefined ? null : verdict === "ready" };
}

// Archon's parseMaintainerList: a JSON array of logins, or of { login, merge_queue? } entries;
// anything else refuses (and so the gate fails, as Archon's queue does).
export function parseMaintainers(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(".archon/sdlc/policy/maintainers.json is not valid JSON");
  }
  const invalid = ".archon/sdlc/policy/maintainers.json must be a JSON array of forge logins or { \"login\", \"merge_queue\"? } entries";
  if (!Array.isArray(parsed)) throw new Error(invalid);
  return new Set(
    parsed.map((entry) => {
      if (typeof entry === "string" && entry.trim() !== "") return entry.trim().toLowerCase();
      const login = entry && typeof entry === "object" ? entry.login : undefined;
      const mergeQueue = entry && typeof entry === "object" ? entry.merge_queue : undefined;
      if (typeof login !== "string" || login.trim() === "" || !(mergeQueue === undefined || mergeQueue === "own-prs")) {
        throw new Error(invalid);
      }
      return login.trim().toLowerCase();
    }),
  );
}

// Archon's trustedReview, then its gate's two refusals: the verdict is not Ready, or it is for
// another commit. comments: [{ body, user: { login } }]; maintainers: a Set of lower-cased logins.
export function archonVerdict({ comments = [], maintainers = new Set(), headSha }) {
  const trusted = comments.filter((comment) => {
    const login = comment?.user?.login;
    return readReviewStamp(comment?.body) !== null && typeof login === "string" && login !== "" && maintainers.has(login.toLowerCase());
  });
  if (trusted.length === 0) return { ok: false, line: "Archon's review verdict: none (no marked comment from a login in .archon/sdlc/policy/maintainers.json)" };
  if (trusted.length > 1) return { ok: false, line: `Archon's review verdict: duplicate (${trusted.length} marked comments from listed logins, so none counts)` };
  const stamp = readReviewStamp(trusted[0].body);
  const by = trusted[0].user.login;
  if (stamp.ready === null) return { ok: false, line: `Archon's review verdict from ${by} is unstamped` };
  if (!stamp.ready) return { ok: false, line: `Archon's review verdict from ${by} is not ready` };
  if (stamp.reviewed !== headSha) return { ok: false, line: `Archon's review verdict from ${by} is for ${stamp.reviewed}, not ${headSha}` };
  return { ok: true, line: `the review passed: Archon's verdict from ${by} is ready for ${headSha}` };
}

// ---------------------------------------------------------------------------
// The two conditions together
// ---------------------------------------------------------------------------

// Only a pull request carries a review to look at. A push to main and a manual run need none.
export function needsReviewFor(event) {
  return event === "pull_request" || event === "pull_request_review";
}

export async function gate({
  event,
  headSha,
  requiredReviewers,
  fetchRuns,
  fetchReviews = async () => [],
  fetchComments = async () => [],
  fetchMaintainers = async () => new Set(),
  sleep,
  now,
  intervalMs = 30_000,
  limitMs = 80 * 60_000,
  log = () => {},
}) {
  const lines = [];

  const checks = await waitForChecks({ fetchRuns, sleep, now, intervalMs, limitMs, log });
  let checksOk;
  if (checks.bad.length > 0) {
    const worst = checks.bad[0];
    lines.push(
      `every other check on the head commit failed: ${worst.name} concluded ${worst.conclusion}`,
    );
    checksOk = false;
  } else if (checks.timedOut) {
    const slow = checks.pending[0];
    lines.push(
      `every other check on the head commit failed: ${slow.name} is still ${slow.status}` +
        ` after ${Math.round(limitMs / 60_000)} minutes`,
    );
    checksOk = false;
  } else {
    const names = checks.good.map((run) => run.name).sort();
    lines.push(
      `every other check on the head commit passed (${names.length}: ` +
        `${names.join(", ") || "none to wait for"})`,
    );
    checksOk = true;
  }

  const needsReview = needsReviewFor(event);
  const reviews = needsReview ? await fetchReviews() : [];
  let review = reviewVerdict({ reviews, headSha, requiredReviewers, needsReview, event });
  lines.push(review.line);
  // without an approval of the release App, Archon's verdict passes it instead, exactly as Archon's
  // merge queue would (which reads no GitHub review at all)
  if (needsReview && !review.ok) {
    let archon;
    try {
      archon = archonVerdict({ comments: await fetchComments(), maintainers: await fetchMaintainers(), headSha });
    } catch (error) {
      archon = { ok: false, line: `Archon's review verdict could not be read: ${error.message}` };
    }
    lines.push(archon.line);
    if (archon.ok) review = archon;
  }

  const pass = checksOk && review.ok;
  lines.push(`required: ${pass ? "PASS" : "FAIL"}`);
  return { pass, lines, checks, review };
}

// ---------------------------------------------------------------------------
// Reading github.com
// ---------------------------------------------------------------------------

async function getJson(url, token) {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "godspeed-required-gate",
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 400);
    throw new Error(`GET ${url} answered ${response.status}: ${body}`);
  }
  return response.json();
}

async function allPages(url, token, pick, maxPages = 20) {
  const out = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = pick(await getJson(`${url}&page=${page}`, token));
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The self-test: every case the ticket names, from fixtures, no network, no real waiting
// ---------------------------------------------------------------------------

function fakeClock() {
  let t = Date.parse("2026-10-25T09:00:00Z");
  let naps = 0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
      naps += 1;
    },
    naps: () => naps,
  };
}

// Answers with the given snapshots one after the other, then stays on the last one.
function snapshots(...shots) {
  let i = 0;
  return async () => shots[Math.min(i++, shots.length - 1)];
}

let nextId = 1;
function checkRun(name, status, conclusion, at) {
  return {
    id: nextId++,
    name,
    status,
    conclusion,
    started_at: at,
    completed_at: status === "completed" ? at : null,
  };
}
function reviewOf(login, state, commitId, at) {
  return { id: nextId++, user: { login }, state, commit_id: commitId, submitted_at: at };
}

const SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
const OLDER_SHA = "0000111122223333444455556666777788889999";
const BOT = "some-app[bot]";
const BUILDER = "godspeed-dev-builder[bot]";

const T1 = "2026-10-25T08:00:00Z";
const T2 = "2026-10-25T08:10:00Z";
const T3 = "2026-10-25T08:20:00Z";

// A green pull request with an approval from the one listed reviewer. Each case changes one thing.
function pullRequest(changed) {
  return {
    event: "pull_request",
    headSha: SHA,
    requiredReviewers: BOT,
    fetchRuns: snapshots([checkRun("suite", "completed", "success", T1)]),
    fetchReviews: async () => [reviewOf(BOT, "APPROVED", SHA, T2)],
    ...changed,
  };
}

const CASES = [
  {
    name: "all green and approved passes",
    want: true,
    says: `the review passed: ${BOT} approved ${SHA}`,
    args: () =>
      pullRequest({
        fetchRuns: snapshots([
          checkRun("suite", "completed", "success", T1),
          checkRun("docker", "completed", "neutral", T1),
          checkRun("required", "completed", "failure", T1),
        ]),
      }),
  },
  {
    name: "a failed other check fails",
    want: false,
    says: "every other check on the head commit failed: docker concluded failure",
    args: () =>
      pullRequest({
        fetchRuns: snapshots([
          checkRun("suite", "completed", "success", T1),
          checkRun("docker", "completed", "failure", T1),
        ]),
      }),
  },
  {
    name: "a check in progress that later turns green passes",
    want: true,
    says: "every other check on the head commit passed (2: docker, suite)",
    args: () =>
      pullRequest({
        fetchRuns: snapshots(
          [
            checkRun("suite", "completed", "success", T1),
            checkRun("docker", "queued", null, T1),
          ],
          [
            checkRun("suite", "completed", "success", T1),
            checkRun("docker", "in_progress", null, T1),
          ],
          [
            checkRun("suite", "completed", "success", T1),
            checkRun("docker", "completed", "success", T2),
          ],
        ),
      }),
    also: (clock) => (clock.naps() === 2 ? "" : `it polled ${clock.naps()} times, not 2`),
  },
  {
    name: "a check still running at the time limit fails",
    want: false,
    says:
      "every other check on the head commit failed: docker is still in_progress after 80 minutes",
    args: () => pullRequest({ fetchRuns: snapshots([checkRun("docker", "in_progress", null, T1)]) }),
    also: (clock) =>
      clock.naps() === 160 ? "" : `it polled ${clock.naps()} times in 80 minutes, not 160`,
  },
  {
    name: "an approval on an older commit fails",
    want: false,
    says: `the review failed: no listed reviewer approved ${SHA}`,
    args: () => pullRequest({ fetchReviews: async () => [reviewOf(BOT, "APPROVED", OLDER_SHA, T2)] }),
  },
  {
    name: "changes requested after an approval fails",
    want: false,
    says: `the review failed: ${BOT} requested changes`,
    args: () =>
      pullRequest({
        fetchReviews: async () => [
          reviewOf(BOT, "APPROVED", SHA, T1),
          reviewOf(BOT, "CHANGES_REQUESTED", SHA, T3),
        ],
      }),
  },
  {
    // The ticket: "the latest review from each login is considered". A comment is a review, so
    // after it the login has no approval standing any more.
    name: "a comment after an approval fails: the latest review is no longer the approval",
    want: false,
    says: `the review failed: no listed reviewer approved ${SHA} ` +
      `(REQUIRED_REVIEWERS: ${BOT}); latest: ${BOT} COMMENTED`,
    args: () =>
      pullRequest({
        fetchReviews: async () => [
          reviewOf(BOT, "APPROVED", SHA, T1),
          reviewOf(BOT, "COMMENTED", SHA, T3),
        ],
      }),
  },
  {
    name: "an approval after a comment passes",
    want: true,
    says: `the review passed: ${BOT} approved ${SHA}`,
    args: () =>
      pullRequest({
        fetchReviews: async () => [
          reviewOf(BOT, "COMMENTED", SHA, T1),
          reviewOf(BOT, "APPROVED", SHA, T3),
        ],
      }),
  },
  {
    name: "one login's comment does not spend another login's approval",
    want: true,
    says: "the review passed: second-app[bot] approved",
    args: () =>
      pullRequest({
        requiredReviewers: `${BOT}, second-app[bot]`,
        fetchReviews: async () => [
          reviewOf(BOT, "APPROVED", SHA, T1),
          reviewOf(BOT, "COMMENTED", SHA, T3),
          reviewOf("second-app[bot]", "APPROVED", SHA, T2),
        ],
      }),
  },
  {
    name: "an approval from a login not in the list fails",
    want: false,
    says: `the review failed: no listed reviewer approved ${SHA} (REQUIRED_REVIEWERS: ${BOT})`,
    args: () =>
      pullRequest({ fetchReviews: async () => [reviewOf("someone-else", "APPROVED", SHA, T2)] }),
  },
  {
    name: "no reviewer configured fails",
    want: false,
    says: "no reviewer is configured (repository variable REQUIRED_REVIEWERS)",
    args: () => pullRequest({ requiredReviewers: " , " }),
  },
  {
    name: "a push to main with no review passes",
    want: true,
    says: "no review is required (push)",
    args: () =>
      pullRequest({
        event: "push",
        requiredReviewers: "",
        fetchReviews: async () => {
          throw new Error("a push must not read reviews");
        },
      }),
  },
  {
    name: "a skipped check is ignored",
    want: true,
    says: "every other check on the head commit passed (1: suite)",
    args: () =>
      pullRequest({
        fetchRuns: snapshots([
          checkRun("suite", "completed", "success", T1),
          checkRun("installers", "completed", "skipped", T2),
          checkRun("suite", "completed", "skipped", T3),
        ]),
      }),
  },
  {
    name: "only the latest run per check name counts",
    want: true,
    says: "every other check on the head commit passed (1: docker)",
    args: () =>
      pullRequest({
        fetchRuns: snapshots([
          checkRun("docker", "completed", "failure", T1),
          checkRun("docker", "completed", "success", T2),
        ]),
      }),
  },
  {
    name: "and the other way round: a newer failure beats an older success",
    want: false,
    says: "every other check on the head commit failed: docker concluded failure",
    args: () =>
      pullRequest({
        fetchRuns: snapshots([
          checkRun("docker", "completed", "success", T1),
          checkRun("docker", "completed", "failure", T2),
        ]),
      }),
  },
  // Archon's review verdict: the same rule as Archon's merge queue
  {
    name: "Archon's verdict, ready at the head, from a listed maintainer, passes without an approval",
    want: true,
    says: `the review passed: Archon's verdict from ${BUILDER} is ready for ${SHA}`,
    args: () => archon({ fetchComments: async () => [marked(BUILDER, SHA, "ready")] }),
  },
  {
    name: "Archon's verdict not ready fails",
    want: false,
    says: `Archon's review verdict from ${BUILDER} is not ready`,
    args: () => archon({ fetchComments: async () => [marked(BUILDER, SHA, "not ready")] }),
  },
  {
    name: "Archon's verdict for another commit fails",
    want: false,
    says: `Archon's review verdict from ${BUILDER} is for ${OLDER_SHA}, not ${SHA}`,
    args: () => archon({ fetchComments: async () => [marked(BUILDER, OLDER_SHA, "ready")] }),
  },
  {
    name: "a marked comment from a login not in maintainers.json is ignored",
    want: false,
    says: "Archon's review verdict: none",
    args: () => archon({ fetchComments: async () => [marked("someone-else", SHA, "ready")] }),
  },
  {
    name: "two marked comments from listed logins count as none",
    want: false,
    says: "Archon's review verdict: duplicate (2 marked comments",
    args: () => archon({ fetchComments: async () => [marked(BUILDER, SHA, "ready"), marked("MichaelZelbel", SHA, "ready")] }),
  },
  {
    name: "an outsider's marked comment beside the listed one changes nothing",
    want: true,
    says: `the review passed: Archon's verdict from ${BUILDER} is ready for ${SHA}`,
    args: () => archon({ fetchComments: async () => [marked("stranger", OLDER_SHA, "not ready"), marked(BUILDER, SHA, "ready")] }),
  },
  {
    name: "a comment whose first line is not exactly the marker is no verdict",
    want: false,
    says: "Archon's review verdict: none",
    args: () => archon({ fetchComments: async () => [{ id: nextId++, user: { login: BUILDER }, body: ` ${marked(BUILDER, SHA, "ready").body}` }] }),
  },
  {
    name: "a verdict without its stamp is unstamped and fails",
    want: false,
    says: `Archon's review verdict from ${BUILDER} is unstamped`,
    args: () => archon({ fetchComments: async () => [{ id: nextId++, user: { login: BUILDER }, body: `<!-- archon-review-report -->\nReviewed commit: \`${SHA}\`\n\nreport` }] }),
  },
  {
    name: "with no maintainers.json nobody's verdict counts",
    want: false,
    says: "Archon's review verdict: none",
    args: () => archon({ fetchMaintainers: async () => new Set(), fetchComments: async () => [marked(BUILDER, SHA, "ready")] }),
  },
  {
    name: "a maintainers.json in the wrong shape fails the gate",
    want: false,
    says: "Archon's review verdict could not be read: .archon/sdlc/policy/maintainers.json must be a JSON array",
    args: () => archon({ fetchMaintainers: async () => parseMaintainers('{"login":"x"}'), fetchComments: async () => [marked(BUILDER, SHA, "ready")] }),
  },
  {
    name: "Archon's verdict passes even beside a listed reviewer's request for changes, as Archon's gate reads no GitHub review",
    want: true,
    says: `the review passed: Archon's verdict from ${BUILDER} is ready for ${SHA}`,
    args: () => archon({ fetchReviews: async () => [reviewOf(BOT, "CHANGES_REQUESTED", SHA, T2)], fetchComments: async () => [marked(BUILDER, SHA, "ready")] }),
  },
  {
    name: "Archon's verdict also needs every other check green",
    want: false,
    says: "every other check on the head commit failed: suite concluded failure",
    args: () => archon({ fetchRuns: snapshots([checkRun("suite", "completed", "failure", T1)]), fetchComments: async () => [marked(BUILDER, SHA, "ready")] }),
  },
  {
    name: "the maintainer list reads logins and { login, merge_queue } entries, case-blind",
    want: true,
    says: `the review passed: Archon's verdict from ${BUILDER} is ready for ${SHA}`,
    args: () => archon({ fetchMaintainers: async () => parseMaintainers('["MichaelZelbel", { "login": "Godspeed-Dev-Builder[bot]", "merge_queue": "own-prs" }]'), fetchComments: async () => [marked(BUILDER, SHA, "ready")] }),
  },
];

// A pull request with no approval of the release App, where Archon's verdict decides.
function marked(login, sha, verdict) {
  return { id: nextId++, user: { login }, body: `<!-- archon-review-report -->\nReviewed commit: \`${sha}\`\nVerdict: ${verdict}\nContract: complete\n\nThe report.` };
}
function archon(changed) {
  return pullRequest({
    fetchReviews: async () => [],
    fetchMaintainers: async () => parseMaintainers(JSON.stringify(["MichaelZelbel", BUILDER])),
    ...changed,
  });
}

async function selfTest() {
  let passed = 0;
  for (const test of CASES) {
    const clock = fakeClock();
    let problem = "";
    try {
      const result = await gate({ ...test.args(), now: clock.now, sleep: clock.sleep });
      if (result.pass !== test.want) {
        problem =
          `it said ${result.pass ? "PASS" : "FAIL"}, not ${test.want ? "PASS" : "FAIL"}` +
          `: ${result.lines.join(" | ")}`;
      } else if (!result.lines.join("\n").includes(test.says)) {
        problem = `it never said "${test.says}"; it said: ${result.lines.join(" | ")}`;
      } else if (test.also) {
        problem = test.also(clock);
      }
    } catch (error) {
      problem = `it threw: ${error.message}`;
    }
    if (problem) {
      console.log(`  FAIL ${test.name}: ${problem}`);
    } else {
      passed += 1;
      console.log(`  ok   ${test.name}`);
    }
  }
  console.log(`required-gate self-test: ${passed} of ${CASES.length} pass.`);
  return passed === CASES.length;
}

// ---------------------------------------------------------------------------
// Running it for real
// ---------------------------------------------------------------------------

async function decide() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const event = process.env.GITHUB_EVENT_NAME || "";
  const headSha = process.env.HEAD_SHA;
  const prNumber = process.env.PR_NUMBER;
  if (!token || !repo || !headSha) {
    console.log("required: FAIL: GITHUB_TOKEN, GITHUB_REPOSITORY and HEAD_SHA must all be set");
    return false;
  }
  console.log(`the head commit is ${headSha} (${event || "no event"} in ${repo})`);

  const fetchRuns = () =>
    allPages(
      `${API}/repos/${repo}/commits/${headSha}/check-runs?filter=all&per_page=100`,
      token,
      (body) => body.check_runs || [],
    );
  const fetchReviews = () =>
    prNumber
      ? allPages(`${API}/repos/${repo}/pulls/${prNumber}/reviews?per_page=100`, token, (body) =>
          Array.isArray(body) ? body : [],
        )
      : Promise.resolve([]);

  // the pull request's conversation comments, where Archon publishes its verdict
  const fetchComments = () =>
    prNumber
      ? allPages(`${API}/repos/${repo}/issues/${prNumber}/comments?per_page=100`, token, (body) =>
          Array.isArray(body) ? body : [],
          Infinity, // every comment, as Archon reads them: until a short page
        )
      : Promise.resolve([]);
  // Archon's maintainer list at the head of the default branch (never the pull request's own copy):
  // no file means nobody
  const fetchMaintainers = async () => {
    const { default_branch: branch } = await getJson(`${API}/repos/${repo}`, token);
    const response = await fetch(
      `${API}/repos/${repo}/contents/.archon/sdlc/policy/maintainers.json?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          accept: "application/vnd.github.raw+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "godspeed-required-gate",
        },
      },
    );
    if (response.status === 404) return new Set();
    if (!response.ok) throw new Error(`maintainers.json on ${branch} answered ${response.status}`);
    return parseMaintainers(await response.text());
  };

  const { pass, lines } = await gate({
    event,
    headSha,
    requiredReviewers: process.env.REQUIRED_REVIEWERS,
    fetchRuns,
    fetchReviews,
    fetchComments,
    fetchMaintainers,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    now: () => Date.now(),
    log: (message) => console.log(message),
  });
  for (const line of lines) console.log(line);
  return pass;
}

const { values } = parseArgs({
  options: { "self-test": { type: "boolean", default: false } },
  allowPositionals: true,
  strict: false,
});
process.exitCode = (values["self-test"] ? await selfTest() : await decide()) ? 0 : 1;
