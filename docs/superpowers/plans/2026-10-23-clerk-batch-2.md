# The Clerk, batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Godspeed knows your papers: every document the Clerk handled gets one note in the person's Godspeed notebook (full text, summary, key facts, links) and one item in a "Documents" collection; a "Not in notebook" tag keeps a document out (and takes the Clerk's text out of a note made earlier); and the person hears about what they can act on, as one short message per run with one link, never twice.

**Architecture:** Two new steps after filing in every run (F18 order: copy, sort, file, note, collection item, deadlines later), then one message step. The notebook is reached only through its local door (`POST <door>/api/query`, `POST <door>/mcp` for its web address), with the same client shape as the Wingman's. Note text lives only in the notebook; the Clerk's records keep a note id derived from the document's mark, hashes and states. Messages reuse the Wingman's channels (the assistant's own Telegram bot read from its Hermes `.env`, desktop notifications), fed by batch 1's outbox.

**Tech Stack:** Node.js 22+, Node's own modules only. Fast tests: `node:test` with a pretend notebook (HTTP), pretend channels. Full test: real Paperless-ngx 3.3.3 in Docker, a real Godspeed notebook started from a product checkout, a pretend Telegram API.

**Spec:** `docs/proposals/paperless-addon.md` in MichaelZelbel/godspeed-mission-control at `7c10d4af`: F10, F11, F13 (as it applies to notes), F16, F17; F15 only as a seam. Notebook facts this plan relies on (read from the product's `notebook/core/query.mjs`, `records/store.mjs`, `records/layout.mjs` at the same commit):
- table `notes`; insert/update merge values over the old row; every top-level key becomes a YAML header line of the note's file; `folder_path: "Documents"` files a note in that folder; trash is `update {is_trashed: true, trashed_at}`; `delete` is permanent (row disappears from every read); insert with an existing id (also a deleted one) fails "Record already exists".
- `expected: {[id]: _hash}` on update: a stale write the person also changed is refused with HTTP 409 `code: "CONFLICT"` and both versions are kept for the person.
- the editor round-trips Markdown through TipTap: HTML comments are dropped, headings, lists and fenced code blocks survive.
- web routes: a note `/dashboard/notes/<id>`, a collection `/collections/<slug>`, an item `/collections/<slug>/<itemId>`; the web origin comes from the MCP tool `get_notebook_link`.

## Global Constraints

- Node.js 22 or newer, ES modules, no npm packages.
- Every AI call through Godspeed's `godspeed-model` (`ctx.ask`); no other route.
- F14: logs, records, state and outbox hold numbers, marks, hashes, folder ids and links only, never a document's text or title. Note text exists only in the notebook.
- The note's mark lives in its header as top-level keys `source_app: "godspeed-clerk"`, `clerk_doc: <Paperless id>`, `clerk_sum: <original checksum>`; its id is `clerk-<first 32 hex of the checksum>`.
- A note is never deleted by the Clerk. The only removal: F11 (the Clerk's own part, and trash when nothing of the person's is left).
- One message per run at most, one link in it, only for: a paper to check, lost Drive access, a document deleted in Paperless, the notebook unreachable for `notebook_down_hours` (6). Never twice for the same thing (keys `check:<doc>`, `deleted:<doc>`, `drive-lost:<since>`, `notebook-down:<since>`).
- Under `node --test` (`NODE_TEST_CONTEXT` set), the Clerk never uses the default notebook door (127.0.0.1:47831) and never a real message channel; a test names its own.
- Words a person reads in a note, a kept-out note, a message, are settings (`texts.*`) with English defaults; no other language in code. The collection "Documents" and the notes folder "Documents" are settings too (`collection`, `notebook_folder`).
- No em dashes or en dashes in anything a person reads. Made-up documents only.

## Review Focus

1. The person edits the note while the Clerk writes it (409): nothing of theirs is lost, the Clerk tries again next run. Test in Task 4 (`a note changed by the person at the same moment is not overwritten`).
2. The person deleted the "Your notes" heading: the Clerk cannot tell its part from theirs, so it leaves the note's text as it is. Test in Task 4 (`without its heading a changed note is left as it is`).
3. A letter whose text contains a fence (```) or a line "## Your notes": the boundary is still the Clerk's own heading. Test in Task 3 (`a text with a fence and a look-alike heading splits at the Clerk's heading`).
4. The notebook does not answer (stopped, mid-run): the run files as usual, notes wait, nothing throws. Test in Task 4 (`with the notebook down the run goes on and the notes come later`).
5. Telegram refuses (wrong token): the message is not lost and not sent twice; it goes on the next run that a channel takes it. Test in Task 7 (`a message no channel took is sent next run, once`).

---

### Task 1: Settings, the test guard, the context

**Files:**
- Modify: `lib/core/settings.mjs`, `lib/core/context.mjs`, `lib/core/paths.mjs` (nothing new on disk: everything goes into `state.json` and records)
- Test: `test/settings.test.mjs`, `test/helpers.mjs`

**Interfaces:**
- Produces: new DEFAULTS `notebook: true`, `notebook_folder: "Documents"`, `collection: "Documents"`, `note_batch: 50`, `notebook_down_hours: 6`, `paperless_web: ""`, `talk: null` (null: `["desktop"]` on a desktop, else `["telegram"]`), `telegram_env: ""`, `texts: {...}` (keys below). `setSetting` accepts `notebook` (bool), `note_batch`/`notebook_down_hours` (numbers), `talk` (JSON list of `telegram|desktop`), `texts.<key>`.
- `texts` keys and English defaults: `sender` "Sender", `date` "Date", `type` "Type", `tags` "Tags", `folder` "Folder", `facts` "Key facts", `links` "Links", `in_paperless` "In Paperless", `in_drive` "In the drive", `full_text` "Full text", `rest_in_paperless` "The rest of the text is in Paperless.", `hint` "The Clerk rewrites everything above the next heading when the document changes. Write your own notes below it; the Clerk never changes them.", `yours` "Your notes", `kept_out_title` "Document kept out of the notebook", `message_head` "The Clerk:", `message_check` "Could not be placed, waiting in \"{to_sort}\": {list}.", `message_drive` "Google Drive no longer lets the Clerk file your papers. Ask your assistant to connect the drive again.", `message_deleted` "Deleted in Paperless, its file stays in your drive: {list}.", `message_notebook` "Your notebook has not answered for {hours} hours, so new papers get no notes yet."
- `buildContext(paths, { notebook, tell, ... })`: `ctx.notebook` (a `Notebook` or null), `ctx.tell(text) -> {delivered}`. Defaults: `new Notebook({ base })` with `base = env.GODSPEED_CLERK_NOTEBOOK || DEFAULT_NOTEBOOK`, except under `NODE_TEST_CONTEXT` (in `env` or `process.env`) without `GODSPEED_CLERK_NOTEBOOK`: null. `tell` default: the channels of Task 6; under `NODE_TEST_CONTEXT` without `GODSPEED_CLERK_TELEGRAM_API`: a teller that takes nothing.

- [ ] Test `settings: batch 2 defaults and the new settings` (`loadSettings` gives `notebook: true`, `texts.kept_out_title` "Document kept out of the notebook", `collection` "Documents"; `setSetting(s, "texts.kept_out_title", "X")` sets only that text; `setSetting(s, "talk", "[\"telegram\"]")` gives `["telegram"]`; `setSetting(s, "talk", "[\"pigeon\"]")` throws; `note_batch 0` throws).
- [ ] Test `under node --test the default notebook door and real channels are never used` (`buildContext(paths, { env: {} }).notebook === null`; `(await ctx.tell("x")).delivered === false`).
- [ ] Run, see both fail; implement; run `node --test "test/*.test.mjs"`, all pass; commit.

### Task 2: The notebook client and a pretend notebook

**Files:**
- Create: `lib/core/notebook.mjs`, `test/fakes/notebook.mjs`
- Test: `test/notebook.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_NOTEBOOK = "http://127.0.0.1:47831"`; `class NotebookError (status, code)`; `class NotebookDown` (no answer: refused, timed out); `class Notebook({ base, fetchImpl, timeoutMs = 30000 })` with `query(body)`, `answers() -> bool`, `address() -> origin|null` (as the Wingman's), `note(id) -> row|null`, `insertNote(values) -> row`, `updateNote(id, values, hash) -> row`, `collection(id)`, `collectionsBy(sourceApp)`, `createCollection(values)`, `item(collectionId, sourceId) -> row|null`, `insertItem(values)`, `updateItem(id, data, hash)`. Every update and every single read carries `["eq","id",id]`.
- `startFakeNotebook({ web = "https://notebook.example" }) -> { url, rows(table), row(table,id), edit(table, id, patch), remove(table, id), writes, down (settable), close() }`: `/api/query` for `notes`, `collections`, `collection_items` with `eq` filters, insert (refuses an existing or deleted id), update (merges values, refuses a stale `expected` hash with 409 `CONFLICT`), delete (`removed_at`, then invisible); note defaults (`is_trashed:false`, `folder_path:""`), collection `slug` from the name, item `title` from the primary field; `/mcp` `get_notebook_link`; with `down` true every request's socket is destroyed.

- [ ] Tests: `the notebook client: insert, read back, update with the version read` ; `a stale version is refused (409) and nothing changes` ; `a deleted note cannot be made again` ; `down: NotebookDown, answers() false`.
- [ ] Run, fail, implement, pass, commit.

### Task 3: The note's text (pure)

**Files:**
- Create: `lib/core/note.mjs`
- Test: `test/note.test.mjs`

**Interfaces:**
- Produces: `SOURCE = "godspeed-clerk"`; `noteId(sum) -> "clerk-<32 hex>"`; `FULL_TEXT_MAX = 200000`; `clerkPart({ texts, fields: {sender, date, type, tags, folder}, summary, facts, links: {paperless, drive}, text }) -> string` (a field list, the summary paragraph, "Key facts" list, "Links" list, "Full text" in a fence longer than any backtick run in the text, a rule, the hint in italics, and last the line `## <texts.yours>`; empty fields and sections are left out); `splitNote(content, headings) -> { user } | null` (the text after the first heading line outside fences whose words, without `#`, `*`, `_`, `\`, case, equal one of `headings`); `composeNote(clerk, user) -> string`; `blank(user) -> bool`.

- [ ] Tests: `the Clerk's part holds every field, the summary, the facts, both links and the whole text, and ends with the person's heading`; `a text with a fence and a look-alike heading splits at the Clerk's heading`; `split finds the heading after the editor escaped it ("## Your notes" written back as "## Your notes" or "**Your notes**" in a heading)`; `no heading: null`; `a very long text is cut with the line that the rest is in Paperless`.
- [ ] Run, fail, implement, pass, commit.

### Task 4: The note step (F10, F11) and the summary

**Files:**
- Create: `lib/core/notes.mjs`
- Modify: `lib/core/sorter.mjs` (answer fields `summary`, `key_facts`, checked softly: dropped when unusable, never a "problem"), `lib/core/pipeline.mjs` (`sortStep` keeps `{summary, facts}` of a sure answer in `c.summaries`, `null` for any other result), `lib/core/run.mjs` (step 5), `lib/core/records.mjs` (record doc comment), `test/kit-world.mjs` (pretend notebook and channels in every world; `runUntilQuiet` also waits for notes and items), `test/kit/answers.json` (summaries for the sorted kit documents), kit: add `doctor-letter` (uploaded with "Not in notebook") with its text, answer and expected file.
- Test: `test/notes.test.mjs`

**Interfaces:**
- Consumes: Task 2 `Notebook`, Task 3 functions, `metaOf(c, doc, rec)` and `hasInbox` from `pipeline.mjs`.
- Produces: `noteReady(rec) -> bool` (`rec.sum` and one of `rec.file`, `rec.user_owned`, `rec.trashed`; not `rec.gone`); `keptOut(c, doc) -> bool` (the `tags.not_in_notebook` tag is on it); `isArchive(c, doc, rec) -> bool` (`rec.sort.result === "before"`, or `"external"` and `doc.added` before `state.started_at`); `folderPath(c, folderId) -> "Invoices/Hollis Roofing" | "To sort" | null` (from the drive tree, the kept tree when the drive is not open); `noteStep(c, doc, rec) -> "written" | "kept-out" | "trashed" | null`; `summaryRequest(full, settings) -> {system, prompt}` (system starts "You summarise one scanned document"), `validateSummary(raw) -> {summary, facts} | null`.
- Record: `rec.note = { id, key, hash, summary: "yes"|"no", kept_out, deleted, at }` (no text). `key` = hash of what the note is made from (document version, file place, in-drive, kept out, summary state, texts, folder); equal key: nothing is read or written.
- Rules: a note only after filing; deterministic id; not there and insert refused as existing: deleted by the person, never made again; trashed by the person: left there (kept-out text is still taken out); the summary comes from `c.summaries` (the sorting answer, no second call), otherwise one AI call per document that is not archive, at most `batch_size` per run and only while the run has time; archive: none; unusable twice: `summary: "no"`, not asked again. The note's `title`, `content`, `clerk_*` fields are written; `folder_path` only when it is made. Update with the version just read; 409: tried next run.
- F11: kept out and no note: nothing made, `rec.note.kept_out`. Kept out with a note: the Clerk's part, title, summary, facts removed; nothing of the person's: `title: texts.kept_out_title`, `content: ""`, trashed; their lines: `title: texts.kept_out_title`, `content: <their lines>`, `clerk_kept_out: true`. Tag removed later: the Clerk's part comes back above their lines.

- [ ] Tests (acceptance, F10): `F10: a run over the kit makes exactly one note per document` (every Alex document but the kept-out one: one note with the mark, in "Documents", title as in Paperless, sender, date, type, the full text, links to Paperless and the drive file; summaries from the sorting answers; no summary request for a document sorted in the run; none for the archive document); `F10: renaming a document and running again updates the same note and keeps a line the user added`; `F10: a reinstall followed by a run makes no new notes` (records and state deleted).
- [ ] Tests (acceptance, F11): `F11: the doctor's letter with the tag is sorted and filed but has no note`; `F11: adding the tag to a noted document trashes its note on the next run` (and the trashed note holds none of the Clerk's text); `F11: adding it to a noted document with a line the user added leaves a note holding only that line` (title "Document kept out of the notebook").
- [ ] Tests (rules): `a new document Paperless sorts gets its summary in one AI call; the archive none`; `a note the person deleted is never made again; one they trashed stays in the trash`; `a note changed by the person at the same moment is not overwritten`; `without its heading a changed note is left as it is`; `with the notebook down the run goes on and the notes come later`; `F4: with "Paperless sorts" and "nobody sorts" every note is still written and nothing reaches Paperless`.
- [ ] Run, fail, implement, pass, commit.

### Task 5: The Documents collection (F17)

**Files:**
- Create: `lib/core/documents.mjs`
- Modify: `lib/core/run.mjs`
- Test: `test/documents.test.mjs`

**Interfaces:**
- Produces: `FIELDS` (keys `added` date, `date` date, `title` text primary, `sender`, `type`, `tags` text, `folder` text "Folder in the drive", `status` select `["sorted", "check this", "to sort", "kept out of the notebook"]`, `in_drive` boolean "In drive", `deadlines` text (F15 seam, never written yet), `note` url, `paperless` url "In Paperless", `drive` url "In the drive"); `KEPT = ["added", "folder", "status"]`; `statusOf(c, doc, rec)`; `itemFields(c, doc, rec) -> data`; `ensureCollection(c) -> {id, slug}` (found by the id in state, else by `source_app`, else made; `state.collection = {id, slug}`); `itemStep(c, doc, rec) -> "written"|null` (`source_app` `godspeed-clerk`, `source_id` the checksum; the person's own columns kept; `rec.item = {id, key, at}`); `collectionLink(web, slug)`, `itemLink(web, slug, id)`.
- "to sort" is a fourth status (a paper nobody sorted yet, waiting in To sort in "nobody sorts"); the spec lists three. Reported, not hidden.

- [ ] Tests (acceptance): `F17: after a run over the kit, the collection has one item per document with every field filled as its expected-result file says`; `F17: renaming a document updates its item`; `F17: the doctor's letter with "Not in notebook" has an item without a title`; plus `F11: an item shrinks to its kept-out form when the tag is added`; `a column the person added keeps its value`.
- [ ] Run, fail, implement, pass, commit.

### Task 6: Channels

**Files:**
- Create: `lib/channels/index.mjs`, `lib/channels/telegram.mjs`, `lib/channels/desktop.mjs` (from the Wingman's, without the desk)
- Test: `test/channels.test.mjs`

**Interfaces:**
- Produces: `talkOf(settings) -> ["telegram"] | ["desktop"] | ...`; `tell(text, { settings, paths, log, impls }) -> { delivered, results }`; `readiness(settings) -> [{name, ok, why}]`; Telegram `envCandidates({ workspace })` puts `<workspace>/.godspeed/integrated-runtime/hermes/.env` first (Godspeed's own assistant on a server), then the Wingman's list; `apiBase()` honours `GODSPEED_CLERK_TELEGRAM_API` only with `GODSPEED_CLERK_TEST=1`.

- [ ] Tests: `telegram: the assistant's own bot from the Godspeed folder, one sendMessage with the text`; `a fake Telegram address outside test mode is refused`; `readiness names the bot's .env, or says what is missing`.
- [ ] Run, fail, implement, pass, commit.

### Task 7: One message per run (F16)

**Files:**
- Create: `lib/core/notify.mjs`
- Modify: `lib/core/run.mjs` (notebook down since, `notebook-down` notice; the message step last), `lib/core/status.mjs` (notebook, notes progress, where messages go)
- Test: `test/notify.test.mjs`

**Interfaces:**
- Produces: `notifyStep(c, docs) -> { sent: bool, text }`. Reads the outbox from `state.notify.offset`, drops what is no longer true (a check resolved, Drive back, notebook back), drops keys in `state.notify.sent`, writes one message: `texts.message_head`, one line per kind, one link (the item when it is one paper, else the collection, else the Paperless address); delivered: keys and offset saved; not delivered: kept for the next run.
- Paper names: Paperless's title and date; a deleted document's from its note, else its drive file, else "document <number>".

- [ ] Tests (acceptance): `F16: a run over the kit sends exactly one message, naming the blurry document; a second run with nothing new sends none`. Rules: `lost drive access: one message, never twice`; `a document deleted in Paperless: one message naming it`; `the notebook unreachable for six hours: one message`; `a message no channel took is sent next run, once`; `every message carries exactly one link`.
- [ ] Run, fail, implement, pass, commit.

### Task 8: F13 for notes, F18 with the new steps, F14

**Files:** Modify `lib/core/run.mjs`, `lib/commands/run.mjs` (summary line: `N noted`, `X of Y in the notebook`), `lib/core/context.mjs` (crash points `after-note`, `after-item`); Test `test/run.test.mjs`, `test/pipeline.test.mjs`.

- [ ] Tests: `F13: with a note batch of 2 and five documents the notes come 2 per run, "2 of 5 in the notebook"`; F18 kill test extended with `after-note` and `after-item` (one note and one item per document after the next run); F18 records deleted: no second note or item; F14 test extended: no note text in any file the Clerk keeps.
- [ ] Run, fail, implement, pass, commit.

### Task 9: Setup words, docs, full test, version

**Files:** Modify `lib/commands/setup.mjs` (notes, where they travel, the tag and the notebook's history), `README.md`, `docs/privacy.md`, `docs/architecture.md`, `CHANGELOG.md`, `package.json` (0.2.0), `test/full/full.mjs`, `test/full/README.md`, `.github/workflows/full.yml`.

- [ ] Test `setup says where notes travel, that the tag must be set first, and that the notebook's history keeps earlier versions`.
- [ ] Full test: a real notebook from `GODSPEED_NOTEBOOK_CHECKOUT` (own workspace, own port, own HOME, every `GODSPEED_*` cleared), a pretend Telegram API; F4 modes write every note; the kit: one note and one item per document, kept-out letter without note and with an item without title, rename keeps the person's line, tag added later trashes or shrinks, records deleted makes nothing twice, kills at `after-note` and `after-item`, exactly one message naming the blurry scan, none on the next run. Without the checkout the notebook checks are reported as not run.
- [ ] Run fast tests and the full test on the server; commit; push.
