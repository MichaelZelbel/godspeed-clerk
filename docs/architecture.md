# How the Clerk is built

Node.js 22, no npm packages. `bin/godspeed-clerk.mjs` starts a command from `lib/commands/` (one
file each, found by the registry). The work lives in `lib/core/`:

| File | What it does |
| --- | --- |
| `paperless.mjs` | Paperless's REST API. Reading is free; writing exists only behind `writer("godspeed")`. |
| `sorter.mjs` | One document: the request to the AI, the hard check of its answer, what may change. |
| `model.mjs` | Godspeed's `godspeed-model`, and the check that the provider was approved. |
| `drive.mjs` | Google Drive v3, and `Confined`, the only way to write to it. |
| `oauth.mjs` | Google sign-in with PKCE, that also works on a server without a browser. |
| `plan.mjs` | The folder plan: proposing it from your folders, the rules, file names. |
| `pipeline.mjs` | The steps of one document: first copy, sorting, filing. |
| `notebook.mjs` | The Godspeed notebook's local door (`/api/query`, and `/mcp` for its web address). |
| `note.mjs` | The text of a note: the Clerk's part, and where the person's own lines begin. |
| `notes.mjs` | The note step: one note per document, the summary, "Not in notebook". |
| `documents.mjs` | The "Documents" collection: one item per document. |
| `deadlines.mjs` | A letter's requests: what the AI read, checked; the dates counted (never by the AI). |
| `deadline-step.mjs` | The deadlines in Godspeed: made once per request, the person's once touched, "Important". |
| `notify.mjs` | One message per run for what the person can act on; papers to sort are one line with the To sort page's link. |
| `mirror.mjs` | Paperless's storage paths that mirror the folder plan, and the "To sort" saved view (F19). |
| `learn.mjs` | A sender's folder kept from the person's pick, in the plan or as the sender folder's link. |
| `run.mjs` | One run: the steps over all documents, in batches and within a time limit. |
| `records.mjs` | One record per document, the log, the outbox. |
| `../channels/` | Where messages go: the assistant's own Telegram bot, this computer's notifications. |
| `context.mjs` | What a run needs, read fresh from the state folder. |
| `status.mjs`, `lock.mjs`, `settings.mjs`, `paths.mjs`, `files.mjs`, `names.mjs` | The rest. |

## One run

1. Read the account (`ui_settings/`), the tags, senders, types and storage paths, and the list of
   documents the account owns (light fields only, oldest first). With the person's yes, keep
   Paperless's storage paths and the "To sort" page level with the folder plan (F19).
2. First copies: each document without one gets the searchable PDF uploaded into "To sort" as
   `<upload day> <title>.pdf`, with the mark, and the size and checksum Google reports are compared
   with Paperless's own. Up to `copy_batch` per run.
3. Sorting, when Godspeed sorts: each document that still carries the inbox tag and has its first
   copy is read by the AI and sorted. Up to `batch_size` per run.
4. Filing: each document that is sorted (or, when Paperless or nobody sorts, no longer in the inbox
   or older than `settle_minutes`) is renamed to `<date> <title>.pdf` and moved into the folder the
   plan gives it, or into the folder its storage path stands for when the person (or Paperless's
   matching) picked one. A document that changed in Paperless since it was filed is filed again.
   When Godspeed sorts, each paper then carries its folder's storage path ("To sort" while it
   waits).
5. Documents gone from Paperless: their files stay; the person hears it once.
6. Notes and the collection, for every document that is filed: its note, then its item, at most
   `note_batch` (50) per run. A note is written again only when what it is made from changed.
   When the notebook does not answer, this part waits; after `notebook_down_hours` the person
   hears it once.
   Then its deadlines (F15): each request with a day becomes a Godspeed deadline through the
   product's add-on deadlines (`POST /api/functions/addon-deadlines` on the same door), listed
   once per run. A step that changed the paper in Paperless ("Important", "Check this") is
   followed by its note and item once more, so they say it in the same run.
