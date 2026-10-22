# The Clerk

An add-on for [Godspeed Mission Control](https://github.com/MichaelZelbel/godspeed-mission-control).
It sorts the documents in your [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) and
files each one, named and sorted, into the right folder of your own Google Drive.

You scan a letter with your phone. Within ten minutes a searchable copy of it is in your drive, in
a folder called "To sort". Within the hour it has a real title, its sender, its type, its tags and
the date printed on it, and it sits in the folder you would have put it in yourself, named
`<date> <title>.pdf`.

**Status: version 0.1, the first batch.** It works with a Paperless you already run. Installing
Paperless for you, notes in Godspeed's notebook, deadlines from letters and the nightly restore
copy come in the next versions. The requirements it is built and tested against are in the Godspeed
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
("212 of 640 sorted").

## Commands

| Command | What it does |
| --- | --- |
| `setup` | Connects to your Paperless (reading only), names the AI, installs the background service, paused. |
| `connect` | Connects to Paperless again (a new address or account). |
| `ai`, `ai approve` | Shows, or approves, the AI that reads your documents. |
| `drive connect`, `drive finish`, `drive folder`, `drive status`, `drive disconnect` | The Google Drive connection. |
| `plan propose`, `plan show`, `plan confirm`, `plan set <file>` | The folder plan. |
| `run` | One run now. |
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
