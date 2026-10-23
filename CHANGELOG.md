# Changes

## 0.3.0 (third batch, private trial)

- Deadlines from letters (F15): each request with a date becomes a Godspeed deadline, which
  Godspeed reminds about like any other, named by what it asks and linked to the document. A
  written date as written; a period from the day the letter prints; from a day it does not
  print, counted from its own date and marked "check the date". No date to count from: "Check
  this" and a message asking for it. Vague: into the key facts. Already passed: into the key
  facts. Each made once; once the person changed or closed one, never changed again; a corrected
  letter date moves an untouched one. "Important" while a day is ahead, when Godspeed sorts.
  A period before a printed date counts back from it; a date without a year is the next one after
  the letter's date; a time limit the AI could not read is asked for in its own words, never
  filed as vague.
- A paper sorted just before a crash is filed as if the run had not stopped: the sorting decision
  (a new sender's new folder too) is recorded before Paperless is changed (F18).
- A "Not in notebook" letter's deadline is named only by its title and date.
- The note shows its deadlines; the item's Deadlines column shows each day; the one message per
  run names deadlines to check and letters with no date to count from.
- Papers noted before get their deadlines read once, in batches, never sorted or filed again.
- Needs a Godspeed with add-on deadlines (product discussion #27); an older one gets one message
  and the deadlines come after its update.

## 0.2.1

- Every note is for search, not for the notebook's own processing (`skip_processing`): Godspeed
  still finds it, but a pile of papers no longer fills the notebook's 40-a-day queue for weeks
  ahead of the person's own notes. Notes written before get the mark at the next run, in one small
  update each.

## 0.2.0 (second batch, private trial)

- One note per document in the Godspeed notebook (folder "Documents"): fields, a two-sentence
  summary and the key facts from the answer that sorted it, links to Paperless and the drive, and
  the full text. The person's own lines below "Your notes" are kept; the archive is noted without
  an AI summary; a reinstall finds every note again.
- "Not in notebook": no note; added later, the Clerk's text comes out of the note (trash when
  nothing of the person's is in it, otherwise only their lines stay).
- The "Documents" collection: one item per document, with its status, folder and links; a kept-out
  document's item has no title.
- One message per run for what the person can act on, with one link, never twice: through the
  assistant's own Telegram bot or this computer's notifications. Papers to check found while a
  pile is sorted come together.
- Notes in batches with their progress ("180 of 640 noted"); every new step resumable.
- The words of notes and messages are settings, for the person's language.

## 0.1.0 (first batch, private trial)

- Connects to an existing Paperless-ngx with the account's own token, reading only during setup.
- Three sorting settings: Godspeed sorts, Paperless sorts, nobody sorts. With the last two nothing
  is ever written into Paperless.
- Sorting through Godspeed's own model connection, with an approved-provider check before any text
  leaves: title, sender, type, tags, the printed date; "Check this" when unsure.
- Google Drive: sign-in that works on a server, a folder plan proposed from the existing folders,
  a checked first copy in "To sort", filing as `<date> <title>.pdf`, same-name suffixes, renames
  and moves that follow Paperless, files moved by hand left alone, lost access held and noted.
- Every step resumable after a crash; marks on the drive files find them again without records.
- Logs and records hold numbers, marks and folders only, readable by their owner only.
