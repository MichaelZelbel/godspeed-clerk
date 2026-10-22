# Google Drive

## Why the whole drive

Google offers two kinds of permission for Drive. The narrow one reaches only files an app made
itself, or files you pick one by one in Google's file picker. With it the Clerk could not see the
folders you already keep, and could not file into them. So the Clerk asks for the whole drive
(`https://www.googleapis.com/auth/drive`), and limits itself in its own code:

- it reads the folder names inside the documents folder you name, and nothing else of your drive
  (to find that folder by name it asks Google only for a folder of that name at the top of your
  drive; a link to the folder needs no search at all);
- it writes only inside that folder (and, from a later version, inside a folder of its own);
- it renames or moves only files it made, which carry its mark;
- it never deletes a file, and never changes a file it did not make.

Every write goes through one place in the code (`Confined` in `lib/core/drive.mjs`), and the tests
prove that nothing lands outside.

## Your own Google app

The Clerk signs in with a Google app you own (a "Desktop app" OAuth client), the same way
Godspeed's Gmail connection does, so no one else's app ever holds a key to your drive.

1. In the Google Cloud console, pick or make a project.
2. Turn on the **Google Drive API** (APIs and services, Library).
3. Set up the consent screen (Google Auth platform, Branding and Audience). For a Google Workspace
   account choose **Internal**: no review by Google, and the connection does not run out. For a
   personal Google account choose **External**, add yourself as a test user, and then publish the
   app ("In production"): in "Testing" Google ends the connection every seven days. An unreviewed
   app shows a warning page once ("Google hasn't verified this app"); that is expected for an app
   only you use.
4. Clients, Create client, type **Desktop app**. Download its JSON.
5. `godspeed-clerk drive connect --client-file <that JSON>`

## Signing in on a server without a browser

`drive connect` prints a link. Open it on any device, sign in with the Google account that holds
your documents, and allow access. Your browser then tries to open an address that starts with
`http://127.0.0.1:47863/callback`, which fails on that device (nothing listens there). That is
expected: copy the whole address from the address bar and hand it back:

```
godspeed-clerk drive finish "http://127.0.0.1:47863/callback?state=...&code=...&scope=..."
```

The code in that address works only once, within minutes, and only together with a secret the
Clerk kept from the moment it made the link (PKCE), so the address is useless to anyone else.

With an SSH tunnel to the server (`ssh -L 47863:127.0.0.1:47863 <server>`) the browser on your
computer reaches the Clerk directly: `godspeed-clerk drive connect --wait` catches the answer
itself.

## The mark on each file

Every file the Clerk makes carries two hidden app properties: `clerkDoc` (the document's number in
Paperless) and `clerkSum` (the checksum Paperless keeps of the original). They let the Clerk find
its files again when its own records are lost, or after a rebuilt Paperless gave the document a
new number. Google shows app properties only to the app (the client) that wrote them: connect with
the same Google app after a reinstall.

## When access is lost

When Google stops accepting the connection (you withdrew it, the password changed, an app in
"Testing" ran out), the Clerk goes on sorting in Paperless, holds the filing back, and leaves one
notice for Godspeed to pass on. `godspeed-clerk status` shows it. After `drive connect` and
`drive finish`, the next run files everything that waited, each document once.
