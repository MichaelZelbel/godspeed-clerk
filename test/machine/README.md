# The machine test

F1, F2, F3 and F9 on fresh machines: the Clerk comes onto a fresh Linux server with Docker the way a
person adds it, with its install line, and everything is checked from outside, the way a phone and
a person see it.

A machine is a container that runs systemd and its own Docker (`machine.Dockerfile`: Ubuntu 24.04,
Docker and Compose from Ubuntu, curl, nothing else), so it is a fresh server as far as the Clerk can
tell, and it is thrown away whole, its Docker data with it. On it, `godspeed.sh` makes a stand-in
for a Godspeed server, with the product's own installer functions where they exist: Godspeed's Node.js
in its folder, and the notebook's web address (Caddy on ports 80 and 443, `godspeed-https.service`).
Its certificates come from [Pebble](https://github.com/letsencrypt/pebble), Let's Encrypt's own
ACME test server, on the test network: the same ACME steps as Let's Encrypt (Pebble checks the
challenge on the machine's ports 80 and 443), on names only that network knows.

What outlives a machine runs on the test host, as it outlives a person's server: a pretend Google
Drive (`test/fakes/drive.mjs`), the real Godspeed notebook from a product checkout, a pretend
Telegram, and the files the install line downloads.

| Machine | What it proves |
| --- | --- |
| A | All defaults: Paperless over HTTPS on the server's name with a certificate from the ACME server; the second factor required; the starter set in English; the copy scheduled; Paperless's own port closed to strangers. The phone signs in with the code and uploads made-up scans the way Swift Paperless does: sorted, filed into the drive, noted, "phone connected" said once. A Godspeed update rewrites its Caddyfile; the Clerk puts the address back. The restore copy; the next one sends no scan again. A second account's paper stops the export, nothing of it reaches the drive, said once. |
| B | A thrown away; a fresh machine rebuilt from the drive: the version that made the copy first, every document, title, tag and date, the plan; the phone signs in with the same password and code; the next runs make no second file, note, item or deadline. |
| C | Paperless 3.2.1, German: the German starter set, German and English text reading. An update to 3.3.3 forced to fail after the new version started and migrated the database ends on 3.2.1, with the same migrations and every document byte for byte. Then the update works; then a stopped Paperless runs again on the next check. |
| D | 1 GB of memory: the installer stops before installing anything and names the memory. |

## Running it

It needs a Linux host with Docker that may run privileged containers, about 25 GB of disk, Node.js
22.19 or newer, Python 3 with Pillow and a font (to render the kit), and a checkout of the Godspeed
product (for the notebook and the installer's functions). Every network address is on
`10.89.0.0/24`.

```
python3 test/kit/render.py test/kit/rendered
git archive --format=tar.gz --prefix=godspeed-clerk-test/ $(git stash create || echo HEAD) -o test/machine/.work/godspeed-clerk.tar.gz
GODSPEED_NOTEBOOK_CHECKOUT=<product checkout> node test/machine/e2e.mjs
```

`E2E_ONLY=a,b` runs only those parts (B needs A), `E2E_KEEP=1` keeps the last machine.

## A machine by hand

```
GODSPEED_NOTEBOOK_CHECKOUT=<product checkout> test/machine/machine.sh up a
test/machine/machine.sh sh a          # a root shell on srv-a.clerk.test
test/machine/machine.sh down a
```

On a machine made by hand the Clerk needs to be told where the pretend services are, in
`/var/lib/godspeed/clerk/service.env` (what `e2e.mjs` writes with `wire`), and the install line comes
from the test host: `curl -fsSL http://10.89.0.1:48903/install.sh | GODSPEED_CLERK_TARBALL=http://10.89.0.1:48903/godspeed-clerk.tar.gz bash`.

## What it does not prove

- A certificate from Let's Encrypt itself on a public name, and a hosting provider's firewall: the
  machines are on a test network.
- The download from GitHub while the repository is private: the install line takes the same tarball
  from the test host (`GODSPEED_CLERK_TARBALL`).
- A real iPhone with Swift Paperless (F2's phone check is a person's step before each release), and a
  real Google Drive (the pretend one speaks the same API, `test/fakes/drive.mjs`).
- A real AI: the model connection answers from the kit's recorded answers.
