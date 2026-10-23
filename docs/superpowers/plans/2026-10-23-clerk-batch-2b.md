# The Clerk, batch 2b: sort in Paperless, and the drive follows

**Goal:** a paper the Clerk cannot place is sorted where Paperless is built for it. The person
opens one link, sees the paper with a picture of its first page on Paperless's "To sort" page, picks
one of their own drive folders from Paperless's storage path list, and the Clerk moves the drive
file there at its next run, takes "Check this" off, and keeps the choice for that sender. When
Godspeed sorts, the Clerk sets the storage path itself, so Paperless and the drive always agree.

**Spec:** `docs/proposals/paperless-addon.md` in MichaelZelbel/godspeed-mission-control at
`00e301e6`: F19 rewritten ("Sort in Paperless, and the drive follows"), F4, F5, F6, F7, F16 and
section 8 aligned. Their *Test:* lines are the acceptance tests. A first design (questions with
numbered choices in the chat) was stopped before it reached the person; it is on the branch
`wip/batch-2b-chat-answers` and not used, except what fits: F7 judged field by field, renaming To
sort, the English words.

## Paperless 3.3.3, as read from its source

- Storage paths: `storage_paths/` with `name`, `path` (a Jinja template, validated by Paperless;
  `{{ created }}` renders `YYYY-MM-DD`, `{{ added }}` likewise, `{{ title }}` sanitised),
  `matching_algorithm` (6 Auto, 0 None), `match`, `is_insensitive`. A document's `storage_path` is
  its id. Changing a path's template moves the files of the documents using it, inside Paperless.
- Saved views: `saved_views/` with `name`, `sort_field`, `sort_reverse`, `filter_rules`
  (`rule_type` 25 "storage path is": `storage_path__id`, or `storage_path__isnull` for no value),
  `display_mode` ("smallCards" shows the first page). Since API 10 the sidebar and dashboard
  visibility live in the person's UI settings; a request with `Accept: application/json; version=9`
  still takes `show_in_sidebar` and `show_on_dashboard` and merges them in on the server. The page
  is `<web address>/view/<id>`. Rules of different kinds are combined with AND, so the view is one
  rule: storage path is "To sort".

## Design

- **The mirror** (`lib/core/mirror.mjs`, records in `mirror.json`): one storage path per place a
  paper can go into: every fixed folder of the plan, every sender folder where the plan keeps one
  folder per sender (named like the folder; the folder's path when that name is taken), the folder
  before a `{year}` or `{type}` with the rest of the pattern in the template, and "To sort". Each
  template mirrors the drive folder (`<documents folder>/<path>/{{ created }} {{ title }}`), and each
  is set to Auto, except "To sort", which is None (Paperless must never learn to put a paper there).
  A saved view "To sort" (storage path is To sort), in the sidebar and on the dashboard, small cards.
  Made when the plan is confirmed and levelled every run: a folder the Clerk makes gets its path; a
  folder renamed or moved gets its path's name and template corrected. Only paths the Clerk made are
  ever changed; nothing is ever deleted.
- **The yes (F4):** setting `storage_paths` ("yes", "no", or not decided yet). `plan confirm`
  decides it: yes when Paperless has no storage paths of its own, otherwise the person is asked
  (`--storage-paths yes|no`). `plan mirror` does it for an installation whose plan was confirmed
  before. With "no", storage paths are never read, made or followed.
- **Godspeed sorts:** every paper the Clerk files gets the storage path of its folder, a paper
  waiting to be sorted the "To sort" path; the papers it filed before get theirs once.
- **The person picks:** a storage path set or changed in Paperless (by the person or Paperless's
  matching) that the Clerk did not set is followed in every setting: the drive file moves into that
  path's folder, "Check this" comes off (when Godspeed sorts), and the paper's sender is kept for
  that folder in the plan (a rule, or the sender's own same-named folder's link). A paper without a
  sender gets one AI look at who sent it; the sender is set (when Godspeed sorts) and learned only
  when the AI is sure. A storage path the Clerk did not make becomes a folder of that name inside
  the documents folder (where the plan keeps sender folders, else at its top), never anywhere else.
- **A sender picked** for a paper waiting to be sorted files it by the plan and takes "Check this"
  off, also with "no"; a sender rule learned later files the waiting papers of that same sender.
- **The message (F16):** one line, "N papers are waiting to be sorted.", with one link to the
  "To sort" page, once for every paper newly waiting (counting all that wait).

## Tasks

1. The fake Paperless: storage paths, saved views with the API 9 visibility, the document filters.
2. The Paperless client: a mirror writer (storage paths and the Clerk's own view only) in every
   setting, `storage_path` in the godspeed writer.
3. The mirror: places, templates, making and levelling, the view; `plan confirm` and `plan mirror`.
4. Filing: the storage path set when Godspeed sorts, picks followed, a picked sender, learned rules,
   user-made storage paths.
5. The message: one line and the view link.
6. The reviewer's findings from the stopped round that still apply (a pick never lost, another
   sender's paper never filed, later papers never silenced, a folder never made a sender).
7. The full test, docs, deploy.
