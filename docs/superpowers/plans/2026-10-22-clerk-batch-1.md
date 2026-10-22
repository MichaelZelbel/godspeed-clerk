# The Clerk, batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One paper, all the way through: a document that arrives in an existing Paperless-ngx gets a checked copy in the user's Google Drive "To sort" folder within ten minutes, is sorted (when Godspeed sorts), and is renamed and moved into the right folder of the user's own tree within the hour, resumable at every step.

**Architecture:** A Node 22 command `godspeed-clerk` with no npm packages, shaped like the Wingman: `bin/` starts `lib/commands/<name>.mjs`; the work lives in small modules under `lib/core/`. A background worker calls `runOnce()` every few minutes. Every outside system (Paperless, Drive, the AI, the clock, the crash hook) reaches `runOnce()` through one context object, so the fast tests pass fakes and the CLI passes the real things. Per-document records (numbers, marks, folder ids, name hashes, never text) make every step resumable; marks in Drive `appProperties` make the files findable again without records.

**Tech Stack:** Node.js 22+ (`node:test`, `fetch`, `node:http`, `node:crypto`), no npm packages. Test kit rendering: Python 3 with Pillow (run inside the Paperless container in CI). Full test: Paperless-ngx 3.3.3 in Docker on GitHub Actions.

**Spec:** `docs/proposals/paperless-addon.md` in MichaelZelbel/godspeed-mission-control (commit a557137e), features F1 (connect path), F4, F5, F6, F7, F8, F12, F13, F14, F18. The add-on AI contract: `docs/full-version/addon-model.md` in the same repository.

## Global Constraints

