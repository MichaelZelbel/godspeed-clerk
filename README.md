<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-3c873a.svg" alt="Node.js 22 or newer">
  <a href="https://github.com/MichaelZelbel/godspeed-mission-control"><img src="https://img.shields.io/badge/add--on%20for-Godspeed%20Mission%20Control-5a45c8.svg" alt="An add-on for Godspeed Mission Control"></a>
</p>

# The Clerk

**Beta 0.5.1. Requires Godspeed Mission Control 2.0.0-beta.6 or newer.**

**You scan a letter with your phone. Minutes later it has a real name in Paperless, and your
mission control can tell you what it says. Google Drive copies are optional.**

An add-on for [Godspeed Mission Control](https://github.com/MichaelZelbel/godspeed-mission-control),
the free personal AI you run yourself. The manual for Godspeed is the book
[*Teach It Once*](https://leanpub.com/teachitonce).

[![Support on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/michaelc0de)

> **You:** what did the water company want from me last month?
>
> **Your mission control:** Brightwater Utilities sent an invoice on 12 October: 48.30 EUR for
> September, to pay by 20 November. You can open it in Paperless, and
> the 20 November is in your deadlines.

Underneath, the Clerk uses [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx), a free
program that reads the text of every scan and keeps your papers searchable. You never have to learn
it: the Clerk installs it on your Godspeed server, secures it and keeps it running. With Google
Drive connected, it makes a nightly restore copy and updates Paperless after a fresh copy.

## This is for you if

You have paper: invoices, tax notices, insurance letters, pay slips, letters with a deadline. You
want each one scanned once and then found again in the folder you would have put it in yourself,
without sorting anything by hand. You have Godspeed Mission Control on a server (or a Paperless
you already run). You can add Google Drive for filed copies and a restore copy.

If you do not have Godspeed yet, start with [the install page](https://godspeedmissioncontrol.com/install)
and Chapter 2 of the book.

## What it does

- **Reads and names** every scan: a real title, the sender, the kind of paper, tags, and the date
  printed on it (not the day you scanned it).
- **With Google Drive, files it** into the folder of your own Google Drive where it belongs, named
  `<date> <title>.pdf`, the way you already keep your papers. Within ten minutes of a scan there is
  a copy in your drive, sorted or not.
- **Tells Godspeed**: every paper gets a note in your notebook with its full text, a short summary
  and the key facts, so you can ask about it. A "Documents" list shows everything it handled.
- **Turns a letter's deadline into a Godspeed deadline**, which reminds you as the day comes.
- **Asks you only what it cannot decide**: unsure papers carry "Check this" in Paperless. With
  a Drive plan, its "To sort" page shows papers needing a folder; your Drive follows your pick.
- **Keeps Paperless running and safe**: the HTTPS address with a second login factor, updates only
  to versions it was tested with after a fresh restore copy (a failed update puts everything back),
  a restart when it stops, a warning before the disk is full, and, with Drive, a nightly restore copy.

## What it never does

- Never deletes a document, a filed file or anything in Paperless.
- Never sends your papers anywhere but the AI you already use in Godspeed, through Godspeed's own
  connection.
- Never touches a file in your drive it did not make, and writes only inside your documents folder
  and its own folder.
- Never reads, files or copies the papers of another account in the same Paperless.
- Never changes a Paperless you already run: one it did not install it reads, and it never
  updates, restarts or exports it.

## Add it

**On your Godspeed server, as root** (Linux, with either the website's Docker installation or the
native installation; this installs Paperless too):

```bash
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-clerk/main/install.sh | bash
```

**You already run Paperless** (on this server, a home server or a NAS):

```bash
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-clerk/main/install.sh | bash -s -- --paperless https://paperless.example --user <your account>
```

**Windows** (PowerShell), with a Paperless that runs elsewhere:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/MichaelZelbel/godspeed-clerk/main/install.ps1))) --paperless https://paperless.example --user <your account>
```

**Or ask your mission control:** "Add the Clerk from github.com/MichaelZelbel/godspeed-clerk."
It follows [the steps for assistants](INSTALL-FOR-ASSISTANTS.md).

Run the same line again to update; your settings, your connections and everything the Clerk keeps
stay as they are.

Finish Godspeed's own first setup and connect your AI there before adding the Clerk. An older
Godspeed gets one update instruction before the Clerk changes Paperless or its service.

**What the server needs** (Paperless is installed only when these checks pass):
1.5 GB of memory free, 8 GB of disk free, Docker with Compose, and the web address Godspeed's own
installer gave it. With Drive's nightly restore copy, papers take their space twice on the server:
once in Paperless, once in the export.

**Papers in another language** are read in that language and English, and the starter set of
document types and tags comes in the language you talk to Godspeed in (`--chat-language`, the same
unless you say otherwise):

```bash
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-clerk/main/install.sh | bash -s -- --language German
```

## Your first fifteen minutes

1. **The install line above.** Keep the Paperless address, password and second factor setup key
   in your password manager.
2. **Start the Clerk:** `godspeed-clerk resume`.
3. **Your phone:** `godspeed-clerk phone` gives the iPhone app, address, login and authenticator
   steps. Scan a letter; the Clerk confirms when the first scan arrives.
4. **Check:** `godspeed-clerk status`. Your papers are named and sorted in Paperless, with notes
   in Godspeed's notebook, its Documents list and any deadlines. Unsure papers carry "Check this"
   in Paperless. You need no Google app or folder plan for this.

Without Drive, Paperless on your server holds the papers. **The Clerk makes no off-server backup
without Drive.** Back up that server yourself. Monitoring and restarts continue, but automatic
Paperless updates wait for a fresh restore copy.

## Optional: copies in Google Drive

Add this now or later. The Clerk uses a Google app of your own;
[docs/google-drive.md](docs/google-drive.md) shows how to make one. Then:

```
godspeed-clerk drive connect --client-file <the app's JSON>
godspeed-clerk drive finish "<the address your browser showed after Allow>"
godspeed-clerk drive folder "Paperwork"
godspeed-clerk plan propose
godspeed-clerk plan confirm
```

Name your own documents folder and confirm only a plan you want. An active Clerk picks up
existing papers on its next run, adds their Drive copies, and updates the same notes and list
items with Drive links. It keeps the same deadlines. If paused, run `godspeed-clerk resume`.
The confirmed plan also supplies Paperless's folder storage paths and its "To sort" page.
A temporary loss of a connected Drive keeps its copies waiting; it does not switch to the
never-connected path or remove existing files.
To stop using Drive intentionally, run `godspeed-clerk drive disconnect`. Sorting, notes and
deadlines continue in Paperless; old Drive files and links remain, but no new off-server copy is
made. Connecting Drive again resumes copying with the existing plan.

## Where your papers live

- **Paperless on your server** keeps every paper, so the phone app can show and search it.
- **Godspeed's notebook** holds the notes, Documents list and deadlines, with links to Paperless.
- **With Google Drive connected**, every paper gets a named copy in your own documents folder,
  within ten minutes of text reading, sorted or not. Keep the original paper until its Documents
  item says "in drive". A scan not yet copied can be lost with the server.
- **With Drive, on a Paperless the Clerk installed**, the first restore copy starts after resume,
  then runs nightly: Paperless's complete export plus the Clerk's records. On a Paperless you
  already run, the Clerk copies only its own records; Paperless's backup stays your responsibility.
- **Without Drive**, the Clerk has no off-server copy of the papers or restore copy. Losing the
  server can lose the papers. Keep your own backup.

## A new server

With an existing Drive restore copy, when a server is gone, run the install line on the new one (it installs an empty Paperless) and
connect the same Google Drive, with the same Google app as before. The Clerk finds its restore copy
and says so. Rebuild before you name a documents folder or confirm a plan (the copy brings the plan
back with it):

```
godspeed-clerk drive connect --client-file <the same app's JSON>
godspeed-clerk drive finish "<the address your browser showed after Allow>"
godspeed-clerk restore
```

It checks every file of the copy against the export's own list first, installs the Paperless
version that made the copy, imports every paper with its titles, tags and dates, takes its own
records back, and then updates Paperless as usual. Your phone signs in once more (the copy keeps no
sign-ins), with the same password and authenticator code. Nothing is filed, noted or reminded twice.
Cut off half way (a dropped connection), `godspeed-clerk restore` again finishes it. A plan
confirmed on the new, empty Paperless while a copy waits is stopped with this same advice; to start
empty on purpose: `godspeed-clerk plan confirm --start-fresh`. Each server writes its copy into a
folder of its own, so a new server never writes over the copy of the old one;
`godspeed-clerk restore --check` lists them.

A Paperless where another account keeps papers too is never copied this way (its export would hold
their papers); the Clerk tells you once that a shared Paperless needs a backup its owners agree on.
A Paperless the Clerk did not install keeps its owner's backup; your own papers are safe in your
drive when Drive is connected.

## Keeping it running

On a Paperless it installed, the Clerk:

- **updates** only to versions it was tested with, at night, after that night's restore copy. Before
  an update it keeps a copy of Paperless's database, its settings and the version it ran; when the
  new version does not come up healthy, it puts all of that back and tells you once. An update cut
  off half way (a reboot) is finished or undone at the Clerk's next look. Now:
  `godspeed-clerk paperless update`. Without Drive, automatic updates wait for a fresh restore copy.
- **restarts** Paperless when it stops, and tells you if that does not help within half an hour.
- **warns** before the disk is full.
- **keeps the address**: when an update of Godspeed rewrites the web settings, the Clerk puts
  Paperless's address back within the hour.

`godspeed-clerk paperless status` says where it stands; `godspeed-clerk paperless password` gives
you a new password if you lost it.

## Security

- **HTTPS always**, on your server's own name, with the same kind of certificate as your notebook's
  address. Paperless itself listens only on the server; nothing reaches it but through that address.
- **A second factor**: the installer switches it on for your account. Signing in needs your password
  and the code from your authenticator app; the phone app asks once and then keeps its own key.
- **Repeated failed sign-ins** are slowed down: Paperless lets one sender try five times a minute.
- **Your login** stays in the Clerk's private folder on the server until you say you have saved it:
  `godspeed-clerk phone --forget`.

Privacy in detail: [docs/privacy.md](docs/privacy.md).

## Sorting

**Who sorts** (`godspeed-clerk settings sorting <choice>`):

- `godspeed` (the default): your own AI, through Godspeed, reads each new paper and the Clerk sets
  its title, sender, type, tags, date and folder. A title you typed, a date you set, a sender or
  type already there stay. Tags are only ever added. "Tax 2024" means "needed for the 2024 tax
  return".
- `paperless`: Paperless sorts (its own rules or its own AI). The Clerk only files.
- `nobody`: the Clerk only files.

With `paperless` and `nobody` the Clerk writes nothing into Paperless's papers at all; that is
enforced in the code.

**Papers it cannot place** wait in "To sort" in your drive and on the "To sort" page in Paperless
(in the sidebar, on the dashboard and in the phone app). When Godspeed sorts, that page lists
exactly the papers waiting; with `paperless` or `nobody` it lists the papers without a storage path
yet. Pick a storage path for a paper (Paperless's list holds your own drive folders) and the Clerk
moves the file there at its next run and remembers the folder for that sender. One message tells
you when papers wait: "2 papers are waiting to be sorted.", with the page's link.

**When it is not sure**, it says so instead of guessing: a wrong date puts an invoice into the wrong
tax year, which is worse than "Check this".

## Deadlines from letters

"Pay by 20 November" becomes a deadline in Godspeed, named by what it asks, with a link to the
paper; Godspeed reminds you as the day comes. Only what a letter asks you to do counts: the
cancellation terms of a booking or an order are options, not deadlines. A period that runs from the
day a letter reached you (which it does not print) is counted from the letter's date, the earliest
the day can be, and you are asked to check it. Once you change or close a deadline, it is yours.

## What it may touch

- **Paperless**: only papers your account owns. It signs in with your account's existing key and
  never asks Paperless for a new one (that would sign your phone out). It creates senders, "Tax
  <year>" tags and its "Check this" and "Important" tags; with your yes, the storage paths that
  mirror your folders and the "To sort" page. On a Paperless it installed, also the starter set,
  your account, the second factor, updates and the nightly export.
- **Optional Google Drive**: your whole drive is the only permission that can file into folders you already
  have; the Clerk itself reads and writes only inside your documents folder and its own folder
  "The Clerk", changes only files it made, and never deletes one.
  [docs/google-drive.md](docs/google-drive.md).
- **Your Godspeed notebook**: its notes (folder "Documents"), the "Documents" list and its
  deadlines, through the notebook's door on this computer only. A note you write into stays yours.
- **The AI**: only the one Godspeed uses for you. The setup names it; if Godspeed later switches to
  another provider, the Clerk sends nothing until you approve that one too.

## Commands

You will mostly talk to your mission control in plain words. The commands underneath:

```
godspeed-clerk status                    godspeed-clerk run
godspeed-clerk phone [--forget]          godspeed-clerk pause | resume
godspeed-clerk drive connect | finish | folder | status | disconnect
godspeed-clerk plan propose | show | confirm | mirror | to-sort "<name>"
godspeed-clerk paperless status | update | check | password
godspeed-clerk copy                      godspeed-clerk restore [--check]
godspeed-clerk settings [<name> <value>] godspeed-clerk ai | ai approve
godspeed-clerk help                      godspeed-clerk uninstall
```

`uninstall` removes the program and the service; it keeps your records, every file in your drive,
and Paperless with every paper in it.

**In your language.** Folder names and messages are in the language you talk to Godspeed in, not the
language of your papers. Every word in notes and messages is a setting (`texts`), so your assistant
sets them once in your language; `godspeed-clerk settings reset texts` brings back the English ones.

## Honest limits

- Google Drive is optional. Without it there is no Clerk off-server backup; you must keep your own.

- Installing Paperless is supported on a Linux Godspeed server, using the public Docker or native
  installer, with Godspeed Mission Control 2.0.0-beta.6 or newer. Run the Clerk line on the server's
  host, where you ran Godspeed's install line.
- The phone app named here is for the iPhone. On Android, the Clerk names no app yet.
- The address uses your server's own name and a port of its own (48444). If your hosting provider
  runs a firewall in front of the server, that port has to be let in.
- Godspeed on a home computer instead of a server is not supported yet: your phone would reach
  Paperless only at home.

## Tests

```
node --test "test/*.test.mjs"
```

The fast tests use a pretend Paperless, a pretend Google Drive and recorded AI answers over a kit
of made-up documents. The full test runs a real Paperless-ngx in Docker
([test/full/README.md](test/full/README.md)); the machine test installs the Clerk with its install
line on fresh Linux servers, rebuilds one from the drive and breaks an update on purpose
([test/machine/README.md](test/machine/README.md)).

The [public-server install review](test/public/README.md) uses the actual website's Docker and
native installers, released Godspeed notebook and model command, and a phone-style letter upload
through real Paperless OCR into a pretend Drive. Both fresh beta.6 paths passed for 0.5.0;
[the release evidence](docs/releases/2026-10-24-clerk-0.5-verification.md) records the checks and
the native 0.4-to-0.5 HTTPS migration.
The [0.5.1 optional-Drive evidence](docs/releases/2026-10-24-clerk-0.5.1-verification.md)
records the basic phone journey and later Drive connection with the same notebook records.

## License

MIT. Every document, name and address in this repository is made up. Made by Michael Zelbel as
part of Godspeed Mission Control.
