# Changes

## 0.4.0 (batch 4: the installer, for everyone else)

- The install line installs Paperless on a Godspeed server that has none (F1): a size check first
  (memory free, disk, Docker), Paperless pinned to a tested version with memory limits, text reading
  in the person's language and English, its HTTPS address on the server's own name through the Caddy
  that gives Godspeed's notebook its address, the person's account with a password made for them and
  the second factor switched on, a starter set of document types and tags in their language, and the
  nightly restore copy. A Paperless already running here is offered instead of a second one.
- The phone (F2): `godspeed-clerk phone` gives the app, the address, the login and the second factor in
  plain words; the first scan that arrives is reported as connected, once.
- Keeping it running (F3), only on a Paperless the Clerk installed: updates only to tested versions,
  at night after a whole restore copy, with a copy of the database, the settings and the version
  first; a version that does not come up healthy is put back whole and told once. Restarted when it
  stops, a message when that does not help, a warning before the disk is full, its address put back
  when a Godspeed update took it away. `godspeed-clerk paperless status|update|check|password`.
- The restore copy and the rebuild (F9): every night the Clerk's own records, and on a Paperless it
  installed its full export, into the Clerk's own folder "The Clerk" in the drive, only what changed;
  never a Paperless where another account keeps papers. `godspeed-clerk restore` rebuilds Paperless
  on a new server from it: the same version first, every document, then the usual update.
- The To sort page in "Paperless sorts" and "nobody sorts" (F19's last bullet): a saved view of the
  papers without a storage path yet, in the sidebar and on the dashboard; the message links to it
  there too, never to the notebook's collection.
- Fixed: running the install line again (the update) paused a working Clerk; now only the first
  setup leaves it paused.
- The systemd service reads extra settings from `service.env` in the state folder.
- install.sh finds the Node.js Godspeed's own installer keeps in the Godspeed folder, and takes the
  Clerk from `GODSPEED_CLERK_TARBALL` when given; install.ps1 for Windows; INSTALL-FOR-ASSISTANTS.md.
- The machine test (test/machine): the install line on fresh Linux servers, a rebuild on another,
  an update forced to fail, a server too small.

## 0.3.3 (a dropped deadline leaves the note)

- A deadline the person dropped in Godspeed leaves the letter's note (its "Deadlines" part) and
  the Documents item's column, also when the records are lost and the note is read again. Found
  after deploying 0.3.2: a hotel booking's note still listed the cancellation deadline the person
  had dropped. A closed deadline stays listed: it was done.

## 0.3.2 (batch 3 fix round, after the first real paper with a date)

- Only what a letter asks the person to do becomes a deadline. A booking's, ticket's or order's
  cancellation, change, return or withdrawal terms are options: key facts only (a hotel booking's
  free-cancellation date had become "cancel the booking", for a trip being taken).
- A time limit before a date the letter prints counts from that date; "before your arrival" is the
  day before the arrival.
- No workable day: no deadline, no message, no "Check this" (a sorted paper had been put back to
  sort, and a message asked to tell the assistant a date); "date unclear" in the key facts and the
  Documents item.
- A deadline to check is one plain sentence with its day and the paper's title, linking to the
  paper in Paperless. No message links to the notebook's collection any more.
- Deadline names in the language the person talks to Godspeed in (setting `chat_language`).
- A deadline the person dropped or closed keeps no "Important" on its paper, and is never made
  again. "Important" is put on only in the run that makes the deadline, so a tag the person took
  off never comes back, also after lost records.
- The AI says whose terms an option is ("terms_of": booking, ticket, order, contract): a booking's,
  ticket's or order's term is never a deadline whatever its option flag, and notice on a contract
  that otherwise renews is a request though the AI called it an option. "Before" a printed date
  wins over a last day the AI wrote as that date (the day before arrival, not the arrival day).
- The check-the-date sentence names the letter's date it counted from and the paper as a person
  knows it (never a scan's file name); with more to say, each such sentence links to its paper.

## 0.3.1 (batch 2b: sort in Paperless, and the drive follows)

- A paper the Clerk cannot place is sorted in Paperless: with the person's yes, Paperless's storage
  path list holds their drive folders (one per folder of the plan, named like the folder, its
  template mirroring the drive, Auto matching; "To sort" never matched), and a saved view "To sort"
  (in the sidebar, on the dashboard, small cards with each first page) lists exactly the papers
  waiting. Picking a storage path moves the drive file at the next run, takes "Check this" off and
  keeps the folder for that paper's sender; a path the person makes becomes a folder inside the
  documents folder; picking a sender files a waiting paper too. When Godspeed sorts, the Clerk sets
  every paper's storage path itself (a paper waiting or placed at once, the papers filed before a
  few at a time). Asked first when Paperless has storage paths of its own; "no" leaves them alone,
  and the storage paths papers already have at the yes are never taken as picks. The "To sort" page
  comes with "Godspeed sorts" only; with "Paperless sorts" or "nobody sorts" the message links to
  the Documents collection, which lists exactly the papers waiting.
- The message for papers to sort is one line, "N papers are waiting to be sorted.", with one link
  to the To sort page.
- F7 judged field by field: a sender the AI is sure of, with a folder of its own or a Paperless
  sender of that name, is used even when the type, the tags or the title are unclear.
- `plan mirror`, `plan to-sort "<name>"` (renames To sort by its id), `settings reset <name>`.
- Fixed: the run's "to check" count no longer counts a paper the person resolved by hand; a plan
  that goes on below the sender (`Travel/{sender}/{year}`) no longer adds a second year folder.

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
