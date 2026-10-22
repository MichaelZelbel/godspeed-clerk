# The full test

A real Paperless-ngx 3.3.3 in Docker, the made-up kit rendered as scans and uploaded the way the
phone app sends them (named `Scan <day> <time>.pdf`, dated the upload day), a second account with a
document of its own, the Clerk run as its own process, a pretend Google Drive and recorded AI
answers. Everything is checked through Paperless's API and the drive.

It covers F4 (both "only files" settings leave Paperless exactly as it was), F5 to F8 (every kit
document as its expected-result file says, the folder plan, To sort first, same names, changes in
Paperless and by hand, a hand-placed file, a deletion, lost and returned Google access), F12 (the
letter that tries to instruct the AI), F14 (no sentence or title in the logs, records or temporary
files) and F18 (a real kill after each step and in the middle of an upload; the records deleted).

```
docker compose -f test/full/compose.yaml up -d
python3 test/kit/render.py test/kit/rendered     # needs Pillow
node test/full/full.mjs
docker compose -f test/full/compose.yaml down -v
```

`CLERK_TEST_PORT` moves Paperless to another port (then set `PAPERLESS_URL` to match), and the
compose project name (`docker compose -p <name>`) keeps it apart from a Paperless already running
on the same machine. Without Pillow on the machine, render inside the Paperless image:

```
docker run --rm --entrypoint python3 -v "$PWD:/kit" -v /usr/share/fonts:/usr/share/fonts:ro \
  ghcr.io/paperless-ngx/paperless-ngx:3.3.3 /kit/test/kit/render.py /kit/test/kit/rendered
```

A run with a real AI instead of the recorded answers, before a release, is not automated yet: it
would judge only what must be exact (date, type, folder, tags).
