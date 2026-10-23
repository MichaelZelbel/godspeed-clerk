# The Clerk, batch 2b: answer in the chat, and the Clerk learns

**Goal:** a paper the Clerk cannot place reaches the person as a short question with numbered
choices, in the chat they already use; they answer with a number or in plain words through their
assistant, and the paper is filed; the Clerk remembers the answer in the folder plan, so the same
question is never asked twice. Plus three fixes the first real "Check this" message exposed: being
unsure is judged field by field (F7), the message links to the paper's own file in the drive (F16),
and the Clerk's words and its "To sort" folder are in the language the person talks to Godspeed in.

**Spec:** `docs/proposals/paperless-addon.md` in MichaelZelbel/godspeed-mission-control at
`c9b22aa7`: F7 (judged field by field), F16 (each paper by its title with a link to its own file),
F19 (answer in the chat, and the add-on learns). Their *Test:* lines are the acceptance tests.

**Architecture.** Three new pieces and one door:

- `lib/core/questions.mjs`: one open question per paper to check, in `questions.json` in the state
  folder. Its choices are numbered across all open questions (two papers in one message never
  share a number). A choice is a folder that exists (by id), a new folder (a name and the folder it
  is made in), or "another folder: say which"; it may carry the sender it stands for. Made by the
  run for every paper whose status is "check this", from one AI call over the paper's text and the
  person's folder names (the likeliest places), or, without an AI, from the paper's sender and the
  folder names alone. Closed when the paper is no longer to check.
- `lib/core/where.mjs`: the person's words for a folder ("1", "the second one", "the Travel
  folder", "put it with my travel stuff", a typo, a path, a Drive link) turned into a folder inside
  the documents folder, several to choose from, a new folder to make after a yes, or a refusal for
  a folder outside the documents folder.
- `lib/core/answers.mjs`: applying an answer to a paper (sender, "Check this" off, filed into that
  folder) and learning from it (a sender rule in the plan, or the sender's link to its folder); the
  `answer` and `place` commands, and answers saved while a run holds the lock, applied by the next
  run.
- The door, the Wingman's way: a recipe `skill/clerk/SKILL.md` and a Hermes plugin
  `hermes/plugin/godspeed-clerk` that shows the assistant the open questions before each turn
  (`godspeed-clerk context`), installed by `godspeed-clerk assistant install` (which `setup` runs).

## Decisions made while planning

- **The message names each paper with its own link** (F16): its file in the drive, else its page in
  Paperless. No message links to a list any more. A message asks at most three papers; the rest are
  counted, and asked once those three are answered, so a pile never becomes a wall of text.
- **Field by field (F7):** the AI answers `unsure`, the fields it is not sure of. With
  `confident: false` and a sender it is sure of that has a folder of the same name (or a Paperless
  sender of the same name), the paper gets that sender and is filed; the fields it is unsure of are
  not set. An answer without `unsure` is treated as before (unsure of everything).
- **Learning:** an answer that gives a paper a sender teaches the folder for that sender: a sender
  rule at the top of the plan, unless the folder is the sender's own folder of the same name (then
  the link alone). "Hotel bookings go into Travel" is a kind rule, given to the AI while sorting.
- **Outside the documents folder:** a Drive link or a path that leads outside is refused, and so is
  a bare name that exists only outside (the Clerk asks Google for folders of exactly that name, to
  say so; it never opens or writes there). A name found nowhere becomes "make it in the documents
  folder?", made only after the yes.
- **The person's words, not titles, in the records:** `questions.json` holds numbers, folder ids and
  the names of senders and folders (as the plan does), never a title or a sentence of a letter. The
  assistant's block reads each paper's title from Paperless at that moment.

## Tasks

1. F7 field by field: `unsure` in the answer, `decide` and `sortStep` (tests in `sorter.test.mjs`,
   `pipeline.test.mjs`: "a ticket whose type the AI is unsure of, from a sender that has a folder of
   its own, is filed into that folder").
2. Folder words (`where.mjs`): numbers, ordinals, yes and no, names, paths, links, typos, the AI's
   pick, outside, missing (`where.test.mjs`).
3. Questions (`questions.mjs`) and the run's ask step (`questions.test.mjs`).
4. Answers and learning (`answers.mjs`), the filing step honouring an answer, sender and kind
   rules in the plan (`answers.test.mjs`, F19's four acceptance tests).
5. The message (`notify.mjs`): questions, a link per paper, English words, at most three asked.
6. Commands: `answer`, `place`, `context`, `plan to-sort`, `settings reset`, `assistant`.
7. The recipe and the Hermes plugin, installed by `assistant install` and `setup`.
8. The full test: the question in the pretend Telegram, `context`, then `answer` through the real
   command, words, the outside refusal, a learned sender.
9. Docs, version, deploy.

## Michael's server

- Settings back to English (`settings reset texts`), the To sort folder renamed by its id
  (`plan to-sort "To sort"`), Paperless tag names unchanged.
- The recipe into `/root/godspeed/skills/clerk`, the plugin into the v2 Hermes home, the gateway
  restarted once.
- Document 10 (the hotel booking) gets the first real question; exactly one message for it.
