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

## Messages

A message names the papers it is about by their title and date, with a link to each paper's own
file in your drive, and goes only to you: your assistant's own Telegram bot, or this computer's
notifications (which say only that a paper needs your look, since they can show on a lock screen).
The Clerk keeps no copy of a message.

## Your assistant

The questions the Clerk asked you are shown to your assistant before each turn, so your "1" or
"the Travel folder" lands with the right paper: each paper's number and title (read from Paperless
at that moment, not kept anywhere), and the choices by folder name. Your assistant passes your words
to the Clerk's own command; it does not file or move anything itself.

When you name a folder that is not inside your documents folder, the Clerk asks Google whether a
folder of exactly that name exists elsewhere in your drive, only to tell you that it files inside
your documents folder alone. It never opens, reads or writes anything in such a folder.

## What the Clerk keeps

Everything is in one folder, readable by you only (files 600, folders 700): as root on Linux
`/var/lib/godspeed/clerk`, otherwise `~/.godspeed/clerk`.

- `settings.json`: your choices, the words of notes and messages in your language, and the facts
  from your profile that help sorting (`about`).
- `paperless.json`, `drive.json`: the two connections. They hold keys; keep them private.
- `plan.json`: the folder plan, with the rules you gave in the chat ("papers from <sender> go to
  <folder>", "<kind of paper> go to <folder>"): sender names, your words for a kind, folder names
  and ids.
- `questions.json`: the questions open for you: document numbers, the choices by folder id, the
  name of a new folder it offers (a sender's name, or what the paper is about), times. Never a
  title, never a sentence of a letter.
- `answers.jsonl`: an answer you gave while a run was going, until the next run applies it (then
  it is gone): your words and the paper's number.
- `drive-tree.json`: the names of the folders inside your documents folder, kept between runs.
- `records/<number>.json`: one per document. Numbers, the mark, folder ids, a hash of the file
  name, the note's id and hashes, times. Never a document's text, never its title, never its
  summary.
- `state.json`: the last run, whether Drive and the notebook answer, the collection's id, and
  which things you have already heard about, by number.
- `clerk.log`: one line per step, naming documents by number only.
- `outbox.jsonl`: what you should hear about (a document to check, lost drive access), by number.
- `run.lock`: while a run (or an answer of yours being filed) is going.

While it works on a document it holds it in memory; nothing is left in a temporary folder. The
summary an AI gives while sorting is kept in memory only until the document's note is written.

## What it never does

- Read, sort, copy, file or note a document another account owns on a shared Paperless.
- Send document text anywhere but the AI you approved and your own notebook.
- Follow an instruction written in a letter: the text is passed to the AI as data, and whatever the
  answer says, only the title, sender, type, tags and date can change, and only with names from
  your own lists.
- Delete anything in Paperless or in your drive, or a note in your notebook.
