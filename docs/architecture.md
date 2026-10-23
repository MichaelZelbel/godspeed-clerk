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
| `notify.mjs` | One message per run for what the person can act on: the questions, each paper with its own link. |
| `questions.mjs` | A question for each paper to check (F19): its numbered choices, made from the AI's suggested places or the paper's sender. |
| `where.mjs` | The person's words for a folder: a number, "the second one", a name with a typo, a path, a link; outside refused. |
| `answers.mjs` | An answer applied (sender, "Check this" off, filed at once) and kept in the plan; `place` for rules said at any time. |
| `assistant.mjs` | What the person's assistant sees before each turn (`godspeed-clerk context`). |
| `../setup/assistant.mjs` | The recipe `skill/clerk` and the Hermes plugin `hermes/plugin/godspeed-clerk`, installed by setup. |
| `run.mjs` | One run: the steps over all documents, in batches and within a time limit. |
| `records.mjs` | One record per document, the log, the outbox. |
| `../channels/` | Where messages go: the assistant's own Telegram bot, this computer's notifications. |
| `context.mjs` | What a run needs, read fresh from the state folder. |
| `status.mjs`, `lock.mjs`, `settings.mjs`, `paths.mjs`, `files.mjs`, `names.mjs` | The rest. |

## One run

1. Read the account (`ui_settings/`), the tags, senders and types, and the list of documents the
   account owns (light fields only, oldest first).
2. First copies: each document without one gets the searchable PDF uploaded into "To sort" as
   `<upload day> <title>.pdf`, with the mark, and the size and checksum Google reports are compared
   with Paperless's own. Up to `copy_batch` per run.
3. Sorting, when Godspeed sorts: each document that still carries the inbox tag and has its first
   copy is read by the AI and sorted. Up to `batch_size` per run.
4. Filing: each document that is sorted (or, when Paperless or nobody sorts, no longer in the inbox
   or older than `settle_minutes`) is renamed to `<date> <title>.pdf` and moved into the folder the
   plan gives it. A document that changed in Paperless since it was filed is filed again.
5. Documents gone from Paperless: their files stay; the person hears it once.
6. Notes and the collection, for every document that is filed: its note, then its item, at most
   `note_batch` (50) per run. A note is written again only when what it is made from changed.
   When the notebook does not answer, this part waits; after `notebook_down_hours` the person
   hears it once.
7. One message for what the person can act on: the questions not asked yet (at most three open
   at a time), what is new in the outbox, no longer true or already said dropped, each paper with
   a link to its own file. While a pile still waits to be sorted, questions are held (at most a
   day) so they come together.

Before step 1, answers the person gave while the last run held the lock are applied (F19). After
filing (3), every paper whose status is "check this" and that has no question gets one.

The worker does one run every `interval_minutes` (3), and a run starts no new document after
`run_minutes` (5), so a new scan has its first copy within about ten minutes.

## Picking up where it stopped

Each step looks for its own earlier result first, writes an intent into the document's record
before it writes anywhere else, and records the result after. A step killed between its outside
write and its record is completed by the next run from what it finds:

- first copy: the file with the document's mark is found in the drive and checked;
- sorting: the document no longer carries the inbox tag, so it is not sorted again;
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

## Asking the person, and learning (F19)

A paper the Clerk cannot place gets one question in `questions.json`, made after filing, when its
file waits in To sort. Its choices: up to three places from one AI call over the paper's text and
the person's own folder names (the plan's folders and the likeliest sender folders; never anything
outside the documents folder), or, without a usable answer, a folder named like the paper's sender
and the folders whose names it shares; then "another folder: say which". A choice is a folder by its
id, or a new folder (a name and the folder it would be made in: where the plan keeps one folder per
sender, else the documents folder). The numbers run across all open questions, so two papers asked
at once never share one. An unreadable scan gets only "say which".

The message asks at most three at a time; the person's assistant sees them before each turn
(`godspeed-clerk context`, run by its Hermes plugin) with the exact command that answers each. The
assistant passes the person's words to `godspeed-clerk answer "<words>" --about <paper>`:

- a number or "the second one" picks a choice; a new folder offered as a choice is made when it is
  picked; "leave it" closes the question for good;
- words name a folder (`where.mjs`): its name in any case or with filler around it, a path, a
  Drive link. Exactly one folder: filed. Several of that name (one at the top of the documents
  folder wins), a typo (one or two letters, or two swapped), or what the AI reads in the words:
  added to the question as choices, never filed on a guess. No folder of that name: one more choice,
  and the question waits for "yes". Outside the documents folder (a link or a path leading out, or a
  name that exists only outside, which Google is asked about by exact name): refused.

Placing a paper (when Godspeed sorts): its sender is set when it has none (the one its sender
folder is named after, an existing one or a new one), "Check this" comes off, and `rec.answer`
makes the filing step move it there at once (`runOnce` for that paper alone). When Paperless or
nobody sorts, nothing is written into Paperless; the paper is filed all the same.

Learning: the folder is kept for the paper's sender. Inside that sender's own folder of the same
name, the link (`links.json`) is enough, since the plan sends it there anyway; anywhere else a rule
`{ sender, folder, folder_id }` goes to the top of the plan. Another open question about a paper
from the same sender is the same question and is answered with it. `godspeed-clerk place` takes the
same at any time: `--sender` (a sender rule), `--kind` (a rule `{ kind, folder, folder_id }`; the
sorting AI is told the person's kinds and names the one a paper is, kept in the record as a hash),
`--paper` (one paper moved, and learned like an answer). A rule names its folder by id, so a
folder the person renames or moves stays that folder.

An answer given while a run holds the lock (or while the Clerk is paused) waits in
`answers.jsonl`; the next run applies it first, and when it needs the person again (choices, a
yes), the question goes back into that run's message with its choices as they are now.

## Field by field (F7)

The sorting AI also names the fields it is unsure of (`unsure`). Not confident, but sure of the
sender, and that sender has a folder of the same name where the plan keeps sender folders, or a
Paperless sender of the same name: the paper gets that sender and is filed (into that folder, by
the plan's own rule for it); the fields it is unsure of are not set. An answer that names nothing it
is unsure of counts as unsure of everything, as before.
