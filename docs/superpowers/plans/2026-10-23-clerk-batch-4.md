# The Clerk, batch 4 Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax for tracking. Test first: every new test is seen failing before the code that makes it pass.

**Goal:** A Godspeed user without Paperless adds the Clerk with one line and ends with a running, secured Paperless (HTTPS on the server's own name, their login with a second factor), the starter types and tags in their language, the phone app connected, a nightly restore copy in their drive, and updates that never lose a document. A Paperless the Clerk did not install stays its owner's.

**Spec:** `docs/proposals/paperless-addon.md` in MichaelZelbel/godspeed-mission-control (main `cbe871c4`): F1 (install path), F2, F3, F9, F19's last bullets, sections 4, 5, 6 and 12. Their *Test:* lines are the acceptance tests.

## What Paperless 3.3.3 does (read from its source and tried on a throwaway stack, 23 October 2026)

- `POST /api/token/` takes `code` and refuses without it once the account has the second factor ("MFA code is required"); it hands back the account's one token, made only when there is none. Sign-ins are throttled at 5 a minute per sender (`PAPERLESS_TOKEN_THROTTLE_RATE`); behind a proxy DRF reads `X-Forwarded-For`, and allauth's web sign-in limit does with `PAPERLESS_ALLAUTH_TRUSTED_PROXY_COUNT=1`.
- `GET /api/profile/totp/` makes a secret; `POST /api/profile/totp/ {secret, code}` checks the code against that secret (no session needed) and switches the second factor on, answering ten recovery codes. The installer makes the secret itself and works out the code (RFC 6238), so the second factor is on before anyone signs in.
- `document_exporter <dir> --no-progress-bar -d -c -nt -p`: `originals/`, `archive/`, `manifest.json` (every document's fields and text, users with password hashes, the second-factor authenticators, no tokens) and `metadata.json` (`{"version": "3.3.3"}`). `document_importer <dir>` into an empty Paperless brings back documents with their numbers, the account with its password and second factor; no token. Importing twice fails (files exist).
- A saved view rule `{rule_type: 25, value: null}` is "no storage path" (the web page's `storage_path__isnull`).
- 3.2.1 to 3.3.3 adds three migrations (one a new table): an update between them changes the database, which is what F3's test needs.
- The stack at rest: webserver about 0.9 GB, Postgres 60 MB, Valkey 5 MB; images 4.3 GB on disk.

## Decisions taken here (the PRD leaves them open)

- The stack is the hand install's (22 October): Paperless pinned to an image digest, Postgres 18, Valkey 9, memory limits 1600m / 384m / 128m, one worker each, text reading in the person's language and English, AI off in Paperless, files under `/opt/godspeed-clerk/paperless` (bind mounts, so a database copy is a folder copy while stopped), port on 127.0.0.1 only.
- The address: the Clerk adds `<server name>:48444` to the Caddy that already gives Godspeed's notebook its address (Godspeed's own `godspeed-https.service`, or the server's Caddy), with one `import` line and a site file of its own, the way the notebook adds itself to a server's Caddy. Same name, same certificate. A Godspeed update that rewrites its own Caddyfile drops the line; the worker puts it back within the hour. No Caddy at all: the Clerk says Godspeed's installer gives the server its address first. (Asked for in the product as a feature: a folder of add-on sites the notebook's Caddyfile imports.)
- The login: the person's name (`--user`), a generated password (five groups of four letters and digits, easy to type on a phone), the second factor on, recovery codes. Kept in the private state folder until `godspeed-clerk phone --forget`.
- Starter set in the person's chat language (English, German, French, Spanish, Italian, Dutch): nine document types, the inbox tag, "Tax <year>" for the last three years, health, and the Clerk's own tags; the Clerk's tag settings and "To sort" follow.
- The restore copy goes to the Clerk's own folder at the top of the drive ("The Clerk"), only on a Paperless it installed and only while no other account owns documents there; the Clerk's records go there on every Paperless. Uploads only files whose checksum changed, a few minutes per run, the manifest and `restore.json` last. Runs once a night after `copy_hour` (2) while the Clerk is active.
- Updates: only to a version in `lib/install/versions.mjs`. First a fresh restore copy, then the new image pulled while the old runs, then stop, copy of the database folder, the search index folder, the compose file, the settings file and the version, then the new version. Not healthy within ten minutes (the API answers with the new version, the same number of documents, a document downloads): everything put back and started; the person hears it once. The worker updates at night after a successful copy; `godspeed-clerk paperless update` does it now.
- Keeping it running (every worker loop, also while paused): the API not answering twice in a row: `docker compose up -d`; still down after 30 minutes: one message. Disk under 3 GB or 5 percent free: one message per low stretch.
- 2b open item: in "Paperless sorts" and "nobody sorts" the To sort page is the saved view "no storage path" (in the sidebar and on the dashboard); the message links to it; without the yes, to Paperless's list with the same filter. Two earlier tests that said "no page in these settings" follow the PRD now.

## Tasks

- [ ] T1 2b open item: `mirror.mjs` view rule by setting, `viewLink` in every setting, the fallback link; tests in `test/sort-in-paperless.test.mjs`; ROUND2 3 and the full test's "paperless" check follow F19's last bullet.
- [ ] T2 `lib/install/totp.mjs` (RFC 6238) - done first, used by the experiments.
- [ ] T3 `lib/install/room.mjs`: measure memory (cgroup limit too), disk, Docker, Compose, architecture, root; `roomCheck` names what is missing in plain words.
- [ ] T4 `lib/install/versions.mjs`, `stack.mjs` (compose file and settings file, language codes), `starter.mjs`.
- [ ] T5 `lib/install/https.mjs`: find Godspeed's Caddy and the server name, the site file and the import line, put back when gone, the address check.
- [ ] T6 `lib/install/host.mjs`: install, health, keep running, disk, owners, export, import, update with rollback; a runner the tests replace.
- [ ] T7 `lib/core/restore.mjs`: the Clerk's own folder, the nightly copy, the rebuild; `Drive.upload` takes a content type.
- [ ] T8 Commands: `setup` install path, `paperless status|update|check|password`, `phone [--forget]`, `copy`, `restore`; the worker's keep-running and nightly steps; `status` lines; the systemd unit reads `service.env`; F2's "connected" message.
- [ ] T9 `install.sh` finds Godspeed's own Node and takes `GODSPEED_CLERK_TARBALL`; `install.ps1`; README, INSTALL-FOR-ASSISTANTS, architecture, privacy, CHANGELOG; version 0.4.0.
- [ ] T10 Fresh machines (`test/machine/`): systemd and Docker in a container per machine, Godspeed's HTTPS front made with the product's own installer functions, a test certificate authority (Pebble) issuing real ACME certificates for the test names, the pretend drive, the real notebook and a pretend Telegram outside the machines so they outlive machine A. Machines: A (all defaults, the kit, the phone, the copy, a second account), B (rebuild from A's copy), C (3.2.1, German, forced failed update, then the update, a stopped Paperless), D (too little memory).
- [ ] T11 Full Docker test and fast tests green; independent reviewer installs from the README on a fresh machine and attacks update and restore; fix until yes.

## Not proven by machines (said in the report)

- A certificate from Let's Encrypt itself on a public name: the test certificates come from Pebble, Let's Encrypt's own test server, over the same ACME steps, on names only the test network knows.
- The download from GitHub while the repository is private: the machines get the same tarball from a test server (`GODSPEED_CLERK_TARBALL`).
- A real iPhone: F2's phone check is a person's step before release.

## How it went (23 and 24 October 2026)

- The test VPS named in the secrets store (srv1069233) was gone (its plan expired on 16 October), so
  the fresh machines are containers with systemd and their own Docker in a WSL VM made for this
  batch, on a USB SSD (the laptop's own disk had 8 GB free). Pebble gives real ACME certificates on
  the test network.
- What the machines found that the fast tests could not: Docker 29's image store cannot unpack
  layers inside a container (the machines use overlay2; a real server needs nothing); the
  notebook's local door accepts only a local Host (the test host's forward says so); the test's own
  services must never wait on a synchronous child.
- What the full test found: running across midnight, every scan kept its upload day as its date,
  because the phone's date was recognised only on the very upload day. The same hits a phone in
  another time zone than the server; the day either side now counts, and the installer takes the
  person's time zone from their notebook. And a Clerk that lost its records made a second To sort
  page after "Paperless sorts"; it finds its own again now.
- The independent review, round 1 (verdict no, four findings blocking release): a new server's first
  copy wrote over the old one's restore copy; an update cut off half way (or during its rollback)
  left the Clerk wrong about the version and the copy unrestorable; a rebuild cut off half way could
  not be finished; a changed file in the drive was imported silently; plus seven more (a stale login
  after a rebuild, lost thumbnails, a forced copy finishing an old export, a copy failing in silence,
  a dropped connection, a status claiming a rebuild, a shared Paperless never updated). All fixed
  test-first: copy folders per installation, journals for updates and rebuilds, every file checked
  against the export's manifest. The machine test then found that Paperless 3 keeps SHA-256
  checksums where the tests had MD5 ones.
- Round 2 (verdict no, one finding blocking): a rebuild cut off while the importer ran was "finished"
  on the row count alone, without search index, thumbnails or (on a big archive) files. Finishing now
  checks each paper's files against its checksum, imports again if one is missing, and always makes
  the index and thumbnails. Also fixed: a rebuilt server writing into the old server's copy folder
  (an old server still running overwrote it), the status line of every installed Paperless, update
  messages said while no longer true, a cut-off update that changed nothing never tried again, a
  deleted export folder, the plan guard silenced by one scan, and four smaller ones.
