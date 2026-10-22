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
| `run.mjs` | One run: the steps over all documents, in batches and within a time limit. |
| `records.mjs` | One record per document, the log, the outbox. |
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
   documents folder is offered. The AI answers with exactly one path, `NEW` when it is sure the
   sender has none, or nothing when it is not sure. A new sender in Paperless then takes the name
   of the folder it chose.
2. Filing uses that choice; otherwise the folder this Paperless sender was filed into before;
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
  from the upload day. Without that it waits in "To sort", and no folder is made.
- Its file is named `<date> <title>.pdf`; while the title is still a scan's or a file's name,
  `<date> <type> <sender>.pdf`.
- A filed document's place is kept. A change to its title renames the file in place; only a change
  to what its folder depends on (type, sender, the tags the plan names, the year) asks where it
  goes, and only a sure answer moves it. An unsure answer keeps it where it is.
- The file itself carries where the Clerk last put it, and whether it was kept in "To sort" to be
  checked. With the records lost, that is the answer: no question, nothing moved.
