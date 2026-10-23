# The Clerk, batch 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A letter that asks the person to do something by a date becomes a Godspeed deadline, which Godspeed's own reminders bring up as the date comes; a period counted from a day the letter does not print gives the earliest possible date and reaches the person as "check the date"; the paper is tagged "Important" until the date has passed.

**Architecture:** Two parts. (A) In the Godspeed product: add-on deadlines are ordinary deadline files in `due/` (the files every reminder already reads), carrying the add-on's name, its own key and a fingerprint of what the add-on wrote; `tools/due.js` learns `add --addon --addon-key` and `addon-update`, and the notebook answers `POST /api/functions/addon-deadlines` (`list`, `create`, `update`) on its local door. (B) In the Clerk: the AI reads each letter's requests once (in the sorting answer, or in the note's reading), the Clerk counts the dates itself, writes them into the note, the item and Godspeed, keeps "Important" while a date is ahead, and puts "check the date" and "no date to count from" into the one message per run.

**Tech Stack:** Product: Node 22, CommonJS `tools/due.js`, ES modules in `notebook/core`, `node --test` and `tools/test-due.sh`. Clerk: Node 22, Node's own modules only, `node --test`; full test with Paperless-ngx 3.3.3 in Docker and a real notebook from a product checkout.

**Spec:** `docs/proposals/paperless-addon.md` in MichaelZelbel/godspeed-mission-control (main, `7c10d4af` for the PRD text): F15 whole, F16 and F17 where F15 touches them, F11's deadline sentence, F18 for deadlines.

## Global Constraints

- F15 rules, verbatim in substance: several requests with dates in one letter are several deadlines named by what they ask; a printed date is taken as written; a period counts from the start day the letter prints; when the start is a day it does not print (receipt, delivery, notification) it counts from the letter's printed date, gives the earliest possible end and is marked "check the date"; the upload day is never the day of receipt; no usable date: no deadline, "Check this" and a message asking for the date; vague wording: no deadline, no message, the request in the note's key facts; already passed: into the note, no deadline; each request creates its deadline once (the deadline carries the document's mark and the request); a deadline the person changed or closed is never touched again; a corrected letter date moves a deadline counted from it only while the person has not touched it; "Important" only when Godspeed sorts, until the date has passed.
- F11: a deadline from a "Not in notebook" document is named only by the document's title and date.
- Product: one mechanism for every deadline (`due/` files read by `mc-due`, the deadline reminders and the morning brief); usable by any add-on; documented in `docs/full-version/addon-model.md`; no em or en dashes in anything a person reads; made-up examples only.
- Clerk: AI only through `godspeed-model`; the AI never computes a date, the code does; records hold numbers, dates, marks and flags, never a request's words (F14); in "Paperless sorts" and "nobody sorts" not one write reaches Paperless (no "Important", no "Check this"); every word a person reads is a `texts.*` setting with an English default.
- Never weaken an F test. A PRD test that looks wrong is reported, not changed.

## Review Focus

1. The person moves a deadline's date (by hand in `due/<slug>.md`, or a target through Settings), then the letter is read again, the records are lost, or its date is corrected in Paperless: the person's date stays and no second deadline appears. Tests: product `an add-on deadline the person changed or closed is never changed by the add-on`; Clerk `F15: after the person moves a deadline's date, a run that reads the letter again leaves the person's date`.
2. A crash between Godspeed making the deadline and the Clerk recording it: the next run finds it by its key, never a second one. Tests: product `create twice with one key makes one deadline`; Clerk `F18: killed after the deadline was made, the next run makes no second one` and the full test's `after-deadline` kill.
3. A Godspeed too old for add-on deadlines (no `addon-deadlines` function): the Clerk files and notes as before, makes no deadline, says it once, and makes them after Godspeed is updated. Test: Clerk `a Godspeed without add-on deadlines: one message, and the deadlines come after the update`.
4. A letter dated the day it was scanned, and a phone scan whose Paperless date is the upload day: the upload day is used only when the AI read that same date off the letter. Test: Clerk `the upload day is never the day a period counts from`.
5. Month ends and leap days ("within one month" of 31 January, of 29 February): the period ends on the last day of the shorter month, never in the month after. Test: Clerk `periods: days, weeks, months to the month's end, years over a leap day`.

---

## Part A: the product (MichaelZelbel/godspeed-mission-control)

### Task A1: `tools/due.js` keeps add-on deadlines

**Files:** Modify `tools/due.js`; Test `tools/test-due.sh` (new section "add-on deadlines").

**Interfaces (Produces):**
- `mc-due add <slug> ... --addon <name> --addon-key <key>`: name `^[a-z0-9][a-z0-9-]{0,39}$`, key `^[A-Za-z0-9][A-Za-z0-9._:#/-]{0,119}$`. Writes head lines `ADDON`, `ADDON-KEY`, `ADDON-STATE` (fingerprint), `SOURCE: <name>, <day>`. When a file with the same `ADDON` and `ADDON-KEY` exists: prints `Kept <slug>: <name> made it before.`, exit 0, writes nothing.
- `mc-due addon-update <slug> --addon <name> [--to YYYY-MM-DD] [--title "..."]`: only on that add-on's file; exit 4 and `Left as it is: ... changed or closed by you.` when touched; otherwise changes the last day (and the first day when it would be after it) and/or the title, logs `moved by <name>` / `renamed by <name>`, writes a new `ADDON-STATE`.
- touched = dropped, or a window no longer open (closed by an event), or the fingerprint `sha256(JSON [TITLE, every window's from, to, target, moved]).slice(0,16)` differs from `ADDON-STATE`. Computed from parsed values, so the engine's `mc-due` rewriting the file (other heading, log lines) is not a change.
- `stateRows()` rows of add-on files carry `addon: { name, key, touched, due, from, link }` (due and from from the first window, also once closed).

- [ ] Tests in `test-due.sh`: add with `--addon` writes the three lines and `SOURCE`; the same key again keeps the first and makes no second file; `addon-update --to` moves an untouched one and logs it; after the person edits the STRIP line, after `done`, after `drop`, after `target`, after a hand edit of the title: exit 4, file unchanged; another add-on's name: refused; a `## Strips` heading and SAID lines written by another reader leave it untouched; `state --json` shows `addon.touched`.
- [ ] Run `bash tools/test-due.sh`, see them fail; implement; pass; commit.

### Task A2: the notebook's `addon-deadlines` function

**Files:** Create `notebook/core/addon-deadlines.mjs`; Modify `notebook/core/domains.mjs` (one line in `invoke`); Test `notebook/test/addon-deadlines.test.mjs`.

**Interfaces:**
- Consumes: A1's options and `stateRows().addon`.
- Produces: `addonDeadlines(store, input)`; `POST /api/functions/addon-deadlines` answers `{data}`:
  - `{addon, action:"list"}` -> `{deadlines:[{key, slug, title, due, start, state, touched, closed_on, link}]}` (`state`: open, unopened, closed, dropped, needs-a-look);
  - `{addon, action:"create", key, title, due, done_when, cost, link?, start?}` -> `{created: true|false, deadline}`; `due` and `start` YYYY-MM-DD, `title` one line (300), `done_when` and `cost` one line (1000), `link` an http(s) address; the slug from the title, a number when taken, like Settings' deadlines;
  - `{addon, action:"update", key, due?, title?}` -> `{updated: true}` or `{updated: false, touched: true}`; unknown key: error "No deadline of this add-on has that key".
  - Errors are plain sentences (HTTP 400). Runs under the workspace lock, dates on the installation's clock.
- [ ] Tests: `an add-on deadline is a due file the reminders read` (create, then `remind()` on the red-band day says it, `query.rows('deadlines')` lists it); `create twice with one key makes one deadline`; `an add-on sees only its own deadlines`; `an add-on deadline the person changed or closed is never changed by the add-on` (STRIP edited, done, drop); `update moves an untouched one`; `bad input is refused in plain words` (no title, a date that does not exist, a second line, a key with a space, a link that is not http(s)); `the function is reached on the local door` (server started on a temp workspace, POST /api/functions/addon-deadlines).
- [ ] Run (`node scripts/run-tests.mjs test/addon-deadlines.test.mjs`), fail, implement, pass, commit.

### Task A3: docs, README, guide, PR

**Files:** `docs/full-version/addon-model.md` ("Deadlines an add-on keeps": the door, the three actions with a made-up example, what the person sees, that a changed or closed deadline is theirs, that older Godspeed answers that the function is missing), `README.md` "Coming in the next release", `notebook/recipes/due/reference/due-room.md` and the starter copy only if the guide check names them; the guide pages on a website branch.
- [ ] Feature request in Discussions (Ideas) first; PR references it; `node .github/guide-check.mjs` clean; tools-test, guide and a manual `v2-integrated` run on the branch green; merge as #21 was merged.

## Part B: the Clerk

### Task B1: settings, the clock, the notebook client

**Files:** `lib/core/settings.mjs`, `lib/core/context.mjs`, `lib/core/notebook.mjs`, `test/fakes/notebook.mjs`; Tests `test/settings.test.mjs`, `test/notebook.test.mjs`.

**Interfaces (Produces):**
- `texts` gain: `deadlines` "Deadlines", `deadline_by` "{ask}: by {date}", `deadline_check` "{ask}: by {date} at the earliest. The period runs from when the letter reached you, which it does not print, so this counts from its date. Check the date.", `deadline_passed` "{ask}: by {date}, already passed", `deadline_nodate` "{ask}: the letter sets a period but prints no date to count from", `deadline_unnamed` "A request", `ask_vague` "{ask} (no date given)", `deadline_title_check` "{ask} (check the date)", `deadline_title_kept` "{title}, {date}", `deadline_done` "Done what the letter asks.", `deadline_cost` "A date in a letter that passes can cost a fee, a reminder charge or a right.", `item_check` "check the date", `item_passed` "passed", `item_nodate` "no date to count from", `message_deadline_check` "Deadlines counted from the letter's date, please check them: {list}.", `message_nodate` "A period but no date to count from. Set the letter's date in Paperless and the Clerk makes the deadline: {list}.", `message_godspeed_old` "Your Godspeed cannot keep deadlines from letters yet. Update Godspeed, and the Clerk makes them."
- `buildContext`: `GODSPEED_CLERK_TODAY` (YYYY-MM-DD) sets `today` only with `GODSPEED_CLERK_TEST=1`.
- `Notebook#deadlines(body) -> data` (POST `/api/functions/addon-deadlines`, body gets `addon: "godspeed-clerk"`); `NotebookError.missing` true when the notebook does not know the function.
- Fake notebook: the same three actions with the product's rules, `deadlineRows()`, `personMoves(key, due)`, `personCloses(key)`, `withoutDeadlines` (answers as an old Godspeed).
- [ ] Tests: settings defaults; the clock only in test mode; client create/list/update/touched/missing against the fake. Fail, implement, pass, commit.

### Task B2: reading the requests, counting the dates (pure)

**Files:** Create `lib/core/deadlines.mjs`; Modify `lib/core/sorter.mjs` (prompt and answer: `requests`), `lib/core/notes.mjs` (`summaryRequest` asks `created` and `requests`); Test `test/deadlines.test.mjs`, `test/sorter.test.mjs`.

**Interfaces (Produces):**
- `cleanRequests(raw) -> [{n, ask, by, within:{n,unit}|null, from:"document"|"date"|"receipt"|null, from_date, vague}]` (at most 8; `ask` one line, 160; unusable entries dropped; not a list: `[]`).
- `addPeriod(day, {n, unit}) -> day` (days, weeks, months clamped to the month's end, years).
- `letterDate({ date, uploadDay, dateRead, readCreated }) -> day|null`: Paperless's date unless it is the upload day and neither the Clerk's sorting nor this reading read that day off the letter; else the date the AI read; else null.
- `plan(requests, letter, today, old?) -> items`: `{n, kind:"date"|"period"|"vague"|"nodate", due, basis:"written"|"letter"|"fixed"|null, check, passed}`; an item already `made` keeps `made`, `made_due`, `touched`, `told`; `passed` only for an item not made.
- `keyOf(sum, n) -> "<32 hex>#<n>"`.
- [ ] Tests: `periods: days, weeks, months to the month's end, years over a leap day`; `a written date is taken as written`; `a period from the document's date`; `a period from another printed date`; `a period from receipt counts from the letter's date and is marked check`; `the upload day is never the day a period counts from`; `no letter date: nodate`; `vague: no date`; `passed: never made`; `a corrected letter date moves only what was counted from it`; `requests the AI got wrong are dropped, never guessed`; sorter: `the sorting request asks for the requests and never for a computed date`.

### Task B3: the note, the item, the deadline step, Important

**Files:** Modify `lib/core/note.mjs` (`clerkPart({deadlines})`), `lib/core/notes.mjs` (reading carries the requests; `clerk_asks` header; key includes the plan), `lib/core/documents.mjs` (`deadlines` field), `lib/core/pipeline.mjs` (sort keeps the requests in memory; `flagCheck` exported), Create `lib/core/deadline-step.mjs`; Modify `lib/core/run.mjs`, `lib/core/records.mjs` (doc comment), `lib/core/context.mjs` (crash point `after-deadline`), `lib/core/status.mjs`; kit: seven made-up letters with texts, answers and expected files; Tests `test/deadlines-run.test.mjs`.

**Interfaces:**
- Record: `rec.asks = { read: day|null, letter: day|null, archive?, recovered?, items: [{n, by, within, from, from_date, vague, kind, due, basis, check, passed, made, made_due, touched, told, titled}], important?: "added"|"had"|"removed"|"person", at }`. No words.
- Note header `clerk_asks: { read, items: [{n, ask, by, within, from, from_date, vague}] }`; body: vague requests in Key facts, the rest under `## Deadlines`.
- `deadlineStep(c, doc, rec) -> "made"|"moved"|null`: after the item; makes each open item once (`keyOf`), title = the ask (with " (check the date)") or, kept out, the document's title and date; link = the document in Paperless; `check` items and `nodate` documents go to the outbox once; `nodate` gets "Check this" when Godspeed sorts; a corrected letter date moves an untouched deadline; "Important" while any made deadline's date (Godspeed's current one) is today or later, removed after only when the Clerk added it, never again when the person took it off.
- One `list` per run; a Godspeed without the function: one outbox notice `deadlines-unsupported`, nothing else changes.
- [ ] Acceptance tests (F15, verbatim from the PRD): `the kit's letter with a deadline in the future creates exactly one deadline with the right date and a link to the document, also after a second run`; `a kit letter whose deadline has passed creates none`; `the letter with two requests creates two`; `the letter whose period runs from receipt creates one counted from its printed date and marked "check the date"`; `a vague request creates none`; `after the user moves a deadline's date, a run that reads the letter again leaves the user's date`.
- [ ] Rule tests: no usable date (Check this, message, the deadline once the date is set); kept-out letter named by title and date; the tag added later renames an untouched one; Important while ahead and gone after, never re-added; F4 modes make the deadlines and write nothing to Paperless; corrected letter date moves an untouched deadline, not a touched one; records deleted: none twice; killed after the deadline: none twice; old Godspeed; F14 no words in records or log.

### Task B4: the message, the collection, F16 and F17

**Files:** `lib/core/notify.mjs`, `lib/core/documents.mjs`; Tests `test/notify.test.mjs`, `test/documents.test.mjs`.
- [ ] `F16: a run over the kit sends exactly one message, naming the blurry document and the letter whose deadline needs a check; a second run with nothing new sends none` (the PRD's words); nodate line; held with a pile like papers to check; `F17: ... its deadlines`.

### Task B5: full test, docs, version 0.3.0

**Files:** `test/full/full.mjs`, `test/full/README.md`, `README.md`, `docs/architecture.md`, `docs/privacy.md`, `CHANGELOG.md`, `package.json`, `lib/commands/setup.mjs` (one sentence on deadlines).
- [ ] Full test: deadlines through the real product (`GODSPEED_NOTEBOOK_CHECKOUT` with A1, A2): the six F15 checks, the reminder said by the product's own `tools/due.js today` on the red-band day, the kept-out letter's name, the person's moved date kept through a reread, a corrected date and lost records, F4 modes, the kill `after-deadline`, F16 message.
