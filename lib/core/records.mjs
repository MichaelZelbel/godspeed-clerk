// The Clerk's own records (F18): one small file per document, in the state folder, readable by
// its owner only. They hold numbers, marks, folder ids, hashes of file names and times, never a
// document's text or title (F14), so a stolen records folder says nothing about the papers.
//
// A record:
//   { id, sum, upload_day,
//     copy:   { file_id, folder_id, name_hash, at }        the first copy, checked in the drive
//     sort:   { result, folder, at }                       sorted | check | before | external
//     pick:   { modified, folder }                         the AI's folder pick for that version
//     file:   { folder_id, name_hash, base_hash, check, modified, at }   where the Clerk put it
//     intent: { step, ... }                                written before an outside write
//     user_owned: { folder_id, at }                        moved or renamed by the person: theirs
//     note:   { id, key, hash, summary_done, pending, kept_out, deleted, at }   the notebook note:
//             its id (from the mark), a hash of what it is made from, a hash of the text written
//     item:   { id, key, at }                              the Documents collection's item
//     asks:   { read, letter, items: [{ n, by, within, from, from_date, vague, kind, due, basis,
//             check, passed, made, made_due, touched, told, titled }], important, at }
//                                                          a letter's requests (F15): dates,
//             numbers and flags; their words live in the note and in Godspeed's deadline
//     trashed: { at }   gone: { at } }                     binned in the drive / gone from Paperless
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson, appendPrivate } from "./files.mjs";

export const nameHash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 32);
export const now = () => new Date().toISOString();

export class Records {
  constructor(paths) { this.dir = paths.records; }
  file(id) { return path.join(this.dir, `${Number(id)}.json`); }
  get(id) { return readJson(this.file(id), null); }
  put(rec) { writeJson(this.file(rec.id), rec); return rec; }
  all() {
    let names = [];
    try { names = fs.readdirSync(this.dir).filter((n) => /^\d+\.json$/.test(n)); } catch { return []; }
    return names.map((n) => readJson(path.join(this.dir, n), null)).filter(Boolean);
  }
}

// One line per step, documents by number only.
export function makeLog(paths) {
  return (line) => appendPrivate(paths.log, `${now()} ${line}\n`);
}

// What the person should hear about, one JSON line each, by number. notify.mjs turns what is new
// into one message per run (F16).
export function makeOutbox(paths) {
  return (notice) => appendPrivate(paths.outbox, `${JSON.stringify({ at: now(), ...notice })}\n`);
}