7. One message for what the person can act on: the papers newly waiting to be sorted (counted, with
   the To sort page's link), what is new in the outbox, no longer true or already said dropped, one
   link. While a pile still waits to be sorted, they are held (at most a day) so they come together.

The worker does one run every `interval_minutes` (3), and a run starts no new document after
`run_minutes` (5), so a new scan has its first copy within about ten minutes.

## Picking up where it stopped

Each step looks for its own earlier result first, writes an intent into the document's record
before it writes anywhere else, and records the result after. A step killed between its outside
write and its record is completed by the next run from what it finds:

- first copy: the file with the document's mark is found in the drive and checked;
- sorting: the document no longer carries the inbox tag, so it is not sorted again, and the
  decision the intent recorded right before Paperless was changed (folder, sender folder, the
  date read) is kept;
- filing: the file is already where the intent said.

A file that is neither where the Clerk last put it nor where its intent said was moved or renamed
by the person, and is theirs from then on.

## The folder plan

A list of rules tried in order: by type, by sender, by tag, or everything else. A folder path may
end in `{sender}`, `{year}` or `{type}`; only those parts are ever made. `{year}` is the year of
the document's one tax-year tag, otherwise of its date. With no rule for a document, the AI picks
one of the plan's folders from its title, sender, type, tags and date; not sure, it stays in "To
sort".

## Sender folders

Many people keep one folder per sender, some with subfolders by topic or year. Those folder names
are the person's own list of senders, so a plan rule with `{sender}` is not filled in by name
alone (`lib/core/senders.mjs`):

1. While sorting, the AI sees the names of all the sender folders (up to about a thousand; above
   that the likeliest, by words and by initials such as "VKO"), and for the five likeliest also
   their subfolders, two levels deep, a folder of years written once as `<year>`. Subfolders are
   listed after all the names, so they never push a name off the list. Nothing outside the
   documents folder is offered, and never "To sort" itself. The AI answers with exactly one path, `NEW` when it is sure the
   sender has none, or nothing when it is not sure. A new sender in Paperless then takes the name
   of the folder it chose.
2. Filing uses that choice while the document still has the sender it was made for (a sender
   corrected in Paperless is decided afresh); otherwise the folder this Paperless sender was filed into before;
   otherwise a folder with the same name; otherwise the AI picks from the names again. Inside a
   known sender folder the AI picks among its own subfolders.
3. A folder is made only for a sender the AI is sure has none, and for a missing year among folders
   that are years. Unsure, or a choice that was not offered, means "To sort" and nothing made.

The same name, in code, means the same words once case, umlauts, legal forms and titles are set
aside; singular and plural count as the same only for generic words (Versicherung, Kasse, Bank,
Insurance, Services and the like). "Peters" is not "Petersen" and "Finanzamt Wendmark-Nord" is not
"Finanzamt Wendmark"; the AI decides those from the real names.

## When a document is filed, and when it moves

- A document is filed as soon as its folder can be decided from what the plan's rule needs (a
  type, a sender, a tag, a year), whoever sorted it and whatever its title. A year is never taken
  from the upload day, unless the Clerk's own sorting read that date off the letter (a letter
  dated the day it was scanned). A rule that fits but needs an unknown year makes the document
  wait; it does not fall through to a later catch-all.
- A sorted paper that cannot be placed is a visible "check this": the "Check this" tag when
  Godspeed sorts, and one notice in every setting. A paper nobody has sorted yet (no type, sender
  or tag) simply waits in "To sort".
- Its file is named `<date> <title>.pdf`; while the title is still a scan's or a file's name,
  `<date> <type> <sender>.pdf`.
- A filed document's place is kept. A change to its title renames the file in place; only a change
  to what its folder depends on (type, sender, the tags the plan names, the year) asks where it
  goes, and only a sure answer moves it. An unsure answer keeps it where it is.
- The file itself carries where the Clerk last put it, and whether it was kept in "To sort" to be
  checked. With the records lost, that is the answer: no question, nothing moved.

## The notes

One note per document, in the notebook folder "Documents". Its id comes from the document's mark
(`clerk-` and the start of the checksum Paperless keeps of the original) and its header carries
the mark (`source_app: godspeed-clerk`, `clerk_doc`, `clerk_sum`), so a reinstall, lost records or
a rebuilt Paperless find the same note, never a second one. A note the person deleted is never
made again (the notebook refuses its id); one in the trash stays there.

