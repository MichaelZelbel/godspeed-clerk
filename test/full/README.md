# The full test

A real Paperless-ngx 3.3.3 in Docker, the made-up kit rendered as scans and uploaded the way the
phone app sends them (named `Scan <day> <time>.pdf`, dated the upload day), a second account with a
document of its own, the Clerk run as its own process, a pretend Google Drive and recorded AI
answers. With a checkout of the Godspeed product, a real Godspeed notebook too, started for the
test in a folder of its own, and a pretend Telegram API for the messages. Everything is checked
through Paperless's API, the drive and the notebook's own record requests.

The optional-Drive story starts without a Google app or folder plan, writes notes, Documents
items and normal deadlines through the real notebook, then connects Drive and confirms that the
same records gain filed-copy links without duplicates. Its nobody-sorts setting keeps the kit
unchanged for the remaining stories; the public-server phone test covers default AI sorting
before Drive is connected (`test/public/README.md`, `phone.mjs --optional-drive`).

It covers F4 (both "only files" settings leave Paperless exactly as it was and still write every
note), F5 to F8 (every kit document as its expected-result file says, the folder plan, To sort
first, same names, changes in Paperless and by hand, a hand-placed file, a deletion, lost and
returned Google access), F10 (one note per document with its full text and links, the person's own
line kept through a rename), F11 (the letter uploaded with "Not in notebook" has no note; the tag
added later trashes a note or leaves only the person's line), F12 (the letter that tries to
instruct the AI), F14 (no sentence, title or summary in the logs, records or temporary files),
F16 (one message for the kit counting the papers to sort with the To sort page's link and naming
the letters whose deadlines need a check, none for a run with nothing new, one for a deletion, one
for lost access; one link each), F19 (with "no", storage paths and saved views unchanged; with the
yes, one storage path per plan folder mirroring the drive and Auto matching except To sort, every
filed paper carrying its folder's path, the "To sort" view in the sidebar and on the dashboard
listing exactly the papers waiting; a storage path picked through Paperless's API moves the file,
takes Check this off and takes the paper off the page; a storage path the person makes becomes a
folder inside the documents folder), F17 (one item per document, a kept-out item without
a title) and F18 (a real kill after each step, notes, items and deadlines included, and in the
middle of an upload; the records deleted).

F15 runs through the product's real add-on deadlines (`POST /api/functions/addon-deadlines`,
`tools/due.js` in the checkout): the letter with a future date makes one deadline with the right
date and a link, an ordinary file in the notebook's `due/`; two requests make two; a period from
receipt makes one counted from the printed date and marked "check the date"; a vague request and
a passed date make none and go into the note's key facts; no date to count from makes none and
the letter is to check; the kept-out letter's deadline is named by its title and date; the
product's own reminders (`tools/due.js today`) say it as its day comes; a corrected letter date
moves an untouched deadline; one the person moved by hand keeps the person's date, also through a
corrected date and lost records; both "only files" settings make the same deadlines. The Clerk
counts from 22 October 2026 (`GODSPEED_CLERK_TODAY`, test mode only), the day the kit's letters
are written for.

`CLERK_PREVIOUS`, a checkout of an earlier Clerk (0.2), makes "Godspeed sorts" an upgrade: that
version sorts, files and notes the kit first, then this one takes over. It checks that each paper
is read once for its deadlines, that nothing is sorted or filed again, and that what needs a check
comes as one message.

```
docker compose -f test/full/compose.yaml up -d
python3 test/kit/render.py test/kit/rendered     # needs Pillow
GODSPEED_NOTEBOOK_CHECKOUT=../godspeed-mission-control node test/full/full.mjs
docker compose -f test/full/compose.yaml down -v
```

`GODSPEED_NOTEBOOK_CHECKOUT` is a checkout of https://github.com/MichaelZelbel/godspeed-mission-control,
beside this folder and never inside it (its CommonJS tools would take this folder's package.json,
which says ES modules, for theirs, and the notebook would not start); its notebook needs Node 22.13 or newer (it uses `node:sqlite`), named with `NOTEBOOK_NODE` when the
test runs on another. Without the checkout the notes, the collection and the messages are reported
as not run, and the Clerk is given an address where nothing answers, so it can never reach a
notebook that belongs to someone.

`CLERK_TEST_PORT` moves Paperless to another port (then set `PAPERLESS_URL` to match), and the
compose project name (`docker compose -p <name>`) keeps it apart from a Paperless already running
on the same machine. Without Pillow on the machine, render inside the Paperless image:

```
docker run --rm --entrypoint python3 -v "$PWD:/kit" -v /usr/share/fonts:/usr/share/fonts:ro \
  ghcr.io/paperless-ngx/paperless-ngx:3.3.3 /kit/test/kit/render.py /kit/test/kit/rendered
```

A run with a real AI instead of the recorded answers, before a release, is not automated yet: it
would judge only what must be exact (date, type, folder, tags).
