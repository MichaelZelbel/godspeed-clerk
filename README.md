# The Clerk

An add-on for [Godspeed Mission Control](https://github.com/MichaelZelbel/godspeed-mission-control).
It sorts the documents in your [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) and
files each one, named and sorted, into the right folder of your own Google Drive.

You scan a letter with your phone. Within ten minutes a searchable copy of it is in your drive, in
a folder called "To sort". Within the hour it has a real title, its sender, its type, its tags and
the date printed on it, and it sits in the folder you would have put it in yourself, named
`<date> <title>.pdf`.

**Status: version 0.2, the second batch.** It works with a Paperless you already run, and
Godspeed knows your papers: every document gets a note in your notebook and an item in a
"Documents" collection, and you hear about what needs you. Installing Paperless for you,
deadlines from letters and the nightly restore copy come in the next versions. The requirements it is built and tested against are in the Godspeed
repository: `docs/proposals/paperless-addon.md`.

## What it does

- **Sorts** (when you let Godspeed sort, the default): for each new document (one that carries
  Paperless's inbox tag) your own AI, through Godspeed, reads the text and the Clerk sets a title,
  the sender, the type, tags and the date printed on the letter. Then it removes the inbox tag.
  - A title you typed stays. A date you set stays. A sender or type already there stays.
  - Tags are only ever added. "Tax 2024" means "needed for the 2024 tax return".
  - When it is not sure, the document gets the tag "Check this" and waits for you in "To sort".
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
- **Tells you only what needs you**: a paper it could not place, Google Drive no longer letting
  it file, a document deleted in Paperless, the notebook silent for hours. One short message per
  run at most, with one link, never twice about the same thing; nothing otherwise. On a server it
  comes through your assistant's own Telegram bot, on a computer as a notification. While a big
  pile is being sorted, the papers to check come together when it is done.
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
  anything. It may create senders, "Tax <year>" tags and the "Check this" tag, nothing else.
- **Google Drive**: Google is asked for access to your whole drive, because that is the only
  permission that can file into folders you already have. The Clerk itself reads and writes only
  inside the documents folder you name (and, from a later version, a folder of its own), renames
  or moves only files it made, and never deletes a file. Details: [docs/google-drive.md](docs/google-drive.md).
- **The AI**: only the one Godspeed already uses for you, through Godspeed's own connection. The
  setup names it and you approve it; if Godspeed later answers with another provider, the Clerk
  sends nothing until you approve that one too.
- **Your Godspeed notebook**: through its door on this computer only (127.0.0.1:47831), the same
  way the notebook's own screens write. It writes its notes (folder "Documents") and the
  collection "Documents", nothing else. A note it changes is written with the version it just
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
godspeed-clerk plan confirm
godspeed-clerk resume
```

`godspeed-clerk status` says where everything stands at any time, including how far a big pile is
("212 of 640 sorted, 180 of 640 noted"), whether the notebook answers, and where messages go.

**In your language.** Titles, tag names and the "To sort" folder follow your settings already. The
words in notes and messages are settings too (`texts`), so the assistant sets them once in your
language, for example `godspeed-clerk settings texts.kept_out_title "Dokument nicht im Notizbuch"`.
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
| `run` | One run now: first copies, sorting, filing, notes, the message. |
| `status` | Everything at a glance. |
| `pause`, `resume` | Stop and start the work. |
| `settings [<name> <value>]` | Show or change a setting. |
| `uninstall` | Removes the program and the service; keeps your records and every file. |

## Tests

```
node --test "test/*.test.mjs"
```

The fast tests use a pretend Paperless, a pretend Google Drive and recorded AI answers over a kit
of made-up documents. The full test runs a real Paperless-ngx in Docker: [test/full/README.md](test/full/README.md).

## License

MIT. Every document, name and address in this repository is made up.
