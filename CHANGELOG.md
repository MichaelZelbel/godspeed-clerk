# Changes

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
