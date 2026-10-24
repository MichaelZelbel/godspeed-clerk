# Working in this repository

The Clerk is an add-on for Godspeed Mission Control. It sorts the documents in a person's
Paperless-ngx and files each one into the right folder of their own cloud drive.

- What it must do: the requirements in the Godspeed product repository,
  `docs/proposals/paperless-addon.md` (MichaelZelbel/godspeed-mission-control). Each feature there
  has an id (F1 to F18) and a test; those tests are the acceptance tests. Never weaken one to make
  it pass; say so in the pull request when one looks wrong.
- The 0.5.1 requirement makes Google Drive optional, overriding the proposal's earlier Drive
  prerequisite. Follow the current `README.md` and `docs/architecture.md`: Paperless-only use
  still sorts, writes notebook records and creates deadlines. Drive-first F18 ordering remains
  when Drive is configured; all other privacy, account ownership and safety acceptance stays.
- How it is built: `docs/architecture.md`. The build plan of each batch: `docs/superpowers/plans/`.
- Tests: `node --test "test/*.test.mjs"` (fast, no network, no Docker). The full test with a real
  Paperless in Docker: `test/full/README.md`, run by the `full` workflow. The machine test (the
  install line on fresh Linux servers, a rebuild, a broken update): `test/machine/README.md`.
- CI costs money (a private repository): every push runs the fast tests on Linux only; Windows and
  macOS run by hand (workflow_dispatch) and on version tags; the Docker full test runs on main, on
  tags and by hand. Push fewer, larger commits. A red run is a real failure: keep main green.

House rules:

- Node.js 22 or newer, Node's own modules only. No npm packages, not even small ones.
- Made-up documents, names and addresses only, in tests, examples, docs and issues. Never a real
  person's paper, not even shortened or blurred.
- Logs name documents by number only. The add-on's own records hold numbers, marks, folder ids,
  name hashes and links, never a document's text or title.
- Every AI call goes through Godspeed's `godspeed-model`. No other AI route.
- In "Paperless sorts" and "nobody sorts" not one write reaches Paperless. Never delete anything in
  Paperless, never ask Paperless for a new token.
- Plain everyday English in everything a person reads. No em dashes and no en dashes.