Every note carries `skip_processing: true`: the notebook finds it in search and gives it to the
assistant like any note, but its own processing (one note at a time, at most 40 a day, oldest
first) never takes it, so a pile of papers never holds the person's own notes back, and the summary
and key facts the Clerk already wrote are not paid for twice. A note written before the mark, or
one the Clerk otherwise leaves as it is (in the trash, changed inside its part), gets the mark and
nothing else in one update; the record keeps `marked`, so a quiet run asks the notebook nothing. A
notebook older than the mark ignores it and processes the notes as before.

The Clerk's part ends with its own heading ("Your notes", in the person's language, its words
kept in the header as `clerk_yours`); what the person writes below it, or above the part, is
theirs and is kept exactly. The notebook's editor writes notes back through its own Markdown
(which drops HTML comments, changes list markers and escapes), so the part is found by its
words: the header keeps `clerk_part`, a fingerprint of the part's words and numbers and how many
there are, and the part is the stretch of whole lines ending with the Clerk's heading that has
exactly that fingerprint. The full text sits in a fence longer than any run of backticks in it,
and every value from Paperless or the AI is one line, escaped only where the notebook's own
reader understands it, so nothing in a letter can look like the heading. A note whose Clerk's
part the person changed inside is left as it is; kept out, only its title, summary and key facts
come out, and the person hears it once.

Kept out (F11), the person's lines stay under the title "Document kept out of the notebook"; a
note with none goes to the notebook's trash (`clerk_trashed`), and comes back when the tag is
taken off again. What the notebook's own processing wrote about the letter (the fields it names
in `metadata.ai_fields`) comes out too. Suggestions that processing put in the notebook's review
queue from the letter (a note written before the mark) are withdrawn by the notebook itself when
the note goes to the trash or no longer holds the sentence they quote; they come back if the
note does.

The summary and key facts live in the note's header (`clerk_summary`, `clerk_facts`) and body,
and nowhere else. They come from the AI answer that sorted the document; a document the Clerk did
not sort gets one AI call for them, in batches, except the archive (sorted before the Clerk came)
and a paper to check.

Every write carries the version just read (`expected`), so a note or item the person saves at
that moment is refused by the notebook and kept; the Clerk tries again next run.

## Deadlines from letters

The AI reads a letter's requests once: in the answer that sorts it, otherwise in the note's
reading (the same request as the summary, so no extra call), and for a paper kept out of the
notebook in a reading of its own. It says for each request what to do, a date the letter writes,
or a period and what it counts from (the document's date, another printed date, or receipt). It
never counts a date: `deadlines.mjs` does.

- The day a period counts from is Paperless's date, unless that is the upload day nobody read
  off the letter or set since the Clerk first saw the paper; then the date the AI read; else none.
  A period before a printed date ("at the latest six weeks before the lease ends") counts back
  from it; "before" a printed date with no period is the day before it ("contact the property
  before your arrival"). A date written without a year is the next such day on or after the
  letter's date. A period from receipt (or any day the letter does not print) counts from the
  letter's date, the earliest the day can be, marked "check the date". No workable day (no date to
  count from, a time limit the AI saw but could not give): no deadline, no message, no "Check
  this"; the note's key facts and the item say "date unclear".
- Only what a letter asks the person to do is a request. The cancellation, change, return or
  withdrawal terms of a booking, a ticket or an order are options: the AI marks one it lists anyway
  with "option": true, and the Clerk leaves it out. A request's words are in the person's chat
  language (`chat_language`, else `language`).
- Months end on the same day number, or the month's last day (31 January plus a month is the end
  of February). A day already passed when the letter is read is not made; it goes into the note's
  key facts with the vague requests.
