# Changes

## 0.1.0 (first batch, private trial)

- Connects to an existing Paperless-ngx with the account's own token, reading only during setup.
- Three sorting settings: Godspeed sorts, Paperless sorts, nobody sorts. With the last two nothing
  is ever written into Paperless.
- Sorting through Godspeed's own model connection, with an approved-provider check before any text
  leaves: title, sender, type, tags, the printed date; "Check this" when unsure.
- Google Drive: sign-in that works on a server, a folder plan proposed from the existing folders,
  a checked first copy in "To sort", filing as `<date> <title>.pdf`, same-name suffixes, renames
  and moves that follow Paperless, files moved by hand left alone, lost access held and noted.
- Every step resumable after a crash; marks on the drive files find them again without records.
- Logs and records hold numbers, marks and folders only, readable by their owner only.
