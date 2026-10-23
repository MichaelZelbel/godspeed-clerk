# Changes

## 0.2.2 (batch 2b: answer in the chat, and the Clerk learns)

- A paper the Clerk cannot place comes to the person as a question in their chat: its title and
  date, a link to its own file in the drive, up to three numbered places (their folders, or a new
  folder named after the sender) and "another folder: say which". At most three open at a time.
- The person answers their assistant with the number or in their own words; `godspeed-clerk
  answer` files the paper at once, takes "Check this" off, gives it a sender when it had none, and
  keeps the folder for that sender. A typo or several folders of that name become choices; a folder
  that is not there is made after a yes; a folder outside the documents folder is refused.
- `godspeed-clerk place`: "X papers go into Y", "hotel bookings go into Travel", "the hotel booking
  goes into Travel", at any time; kept in the folder plan.
- The assistant's door, the Wingman's way: the recipe `skill/clerk` and a Hermes plugin that shows
  the open questions before each turn (`godspeed-clerk context`), installed by setup or
  `godspeed-clerk assistant install`.
- F7 judged field by field: a sender the AI is sure of, with a folder of its own or a Paperless
  sender of that name, is used even when the type or the tags are unclear.
- Messages link each paper to its own file in the drive, never to a list; every word is a setting.
- `godspeed-clerk plan to-sort "<name>"` renames the To sort folder by its id; `godspeed-clerk
  settings reset <name>` takes a setting back to its default.
- Fixed: a plan that goes on below the sender (`Travel/{sender}/{year}`) no longer adds a second
  year folder; the run's "to check" count no longer counts papers resolved by hand.

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
