# The Clerk

An add-on for [Godspeed Mission Control](https://github.com/MichaelZelbel/godspeed-mission-control).
It sorts the documents in your [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) and
files each one, named and sorted, into the right folder of your own Google Drive.

You scan a letter with your phone. Within ten minutes a searchable copy of it is in your drive, in
a folder called "To sort". Within the hour it has a real title, its sender, its type, its tags and
the date printed on it, and it sits in the folder you would have put it in yourself, named
`<date> <title>.pdf`.

**Status: version 0.3, the third batch.** It works with a Paperless you already run, Godspeed
knows your papers (every document gets a note in your notebook and an item in a "Documents"
collection), a letter's deadline becomes a Godspeed deadline, and you hear about what needs you.
A paper it cannot place you sort in Paperless itself, on its "To sort" page, and your drive follows.
Installing Paperless for you and the nightly restore copy come in the next versions. The requirements it is built and tested against are in the Godspeed
repository: `docs/proposals/paperless-addon.md`.

## What it does

- **Sorts** (when you let Godspeed sort, the default): for each new document (one that carries
  Paperless's inbox tag) your own AI, through Godspeed, reads the text and the Clerk sets a title,
  the sender, the type, tags and the date printed on the letter. Then it removes the inbox tag.
  - A title you typed stays. A date you set stays. A sender or type already there stays.
  - Tags are only ever added. "Tax 2024" means "needed for the 2024 tax return".
  - When it is not sure, the document gets the tag "Check this" and waits for you in "To sort".
    Being unsure is judged field by field: a sender it is sure of, with a folder of its own (or a
    sender of that name in Paperless), is used even when the type or the tags are unclear; only
    those are left for you.
- **Files**: every document gets a checked copy in "To sort" first, sorted or not, and is then
  renamed and moved into its folder according to your folder plan. Two papers with the same date
  and title become `name.pdf` and `name (2).pdf`; nothing is ever overwritten.
- **Follows your changes**: rename a document in Paperless and its file is renamed. Move or rename
  a file in the drive yourself and it is yours from then on: the Clerk never touches it again.
- **Tells Godspeed**: every document gets one note in your Godspeed notebook, in the folder
  "Documents": its sender, date, type, tags and folder, a two-sentence summary, the key facts
  (amounts, reference numbers, deadlines), links to Paperless and to the file in your drive, and
  its full text, so you can ask Godspeed "what did my insurer write in November?" and get the
  answer. The summary comes from the same AI answer that sorted the document; papers that were
  already sorted before the Clerk came get their note without one, so an archive of thousands
  costs no AI calls. Your notebook does not read these notes again for its own suggestions, so a
  pile of papers never holds your own notes back; search and Godspeed still find them. Write your own notes below the heading "Your notes" (or above the Clerk's
  part): the Clerk keeps them and only rewrites its own part. Notes travel wherever your notebook syncs, for example a private
  Git repository.
- **Keeps a list**: the collection "Documents" in your notebook has one item per document, with
  its date, title, sender, type, tags, folder, status ("sorted", "check this", "to sort", "kept
  out of the notebook"), whether its copy in the drive was checked, and links. "Did it do anything
  today?" is one look.
- **Keeps a paper out**: a document with your tag "Not in notebook" is still sorted and filed but
  gets no note, and its item in the list has no title. Set the tag before the note is written:
  added later, the Clerk takes its own text out of the note (the note goes to the notebook's trash
  when nothing of yours is in it, otherwise only your lines stay), but the notebook's history keeps
  the earlier versions.
- **Turns a letter's deadline into a Godspeed deadline**: "pay by 20 November" becomes a deadline
  in Godspeed, which reminds you as the day comes, the way it reminds you of any deadline; the
  Clerk sends no reminders of its own. Each request with a date is its own deadline, named by
  what it asks (in the language you talk to Godspeed in), with a link to the document.
  - Only what a letter asks you to do: pay, reply, object, send, sign, appear, contact. The
    cancellation, change, return or refund terms of a booking, a ticket or an order are options
    you may use, never a deadline; they go into the note's key facts.
  - A date written in the letter is taken as written; one written without a year is the next
    such day after the letter's date. A period ("within one month of this notice") is counted
    from the day the letter prints; one before a date ("at the latest six weeks before the lease
    ends on 31 December") is counted back from it, and "before your arrival on 26 October" is
    the day before that date. When it runs from a day the letter does
    not print (the day it reached you), the Clerk counts from the letter's own date, the earliest
    the day can be, and asks you to check the date. The upload day is never counted from.
  - A request whose day cannot be worked out from the letter: no deadline and no message; it goes
    into the note's key facts and the Documents list as "date unclear". Vague wording ("as soon as
    possible"): no deadline, the request goes into the note's key facts. A day already passed (an old letter from your pile): into the
    note's key facts, no deadline.
  - Each deadline is made once, however often the letter is read. Once you change or close one in
    Godspeed, it is yours: the Clerk never changes it again. When you correct a letter's date in
    Paperless, a deadline counted from it moves, unless you changed it.
  - When Godspeed sorts, the letter gets the tag "Important" until the day has passed; never again
    once you took it off, or dropped or closed the deadline.
  - Papers noted by an earlier version get their deadlines read once, a few at a time, without
    being sorted or filed again.
- **You sort in Paperless, and the drive follows**: Paperless's "storage path" list holds your own
  drive folders (one per folder of your plan, named like the folder, its file layout in Paperless
  mirroring the drive), and a "To sort" page (a saved view, in the sidebar, on the dashboard and in
  the phone app) shows exactly the papers waiting for you, each with a picture of its first page.
  Pick a storage path for a paper, and at its next run the Clerk moves the file into that folder,
  takes "Check this" off, and keeps the folder for that paper's sender, so the next paper from them
  goes there by itself. Paperless learns from your picks too (its own matching). A storage path you
  make yourself becomes a folder of that name inside your documents folder. Picking a sender files
  a waiting paper as well. When Godspeed sorts, the Clerk sets each paper's storage path itself, so
  Paperless and your drive always agree. If your Paperless already has storage paths of its own,
  you are asked first; with your "no" they stay as they are. The "To sort" page comes with
  "Godspeed sorts": with "Paperless sorts" or "nobody sorts" the Clerk writes nothing of a
  document, so no page in Paperless could list exactly the papers waiting; the message then links
  to the Documents collection in Godspeed, which does.
- **Tells you only what needs you**: papers waiting to be sorted, a deadline whose date needs a
  check, a letter with no date to count a period from, Google Drive no longer letting
  it file, a document deleted in Paperless, the notebook silent for hours. One short message per
  run at most, with one link, never twice about the same thing; nothing otherwise. Papers to sort
  are one line, "2 papers are waiting to be sorted.", and the link opens the "To sort" page (with
  "Paperless sorts" or "nobody sorts", the Documents collection). On a
  server it comes through your assistant's own Telegram bot, on a computer as a notification.
  While a big pile is being sorted, the papers to sort come together when it is done.
- **Picks up where it stopped**: a crash, a reboot or a lost connection at any step never leaves a
  second file or a half upload.

## Who sorts

`godspeed-clerk settings sorting <choice>`:

- `godspeed` (default): the Clerk sorts, as above.
- `paperless`: Paperless sorts (its own rules, or its own AI). The Clerk only files.
- `nobody`: nobody sorts. The Clerk only files.

With `paperless` and `nobody` the Clerk writes nothing at all into Paperless. That is enforced in
the code: there is no way for it to send a change.

## What it may touch

- **Paperless**: only documents your account owns. It signs in with your account's existing token;
  it never asks Paperless for a new one (that would sign your phone app out). It never deletes
  anything. It may create senders, "Tax <year>" tags and the "Check this" and "Important" tags,
  nothing else. "Important" it takes off again only when it put it on and the day has passed.
  With your yes it also keeps the storage paths that mirror your plan (and, when Godspeed sorts,
  the "To sort" page), and changes only those it made; with "Paperless sorts" and "nobody sorts"
  the storage paths are all it ever writes, never anything of a document.
- **Google Drive**: Google is asked for access to your whole drive, because that is the only
  permission that can file into folders you already have. The Clerk itself reads and writes only
  inside the documents folder you name (and, from a later version, a folder of its own), renames
  or moves only files it made, and never deletes a file. Details: [docs/google-drive.md](docs/google-drive.md).
- **The AI**: only the one Godspeed already uses for you, through Godspeed's own connection. The
  setup names it and you approve it; if Godspeed later answers with another provider, the Clerk
  sends nothing until you approve that one too.
- **Your Godspeed notebook**: through its door on this computer only (127.0.0.1:47831), the same
  way the notebook's own screens write. It writes its notes (folder "Documents"), the
  collection "Documents" and its own deadlines (through Godspeed's add-on deadlines), nothing
  else. A note it changes is written with the version it just
  read, so a note you save at that moment is never written over. It never deletes a note; it
  leaves one you deleted or put in the trash where you put it.

Privacy in detail: [docs/privacy.md](docs/privacy.md).

## Setting it up

You need Godspeed Mission Control, Node.js 22 or newer, a Paperless-ngx you can reach, and a
Google Drive. Your assistant does these steps with you; each is one command.

```
godspeed-clerk setup --paperless https://paperless.example --user alex   # reads only, starts paused
godspeed-clerk drive connect --client-file client_secret.json            # prints Google's page to open
godspeed-clerk drive finish "<the address your browser showed after Allow>"
godspeed-clerk drive folder "Paperwork"                                   # your documents folder
godspeed-clerk plan propose                                               # the folder plan, in plain words
godspeed-clerk plan confirm                                               # also: the storage paths and the "To sort" page
godspeed-clerk resume
```

`godspeed-clerk status` says where everything stands at any time, including how far a big pile is
("212 of 640 sorted, 180 of 640 noted"), whether the notebook answers, and where messages go.

**In your language.** Folder names and messages are in the language you talk to Godspeed in, not the
language of your papers. The words in notes and messages are settings (`texts`), so the assistant
sets them once in your language, for example `godspeed-clerk settings texts.kept_out_title
"Dokument nicht im Notizbuch"`; `godspeed-clerk settings reset texts` brings back the English ones.
`godspeed-clerk plan to-sort "To sort"` renames the To sort folder in your drive (its papers stay in
it), and its storage path and page follow. Titles and tag names follow your settings.
Messages go to `talk`: `["telegram"]` (your assistant's own bot; found by itself, or named with
`telegram_env`) or `["desktop"]`; unset, a server uses Telegram and a computer its notifications.

## Commands

| Command | What it does |
| --- | --- |
| `setup` | Connects to your Paperless (reading only), names the AI, installs the background service, paused. |
| `connect` | Connects to Paperless again (a new address or account). |
| `ai`, `ai approve` | Shows, or approves, the AI that reads your documents. |
| `drive connect`, `drive finish`, `drive folder`, `drive status`, `drive disconnect` | The Google Drive connection. |
| `plan propose`, `plan show`, `plan confirm`, `plan set <file>` | The folder plan. |
| `plan mirror [--storage-paths yes\|no]` | Paperless's storage paths and the "To sort" page, for a plan confirmed before; or your yes or no to them. |
| `plan to-sort "<name>"` | Renames the To sort folder in your drive; its papers stay in it. |
| `run` | One run now: first copies, sorting, filing, notes, the message. |
| `status` | Everything at a glance. |
| `pause`, `resume` | Stop and start the work. |
| `settings [<name> <value>]`, `settings reset <name>` | Show or change a setting, or take it back to its default. |
| `uninstall` | Removes the program and the service; keeps your records and every file. |

## Tests

```
node --test "test/*.test.mjs"
```

The fast tests use a pretend Paperless, a pretend Google Drive and recorded AI answers over a kit
of made-up documents. The full test runs a real Paperless-ngx in Docker: [test/full/README.md](test/full/README.md).

## License

MIT. Every document, name and address in this repository is made up.
