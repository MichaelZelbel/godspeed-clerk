# Privacy

A document's content lives in exactly three places: your Paperless, your Google Drive, and your
Godspeed notebook. To read a document, its text also goes to the AI you chose, through Godspeed's
own connection, for that one answer; what that provider keeps afterwards is set by your own
agreement with it.

## The notebook

Every document you do not keep out gets one note in your notebook: its fields, a short summary,
the key facts, links, and its full text. The notebook keeps it where it keeps every note, and it
travels wherever your notebook syncs, for example a private Git repository. Your assistant's
search sees the notes, so it can answer questions about your papers.

The tag "Not in notebook" (your own name for it, in the settings) keeps a document out: no note,
and its item in the "Documents" collection has no title, only when it was added, its folder and
its status. Set the tag before the note is written. Added later, the Clerk takes its own text out
of the note (title, summary, key facts, full text, links): the note goes to the notebook's trash
when nothing of yours is in it, otherwise only your own lines stay, under the title "Document kept
out of the notebook". The notebook's history, and the Git repository it syncs to, keep the earlier
versions; the Clerk never rewrites history.

## Deadlines

A letter's request with a date becomes a deadline in your Godspeed (its `due/` folder, which
travels the way your mission control folder does): what it asks, in a few words, its day and a
link to the document in Paperless. For a letter kept out of the notebook, only its title and date
name the deadline. The Clerk's records keep the days and which request it is, never the words.

## Messages

A message names the papers it is about by their title and date, and goes only to you: your
assistant's own Telegram bot, or this computer's notifications (which say only that a paper needs
your look, since they can show on a lock screen). The Clerk keeps no copy of a message.

## What the Clerk keeps

Everything is in one folder, readable by you only (files 600, folders 700): as root on Linux
`/var/lib/godspeed/clerk`, otherwise `~/.godspeed/clerk`.

- `settings.json`: your choices, the words of notes and messages in your language, and the facts
  from your profile that help sorting (`about`).
- `paperless.json`, `drive.json`: the two connections. They hold keys; keep them private.
- `plan.json`: the folder plan, with the senders whose papers you put into a folder by picking a
  storage path ("papers from <sender> go to <folder>"): sender names, folder names and ids.
- `mirror.json`: which Paperless storage path stands for which folder (numbers and folder ids), and
  the "To sort" page's number.
- `drive-tree.json`: the names of the folders inside your documents folder, kept between runs.
- `records/<number>.json`: one per document. Numbers, the mark, folder ids, a hash of the file
  name, the note's id and hashes, times, and a letter's deadline days. Never a document's text,
  never its title, never its summary, never what a letter asks.
- `state.json`: the last run, whether Drive and the notebook answer, the collection's id, and
  which things you have already heard about, by number.
- `clerk.log`: one line per step, naming documents by number only.
- `outbox.jsonl`: what you should hear about (a document to check, lost drive access), by number.
- `installed.json`: the Paperless the Clerk installed: its folder, version, port and address.
- `login.json`: that Paperless's login, made at the install: your account name, the password, the
  second factor's setup key and the recovery codes, so the Clerk can tell you again how to connect
  your phone. `godspeed-clerk phone --forget` takes all of that out once you have saved it.
- `restore-index.json`: which file of the restore copy is in your drive, by path and checksum.
- `service.env`: settings for the background service, if you add any (none by default).

## A Paperless the Clerk installed

It lives in `/opt/godspeed-clerk/paperless`, readable by root only: its secrets (`paperless.env`:
Paperless's own key and its database password), its database and documents (`data/`), its nightly
export (`export/`, every document with its text, for the restore copy), and the copies an update
keeps of the database (`backups/`). Paperless listens on this server only; the outside reaches it
through its HTTPS address.

## The restore copy

Every night the folder "The Clerk" in your drive gets the Clerk's records (`records/clerk-records.json`:
its settings, your folder plan, and per document numbers, marks, folder ids and links, never a
document's text or title), and, on a Paperless the Clerk installed, Paperless's complete export
(`paperless/`): every document's file, and a manifest with every title, tag, date and the documents'
text, your account with its password's hash and its second factor. It is a copy of what your
Paperless holds, in your own drive; anyone who can open your drive can open it. A Paperless where
another account keeps papers is never exported.

While it works on a document it holds it in memory; nothing is left in a temporary folder. The
summary an AI gives while sorting is kept in memory only until the document's note is written.

## What it never does

- Read, sort, copy, file or note a document another account owns on a shared Paperless.
- Send document text anywhere but the AI you approved and your own notebook.
- Follow an instruction written in a letter: the text is passed to the AI as data, and whatever the
  answer says, only the title, sender, type, tags and date can change, and only with names from
  your own lists.
- Delete anything in Paperless or in your drive, or a note in your notebook.
