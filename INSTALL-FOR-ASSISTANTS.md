# Adding the Clerk: steps for an AI assistant

You are an assistant, and your person said something like "add the Clerk", "install
godspeed-clerk" or "add the Clerk from github.com/MichaelZelbel/godspeed-clerk". Follow these
steps. Do the technical part yourself; the person answers only what is theirs to answer.

## The one rule

**Their papers and their folders are theirs.** Never confirm the folder plan for them, never pick
their documents folder, and never answer "Install Paperless now?" with no unless they said so. You
run the commands and say what each one found; they decide.

## 1. Check that it fits

- Godspeed Mission Control has to be installed: a mission control folder that holds `AGENTS.md`.
  Note its path. If there is none, tell them in one sentence that the Clerk is an add-on for
  Godspeed Mission Control and point them to https://godspeedmissioncontrol.com/install.
- Where does their Godspeed run? On a **Linux server** (the usual case) the Clerk runs there and can
  install Paperless itself. On **Windows, macOS or a Linux desktop** it needs a Paperless that already
  runs somewhere (a home server, a NAS): ask them for its address and their account name.
- Already installed? `godspeed-clerk status` answers. Running the installer again is the update.

## 2. Run the installer

On a server, as root (or with sudo):

```bash
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-clerk/main/install.sh | bash -s -- --user <the name they want to sign in with>
```

Add `--language <their papers' language>` when their papers are not in English (text reading
follows it), and `--chat-language <the language they talk to you in>` when that differs (the
starter types and tags, the "To sort" folder and the messages follow it).

With a Paperless that already runs, on any system:

```bash
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-clerk/main/install.sh | bash -s -- --paperless <its address> --user <their account>
```

On Windows, in PowerShell:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/MichaelZelbel/godspeed-clerk/main/install.ps1))) --paperless <its address> --user <their account>
```

The connect path asks for their Paperless password once, to read the account's existing key (it
is not kept). Ask them to type it into the terminal themselves, or to give it to you for this one
command as `PAPERLESS_PASSWORD`; never store it.

Read what it prints:

- **"Paperless was not installed, because:"** lists what the server lacks (memory, disk, Docker, the
  web address). Tell them each in one sentence and what fixes it. Installing Docker or a bigger
  server is their call: ask first.
- **The end** shows the Paperless address, their password, the second factor's setup key and ten
  recovery codes. Hand them over in the chat exactly as printed, and say: keep them in your password
  manager. Nothing else in the output needs them.

## 3. Google Drive, the documents folder, the plan

1. They need their own Google app ([docs/google-drive.md](docs/google-drive.md)); help them make it
   if they have none. Then `godspeed-clerk drive connect --client-file <the JSON>` prints a link.
   Give them the link; they sign in and press Allow; they hand you back the address their browser
   showed (it starts with `http://127.0.0.1:47863/callback` and does not open). Then
   `godspeed-clerk drive finish "<that address>"`.
2. If `drive finish` says the drive holds a **restore copy**, this is a new server for an old
   Paperless: ask whether to rebuild from it, and on their yes run `godspeed-clerk restore`. Skip
   the plan step then: the plan comes back with the copy.
3. Ask which folder holds their papers, then `godspeed-clerk drive folder "<its name or link>"`.
4. `godspeed-clerk plan propose` prints the plan in plain words. Show it to them as it is. They say
   yes, or what to change; `godspeed-clerk plan confirm` only after their yes.
5. `godspeed-clerk resume`.

## 4. The phone

`godspeed-clerk phone` prints the four steps for their iPhone. Send them as they are. When they say
they have scanned their first paper, the Clerk confirms it by itself in a message. After they have
saved the login: `godspeed-clerk phone --forget`.

## 5. Check, then say what is next

```
godspeed-clerk status
```

Tell them in two or three sentences: where Paperless runs, that a first copy of every scan is in
their drive within ten minutes, and that a paper the Clerk cannot place waits on the "To sort"
page, where they pick its folder.