- Each deadline's key is the document's mark and the request's number: Godspeed makes one per key
  (the product's `tools/due.js`, `ADDON-KEY`), so a crash or lost records never make a second.
  Lost records are rebuilt from the note's header (`clerk_asks`), else from the deadlines
  Godspeed holds for the paper, and only then by reading it again.
- Godspeed says whether the person touched a deadline (changed its name or a date, closed or
  dropped it). Such a deadline is never moved or renamed by the Clerk again. A corrected letter
  date moves an untouched one counted from it; a "Not in notebook" tag added later renames an
  untouched one to the document's title and date (never a scan's file name, then "Letter", and
  never the upload day, then the letter's date), and it follows them when they change.
- The first reading stays the reading: once a note's header holds the requests, a letter read
  again changes nothing, so each deadline stays on its own request whatever order a new answer
  gives them in.
- "Important" (when Godspeed sorts) while one of the paper's deadlines, as Godspeed has it now, is
  still open and today or later; taken off after only when the Clerk put it on; never again once the person took
  it off or had set it themselves.
- Papers noted before deadlines were read get one reading each, in the notes' batches; the
  archive (sorted before the Clerk came) none.

## Sorting in Paperless (F19)

A paper the Clerk cannot place is sorted where Paperless is built for it. With the person's yes
(setting `storage_paths`; `plan confirm` decides it: yes when Paperless has no storage paths of its
own, else the person is asked; `plan mirror` does it for a plan confirmed before), `mirror.mjs`
keeps one Paperless storage path per place a paper can go into: every fixed folder of the plan,
every sender folder where the plan keeps one folder per sender (named like the folder; its path
below the documents folder when that name is taken), the folder before a `{year}` or `{type}` (the
rest of the pattern in the template), and "To sort". Each template mirrors the drive folder,
`<documents folder>/<path>/{{ created }} {{ title }}` (To sort: `{{ added }}`), so Paperless's own
files and the drive look alike. Each is set to Auto, so Paperless's classifier learns from the
person's picks; To sort is None, so Paperless never learns to put a paper there. A saved view "To
sort" (one rule: storage path is To sort; small cards, so each paper shows its first page) is
written with API 9, which puts `show_in_sidebar` and `show_on_dashboard` into the person's own UI
settings. Every run keeps them level: a folder the Clerk makes gets its path, a renamed or moved
folder's path gets its new name and template. Only the paths and the view the Clerk made are ever
changed (`mirror.json` says which, by number); nothing is deleted; a path the person deleted is not
made again, and so is a page the person deleted (the message then links to Paperless's list of the
papers with Check this); with the records lost, the Clerk's paths are found again by their templates
and the page by its rule on the Clerk's own To sort path. A path or view of the person's is never
changed: when one is called "To sort", the Clerk's takes the name "To sort (The Clerk)". The page is
made only when Godspeed sorts: then the Clerk gives every paper waiting the To sort path, so the page
lists exactly them. With "Paperless sorts" and "nobody sorts" the Clerk writes no document, so no
page could list exactly the papers waiting; there the message links to the collection, which does,
and the storage paths are the only writes, and only with the yes. A page made before such a switch
leaves the sidebar and the dashboard and lists nothing (storage path is To sort and not To sort)
until Godspeed sorts again.

When Godspeed sorts, a paper to check gets the To sort path in the same update that sorted it, so it
is on the page at once, and every paper the Clerk files gets its folder's path (a paper in a
subfolder, the nearest path above it). A paper waiting, or placed or moved in this run, gets its path
at once; the papers filed before the yes get theirs `copy_batch` at a time. The record keeps the
path the Clerk last saw or set (`sp`; at the yes, every paper starts from the path it has then, so
the person's own Paperless habits from before are never taken as picks; with the records lost, the
path of where the Clerk put the paper, so a pick made meanwhile still counts): a storage path different
from it was picked in Paperless, by the person or Paperless's matching, and is followed in every
setting: the file moves into that
path's folder, "Check this" comes off (when Godspeed sorts), and the paper's sender is kept for that
folder (`learn.mjs`: the sender's own same-named folder's link, else a rule `{ sender, folder,
folder_id }` at the top of the plan). A paper without a sender gets one AI look at who sent it; the
sender is set and learned only when the AI is sure, and never named after the folder. A storage path
the Clerk did not make becomes a folder of its name inside the documents folder (where the plan keeps
sender folders, else at its top). Picking a sender (also with "no") files a waiting paper by the
plan and takes "Check this" off; a sender whose folder is learned files that sender's waiting
papers, and a new paper of that sender the AI is unsure of, in the run that sorts it, never another
sender's. Set back to To sort, a paper waits there again.

The message counts the papers waiting to be sorted (to check, not filed elsewhere): one line with
the To sort page's link (without the page, Paperless's list of the papers with Check this), said
once for every wait (keyed by the paper's sorting).
