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
