# The full test

A real Paperless-ngx 3.3.3 in Docker, the made-up kit rendered as scans and uploaded the way the
phone app sends them (named `Scan <day> <time>.pdf`, dated the upload day), a second account with a
document of its own, the Clerk run as its own process, a pretend Google Drive and recorded AI
answers. With a checkout of the Godspeed product, a real Godspeed notebook too, started for the
test in a folder of its own, and a pretend Telegram API for the messages. Everything is checked
through Paperless's API, the drive and the notebook's own record requests.

It covers F4 (both "only files" settings leave Paperless exactly as it was and still write every
note), F5 to F8 (every kit document as its expected-result file says, the folder plan, To sort
first, same names, changes in Paperless and by hand, a hand-placed file, a deletion, lost and
returned Google access), F10 (one note per document with its full text and links, the person's own
line kept through a rename), F11 (the letter uploaded with "Not in notebook" has no note; the tag
added later trashes a note or leaves only the person's line), F12 (the letter that tries to
instruct the AI), F14 (no sentence, title or summary in the logs, records or temporary files),
F16 (one message for the kit naming the blurry scan, none for a run with nothing new, one for a
deletion, one for lost access; one link each), F17 (one item per document, a kept-out item without
a title) and F18 (a real kill after each step, notes and items included, and in the middle of an
upload; the records deleted).

```
docker compose -f test/full/compose.yaml up -d
python3 test/kit/render.py test/kit/rendered     # needs Pillow
GODSPEED_NOTEBOOK_CHECKOUT=../godspeed-mission-control node test/full/full.mjs
docker compose -f test/full/compose.yaml down -v
```

`GODSPEED_NOTEBOOK_CHECKOUT` is a checkout of https://github.com/MichaelZelbel/godspeed-mission-control;
its notebook needs Node 22.13 or newer (it uses `node:sqlite`), named with `NOTEBOOK_NODE` when the
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