- Node.js 22 or newer, ES modules (`.mjs`), Node's own modules only, no npm packages.
- Every AI call goes through Godspeed's `godspeed-model` command (JSON on stdin: `system`, `prompt`, `timeout_ms`, `max_tokens`; JSON on stdout: `text`, `provider`, `model`, optional `backup`). No other AI route exists in the code.
- Paperless: sign in with the user's existing API token, read through `POST /api/token/` (Django REST Framework, returns the existing token). Never call `/api/profile/generate_auth_token/`, never `DELETE` anything.
- "Paperless sorts" and "nobody sorts": not one write request reaches Paperless (enforced in the client, not by convention).
- Google Drive scope `https://www.googleapis.com/auth/drive`; every write confined in code to the documents folder subtree and the add-on's own folder subtree.
- Every file the add-on makes in Drive carries `appProperties` `clerkDoc` (Paperless id) and `clerkSum` (the original's checksum from `/api/documents/<id>/metadata/`).
- Logs name documents by number only; records hold numbers, marks, folder ids, name hashes and links, never text or titles; state files mode 600, folders 700.
- Nothing about a real person in the repository: made-up English test documents only.
- No em dashes or en dashes in anything a person reads.
- Tag names, the "To sort" name, the user's language, country and profile facts are settings with English defaults; no other language's words in code.

## Review Focus

- A Paperless with documents of a second account (household): only documents the signed-in account owns are handled. Test in Task 9 (`ignores documents another account owns`).
- A pasted Google sign-in address with a wrong `state`, or a second `drive finish`: refused, nothing saved. Test in Task 6 (`finish refuses an address from another sign-in`).
- A title with characters Drive or file systems dislike (`/`, `:`, newline) or a very long one: the file name is cleaned and cut, never an error. Test in Task 7 (`fileName cleans and shortens`).
- A document deleted in Paperless after it was filed: its file stays, its record says so, no error loop. Test in Task 9 (`a document deleted in Paperless leaves its file`).
- The worker started twice (service plus a manual `run`): the second waits or skips, never two runs at once. Test in Task 10 (`a second run while one holds the lock does nothing`).

---

### Task 1: Repository shape, paths, settings, private files

**Files:**
- Create: `package.json`, `bin/godspeed-clerk.mjs`, `lib/commands/index.mjs`, `lib/commands/help.mjs`, `lib/core/paths.mjs`, `lib/core/settings.mjs`, `lib/core/files.mjs`, `.gitignore`, `.gitattributes`, `.editorconfig`, `LICENSE`, `AGENTS.md`, `CLAUDE.md`, `.github/workflows/test.yml`
- Test: `test/settings.test.mjs`

**Interfaces:**
- Produces: `stateDir({env, platform, root, home}) -> string` (`GODSPEED_CLERK_STATE`, Linux root `/var/lib/godspeed/clerk`, else `~/.godspeed/clerk`); `statePaths(dir) -> {root, settings, paperless, drive, plan, state, records, log, outbox, pendingOauth, lock, tmp}`; `writePrivate(file, text)` (tmp + rename, mode 600, folders 700); `readJson(file, fallback)`; `DEFAULTS`; `loadSettings(paths) -> settings`; `saveSettings(paths, patch) -> settings`; `setSetting(settings, key, value) -> settings` (validates: `sorting` in `godspeed|paperless|nobody`, numbers positive).

- [ ] Test: `loadSettings` on an empty folder returns DEFAULTS (`active:false`, `sorting:"godspeed"`, `tags.check:"Check this"`, `tags.tax_prefix:"Tax"`, `to_sort:"To sort"`, `batch_size:10`); `setSetting(s,"sorting","sometimes")` throws; `writePrivate` leaves mode 600 on POSIX.
- [ ] Implement, run `node --test "test/*.test.mjs"`, commit.

### Task 2: Paperless client with the write guard

**Files:** Create `lib/core/paperless.mjs`, `test/fakes/paperless.mjs`; Test `test/paperless.test.mjs`

**Interfaces:**
- Produces: `class Paperless({url, token})` with `get(path, params)`, `all(path, params)` (follows `next` on the base address it was given), `document(id)`, `metadata(id)`, `download(id) -> Buffer` (archive version, original when there is none), `me() -> {id, username}` (from `ui_settings/`); `paperless.writer(mode) -> {patchDocument(id, fields), createTag(name), createCorrespondent(name)}`, throws `ReadOnlyError` unless mode is `godspeed`; any `DELETE` or a path containing `generate_auth_token` throws before a request; `obtainToken({url, user, password, code}) -> token` (POST `token/` only). `class Taxonomy(paperless)` with `tags`, `correspondents`, `types` maps, `tag(name)`, `type(name)`, `inboxTag()`.
- `startFakePaperless({users, docs, tags, types, correspondents}) -> {url, state, writes, close()}` for the fast tests (filters `tags__id__all`, `owner__id`, `owner__isnull`, `fields`, `ordering`, `page_size`, `page`; `next` carries a foreign host).

- [ ] Tests: `writer("nobody")` and `writer("paperless")` throw `ReadOnlyError`; a `DELETE` throws without a request reaching the fake; `all()` follows a `next` with a foreign host; `obtainToken` posts once to `token/` and returns the token.
- [ ] Implement, run, commit.

### Task 3: The sorter (port of the test bench's rules, PRD F5, F6, F7, F12)

**Files:** Create `lib/core/names.mjs`, `lib/core/sorter.mjs`; Test `test/sorter.test.mjs`

**Interfaces:**
- Produces: `nameWords(name) -> Set`; `findSame(objs, name) -> obj|null` (exact first, then word-set containment, a tie is null); `titleIsDefault(title, originalFileName, patterns)`; `readable(text)` (at least 30 letters and 5 words of 3+ letters); `clip(text, limit)` (first 75 percent and last 25 percent); `uploadDay(doc)`; `buildPrompt({doc, tax, settings, today, folderChoices}) -> {system, prompt}`; `validateAnswer(raw, today, folderChoices) -> {answer} | {problems}`; `decide({doc, answer, tax, settings, today, whyCheck}) -> decision`; `applyDecision(writer, tax, doc, decision) -> {patched}`; `sortDocument({doc, tax, writer, settings, ask, today, folderChoices}) -> {result: "sorted"|"check", why, folder}`, throws `ModelUnavailable` untouched.
- Answer fields: `title, correspondent, document_type, tags, created, folder, confident`.

- [ ] Tests (the test bench's 16 cases, adapted to the PRD's field rules): scan title replaced, typed title kept, file-name stem replaced; tags merge and only grow, inbox tag removed; reserved tags (inbox, check, not in notebook, important) never added by the AI and kept when already there; invalid JSON twice asks exactly twice and gives Check this with nothing else; invalid then valid applies the second; dates: a future date and 2024-02-30 invalid, null leaves `created`, a date the user set (not the upload day) is kept; sender reuse by word sets, a new sender made with matching algorithm 6 only when confident; `Tax 2022` created (matching 0), `Tax 1890` dropped; not confident: Check this plus only safe fields, nothing created but the check tag; unreadable text: no AI call; sender and type set only when empty; the prompt fences the text, says it is data, and lists none of the reserved tags.
- [ ] Implement, run, commit.

### Task 4: The AI connection and its route check (F12)

**Files:** Create `lib/core/model.mjs`, `test/fakes/model.mjs`; Test `test/model.test.mjs`

**Interfaces:**
- Produces: `modelProgram({env, workspace}) -> {exe, args}|null` (`GODSPEED_MODEL_COMMAND`, then `<workspace>/.godspeed/model.mjs`, then `godspeed-model` on the PATH, `~/.godspeed/bin`, `/usr/local/bin`); `describe({workspace, env}) -> {provider, model, backup}`; `ask({system, prompt, timeoutMs}, {workspace, env}) -> {text, provider, model, backup}`; `routeCheck(settings, described) -> []|[problems]` (every provider, the backup's too, must be in `settings.approved_ai`); `ModelUnavailable`, `RouteRefused`.
- `test/fakes/model.mjs`: a stand-in for `godspeed-model` reading recorded answers from `GODSPEED_CLERK_FAKE_ANSWERS` (first answer whose `match` strings all occur in system+prompt, consumed in order) and logging every prompt to `GODSPEED_CLERK_FAKE_PROMPTS`.

- [ ] Tests: no program found -> `ModelUnavailable` and nothing sent; a provider outside `approved_ai` -> `RouteRefused` before any prompt is written to the fake's log; a normal answer comes back with its provider.
- [ ] Implement, run, commit.

### Task 5: Drive client, confinement, fake Drive

**Files:** Create `lib/core/drive.mjs`, `test/fakes/drive.mjs`; Test `test/drive.test.mjs`

**Interfaces:**
- Produces: `class Drive({creds, env, crash})`: `about()`, `list(q, fields)`, `get(id)`, `createFolder(name, parentId)`, `upload({name, parentId, bytes, appProperties})` (resumable, chunk size `GODSPEED_CLERK_UPLOAD_CHUNK` or 8 MiB, crash point `mid-upload` after the first chunk), `replaceContent(id, bytes)`, `update(id, {name}, {addParents, removeParents})`, `findByMark(docId)`; errors `DriveAccessLost` (refresh refused or 401 after refresh), `DriveError`. `class Confined(drive, {rootId, ownId})`: `load()` (folders of both subtrees), `isInside(folderId)`, `children(folderId)`, `ensurePath(fromId, segments, creatable)`, `uploadInto`, `moveRename(file, {name, parentId})` (refuses a file without our mark, a file or destination outside); `OutsideError`.
- `startFakeDrive({tree}) -> {url, authUrl, tokenUrl, files, writes, revoke(), restore(), close()}`: Drive v3 subset (`about`, `files` list with the q subset `'<id>' in parents`, `name = `, `mimeType = /!=`, `trashed = false`, `appProperties has {key= and value=}`; get; create folder; resumable upload with 308 and `Range`; metadata PATCH with add/removeParents; content PATCH), OAuth (auto-consent redirect with code, PKCE S256 checked, refresh grant, revocation).

- [ ] Tests: an upload in three chunks arrives whole with size, md5 and sha256; `moveRename` of a file without the mark, or into a folder outside, throws `OutsideError` and the fake records no write; `ensurePath` creates only the placeholder segments it is allowed to; a revoked token gives `DriveAccessLost`.
- [ ] Implement, run, commit.

### Task 6: Google sign-in (PKCE, works without a browser on the server)

**Files:** Create `lib/core/oauth.mjs`, `lib/commands/drive.mjs`; Test `test/oauth.test.mjs`

**Interfaces:**
- Produces: `startSignIn(paths, {clientId, clientSecret, port, env}) -> {url, redirect}` (saves verifier, state, redirect privately); `finishSignIn(paths, pastedAddressOrCode, {env}) -> {account}` (checks state, exchanges with the verifier, insists on the drive scope, reads the account, saves `drive.json` 600, removes the pending file); `waitForBrowser(paths, {timeoutMs})` (optional listener on the loopback port); commands `drive connect`, `drive finish <address>`, `drive folder <link|id|name>`, `drive status`, `drive disconnect`.

- [ ] Tests: the link carries `code_challenge_method=S256`, `access_type=offline`, `prompt=consent`, the drive scope; finishing with the fake's redirect address saves the account; an address with another `state` is refused and nothing is saved; a grant without the drive scope is refused.
- [ ] Implement, run, commit.

### Task 7: The folder plan (F8)

**Files:** Create `lib/core/plan.mjs`, `lib/commands/plan.mjs`; Test `test/plan.test.mjs`

**Interfaces:**
- Produces: `readTree(confined, rootId) -> [{id, name, children}]` (two levels, folders only); `proposePlan({tree, types, senders, settings}) -> {rules, notes}` (deterministic: a type matches a top folder by its words with plurals dropped; year subfolders give `{year}`, subfolders named like known senders give `{sender}`); `proposeWithAi(...)` used for the types the first pass left open; `validatePlan(plan, tree)`; `sentences(plan) -> [string]`; `resolveFolder(plan, meta) -> {pattern}|null` (first rule whose `type`, `sender` and `tag` all match); `segments(pattern, meta) -> [string]` (`{sender}`, `{type}`, `{year}` = the year of the one tax tag, else of the date); `fileName(date, title) -> string` (cleaned, at most 150 characters plus `.pdf`).
- Plan file: `{format:1, status:"proposed"|"confirmed", root:{id,name}, to_sort:{name,id}, rules:[{type?, sender?, tag?, folder}]}`.

- [ ] Tests: against the kit's made-up tree, every kit document type maps to one of its folders; sentences read "Invoices go to Invoices/<sender>."; `{year}` follows the tax tag; `fileName` cleans and shortens; confirming creates "To sort" inside the root and nothing else.
- [ ] Implement, run, commit.

### Task 8: Records and the per-document steps (F8 filing, F18)

**Files:** Create `lib/core/records.mjs`, `lib/core/pipeline.mjs`; Test `test/pipeline.test.mjs`

**Interfaces:**
- Produces: `Records(paths)`: `get(id)`, `put(rec)` (one file per document, atomic), `all()`; record `{id, sum, upload_day, copy:{file_id, at}|null, sort:{result, folder, at}|null, file:{folder_id, name_hash, base_hash, modified, at}|null, intent:{step, folder_id?, name_hash?}|null, user_owned, gone}`. Steps `copyStep(ctx, doc, rec)`, `sortStep(ctx, doc, rec)`, `fileStep(ctx, doc, rec)`; each records an intent before an outside write and the result after it, and starts by looking for its own earlier result (mark in Drive, missing inbox tag, file already where the intent said). Crash points `after-copy`, `after-sort`, `after-file` sit between the outside write and the record.

- [ ] Tests: killed after each step in turn and once mid-upload, the next run leaves exactly one file per document and the same end state as an uninterrupted run; with the records deleted a run makes no second file; same date and title give `name.pdf` and `name (2).pdf`; a title changed in Paperless renames the file; a file moved by hand stays where the user put it after its title changes; a file the test placed by hand is untouched.
- [ ] Implement, run, commit.

### Task 9: One run (F4, F7, F8 access, F13, F14)

**Files:** Create `lib/core/run.mjs`, `lib/core/log.mjs`, `lib/commands/run.mjs`, `lib/commands/status.mjs`, `lib/commands/settings.mjs`, `lib/commands/pause.mjs`, `lib/commands/resume.mjs`; Test `test/run.test.mjs`, `test/kit.test.mjs`

**Interfaces:**
- Produces: `runOnce(ctx) -> {paused, copied, sorted, check, filed, waiting, total, notes}`; phases: copies (up to `copy_batch`), sorting (Godspeed sorts only, up to `batch_size`), filing; all within `run_minutes`; `buildContext(paths, {env}) -> ctx`; `statusReport(paths) -> text` ("212 of 640 sorted", Drive access, plan, AI provider, paused or active).

- [ ] Tests: "Paperless sorts" and "nobody sorts" over the kit: no write request reaches the fake Paperless and every document has one file; batch size 2 with five documents: 2 sorted, 3 waiting, the next runs finish; Drive access revoked: no Drive write, one reconnect notice in the outbox, status says so; after reconnecting every waiting document is filed once; no log line, record or temporary file contains a sentence of a kit document; ignores documents another account owns; a document deleted in Paperless leaves its file.
- [ ] Implement, run, commit.

### Task 10: Worker, service, setup, installer (F1 connect path)

**Files:** Create `lib/commands/worker.mjs`, `lib/commands/setup.mjs`, `lib/commands/connect.mjs`, `lib/commands/uninstall.mjs`, `lib/setup/service.mjs`, `install.sh`; Test `test/setup.test.mjs`

**Interfaces:**
- Produces: a lock (`lock` file with pid) shared by `worker` and `run`; `setup --paperless <url> --user <name> [--paused] [--godspeed <dir>] [--no-service]` copies the program, connects (writes nothing into Paperless), records the AI provider as approved, installs the service (systemd system unit as root, user unit, LaunchAgent, Windows task, as the Wingman does).

- [ ] Tests: connecting to the fake Paperless makes no write request; the systemd unit names `godspeed-clerk worker`; a second run while one holds the lock does nothing.
- [ ] Implement, run, commit.

### Task 11: Test kit and the full test with a real Paperless

**Files:** Create `test/kit/kit.json`, `test/kit/documents/*.txt`, `test/kit/expected/*.json`, `test/kit/answers.json`, `test/kit/render.py`, `test/full/compose.yaml`, `test/full/full.mjs`, `.github/workflows/full.yml`

- [ ] Kit: utility invoice, tradesperson invoice, tax assessment, insurance statement (uploaded with a typed title and an extra tag), pay slip, bank tax certificate (sorted before the run), two-page letter, blurry and crooked scan, the letter that tries to instruct the AI, two letters with the same date and title. Made-up English only.
- [ ] Full test: Paperless-ngx 3.3.3 (plus Redis) in Docker, a second account with its own document, the kit rendered in the container and uploaded with the upload day as its date (as the phone app does); "nobody sorts" and "Paperless sorts" runs compared through the API before and after; then Godspeed sorts with the crash after each step and mid-upload; expected results checked through the API and the fake Drive; records deleted and run again; title change, hand move, hand-placed file, deletion in Paperless, revoked access and reconnect.
- [ ] Get CI green, commit.

### Task 12: Docs and the deployment notes

**Files:** `README.md`, `docs/architecture.md`, `docs/google-drive.md`, `docs/privacy.md`, `CHANGELOG.md`

- [ ] Plain words, no dashes, what it reads and writes, the Google consent step, the sorting settings.
