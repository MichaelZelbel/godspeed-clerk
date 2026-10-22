# Privacy

A document's content lives in exactly three places: your Paperless, your Google Drive, and (from
the next version) your Godspeed notebook. To read a document, its text also goes to the AI you
chose, through Godspeed's own connection, for that one answer; what that provider keeps afterwards
is set by your own agreement with it.

## What the Clerk keeps

Everything is in one folder, readable by you only (files 600, folders 700): as root on Linux
`/var/lib/godspeed/clerk`, otherwise `~/.godspeed/clerk`.

- `settings.json`: your choices, and the facts from your profile that help sorting (`about`).
- `paperless.json`, `drive.json`: the two connections. They hold keys; keep them private.
- `plan.json`: the folder plan.
- `drive-tree.json`: the names of the folders inside your documents folder, kept between runs.
- `records/<number>.json`: one per document. Numbers, the mark, folder ids, a hash of the file
  name, times. Never a document's text, never its title.
- `clerk.log`: one line per step, naming documents by number only.
- `outbox.jsonl`: what you should hear about (a document to check, lost drive access), by number.

While it works on a document it holds it in memory; nothing is left in a temporary folder.

## What it never does

- Read, sort, copy or file a document another account owns on a shared Paperless.
- Send document text anywhere but the AI you approved.
- Follow an instruction written in a letter: the text is passed to the AI as data, and whatever the
  answer says, only the title, sender, type, tags and date can change, and only with names from
  your own lists.
- Delete anything in Paperless or in your drive.
