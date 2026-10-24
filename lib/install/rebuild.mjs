// F9: rebuilding a Paperless from the restore copy in the person's drive, on a new server where the
// Clerk installed an empty Paperless (the install line, then Google Drive connected). Only into a
// Paperless the Clerk installed and that holds no document: anything else is refused, nothing
// changed.
//
//   1. The copy: the newest one in the drive that holds papers and is not this installation's own
//      (`--copy <id>` picks another). Every file comes from the drive checked against the checksum
//      the drive keeps, the manifest against the one restore.json names, and every file the
//      manifest names against the manifest's own checksum, all before anything is wiped: a file that
//      is not what the export says (changed in the drive, or half a night's upload) stops it, and
//      the person is told which papers.
//   2. Paperless's data folders emptied, the version that made the export started (Paperless imports
//      only into that version), the export imported; thumbnails made again (the export leaves them
//      out).
//   3. The account's token made (the export keeps none, so the phone signs in once more), the
//      Clerk's own records of that night back (its settings, plan, mirror and records; this
//      machine's own settings stay), its connection to the rebuilt Paperless, its copy folder the
//      old one's. The login the empty installation made is not handed out any more.
//   4. Then the usual update to the newest tested version.
//
// THE JOURNAL (`rebuild` in installed.json) says how far a rebuild came; cut off (a dropped SSH
// session, Ctrl+C), `godspeed-clerk restore` again finishes it: a Paperless that holds exactly the
// copy's papers is taken as imported, one that holds part of them is emptied and imported again
// (they can only have come from this rebuild).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readJson, writeJson } from "../core/files.mjs";
import { findRestoreCopy, takeRecordsBack, MANIFEST_FILES, hashLike } from "../core/restore.mjs";
import { imageFor, newest, compareVersions } from "./versions.mjs";
import { installedHost } from "./keep.mjs";
import { sh, HostError } from "./host.mjs";

const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");

// What a rebuild would bring back, or why there is none. { ok, restore, found, why }.
export async function lookForCopy(ctx, { copyId = null } = {}) {
  if (!ctx.driveConn) return { ok: false, why: "Google Drive is not connected yet (godspeed-clerk drive connect)" };
  const found = await findRestoreCopy(ctx.drive(), { except: copyId ? null : readJson(ctx.paths.settings, {}).copy_id || null });
  if (!found) return { ok: false, why: "there is no folder \"The Clerk\" with a restore copy in this drive" };
  if (copyId) {
    const c = found.copies.find((x) => x.id === copyId);
    if (!c) return { ok: false, why: `there is no restore copy "${copyId}" in this drive`, found };
    Object.assign(found, { restore: c.restore, prefix: c.prefix, id: c.id });
  }
  if (!found.restore) return { ok: false, why: "the Clerk's folder in this drive holds no restore copy of a Paperless with papers in it", found };
  return { ok: true, restore: found.restore, found };
}

export async function rebuild(ctx, deps = {}) {
  try { return await rebuildSteps(ctx, deps); }
  catch (e) { if (e.name === "HostError") return { ok: false, why: e.message }; throw e; }
}

async function rebuildSteps(ctx, { print = () => {}, run = sh, fetchImpl = globalThis.fetch, copyId = null, anyway = false } = {}) {
  const host = installedHost(ctx, { run, fetchImpl });
  if (!host) return { ok: false, why: "the Clerk has not installed a Paperless on this server: run the install line first (it installs an empty one), then this again" };
  const j0 = host.rec.rebuild || null;
  const look = await lookForCopy(ctx, { copyId: copyId || j0?.copy_id || null });
  if (!look.ok) return look;
  const { restore, found } = look;
  const sameCopy = j0 && j0.made_at === restore.made_at && j0.copy_id === found.id;
  const held = Object.values(host.owners()).reduce((a, b) => a + b, 0);
  const journal = (stage, extra = {}) => { host.rec.rebuild = { ...(host.rec.rebuild || {}), copy_id: found.id, made_at: restore.made_at, documents: restore.documents, user: restore.user, version: restore.paperless_version, stage, at: new Date().toISOString(), ...extra }; host.save(host.rec); };
  const imported = sameCopy && ["importing", "imported", "records"].includes(j0.stage) && held === Number(restore.documents);
  if (held > 0 && !imported && !(sameCopy && ["importing", "imported"].includes(j0.stage))) {
    return { ok: false, why: `this Paperless already holds ${held} document(s); a rebuild goes only into an empty one, so nothing was changed` };
  }
  print(`The restore copy of ${String(restore.made_at).slice(0, 10)}: ${restore.documents} documents, made by Paperless ${restore.paperless_version}${restore.host ? ` on ${restore.host}` : ""}. ${imported ? "Finishing the rebuild that was cut off." : "Rebuilding Paperless from it."}`);
  const version = restore.paperless_version;

  if (!imported) {
    // 1. The export, from the drive into Paperless's export folder, each file checked.
    const exportDir = host.file("export");
    const pre = `${found.prefix}/`;
    const files = found.copy.under(found.prefix).filter((r) => !/\/(restore|clerk-records)\.json$/.test(r));
    run("rm", ["-rf", exportDir]);
    fs.mkdirSync(exportDir, { recursive: true });
    journal("downloading");
    for (const rel of files) {
      const bytes = await found.copy.get(rel);
      const want = found.copy.index.files[rel]?.md5;
      if (want && md5(bytes) !== want) return { ok: false, why: `${rel.slice(pre.length)} did not arrive whole from the drive; nothing was changed in Paperless` };
      const to = path.join(exportDir, rel.slice(pre.length));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, bytes);
    }
    let manifest;
    try { manifest = fs.readFileSync(path.join(exportDir, "manifest.json")); } catch { return { ok: false, why: "the restore copy in the drive has no manifest; nothing was changed in Paperless" }; }
    if (md5(manifest) !== restore.manifest_md5) return { ok: false, why: "the export's manifest in the drive is not the one the restore copy names; nothing was changed in Paperless" };
    const docs = JSON.parse(manifest.toString("utf8"));
    const titleOf = (rel) => docs.find((o) => o.__exported_file_name__ === rel || o.__exported_archive_name__ === rel)?.fields?.title || rel;
    const wrong = MANIFEST_FILES(docs).filter(([rel, sum]) => { try { return hashLike(fs.readFileSync(path.join(exportDir, rel)), sum) !== sum; } catch { return true; } }).map(([rel]) => titleOf(rel));
    if (wrong.length && !anyway) {
      const names = [...new Set(wrong)];
      return { ok: false, why: `${names.length} paper(s) in the restore copy do not match what the export says (${names.slice(0, 5).map((n) => `"${n}"`).join(", ")}${names.length > 5 ? ", ..." : ""}): their files changed in the drive, or a nightly copy was cut off. Nothing was changed in Paperless. If the old server still runs, \`godspeed-clerk copy\` there makes the copy whole; to rebuild anyway, with those papers' files as they are now: godspeed-clerk restore --anyway` };
    }
    print(`  ${files.length} files taken from the drive and checked${wrong.length ? ` (${wrong.length} not matching, imported anyway)` : ""}.`);
    run("chown", ["-R", "1000:1000", exportDir]);

    // 2. The same version that made the export, empty, then the import.
    const image = imageFor(version);
    host.down();
    for (const d of ["pg", "paperless", "media", "redis"]) { run("rm", ["-rf", host.file("data", d)]); fs.mkdirSync(host.file("data", d), { recursive: true }); }
    journal("wiped");
    host.setImage(image);
    host.pull(image);
    host.up();
    print(`  Paperless ${version} starting empty (its database is set up anew, a minute or two)...`);
    if (!(await host.waitUp({ timeoutMs: 15 * 60000 }))) return { ok: false, why: `Paperless ${version} did not start; see: docker compose -p ${host.rec.project} logs webserver. Run godspeed-clerk restore again to carry on.` };
    Object.assign(host.rec, { version, image });
    journal("importing");
    host.importNow();
    journal("imported");
    print(`  Imported: ${restore.documents} documents, ${restore.user}'s account with its password and second factor.`);
    // The export leaves the thumbnails out; Paperless makes them again (the phone and the To sort
    // page show them).
    const th = host.dc(["exec", "-T", "webserver", "document_thumbnails"]);
    if (th.status !== 0) print("  The thumbnails were not all made again; Paperless makes them when a paper is opened.");
  }

  // 3. The Clerk's own records of that night, and its connection to the rebuilt Paperless.
  const user = restore.user;
  const tok = host.token(user);
  const bundleRaw = await found.copy.get(`${found.prefix}/clerk-records.json`);
  if (bundleRaw) {
    const r = takeRecordsBack(ctx.paths, JSON.parse(bundleRaw.toString("utf8")));
    print(`  The Clerk's records of that night are back (${r.records} documents).`);
  }
  writeJson(ctx.paths.paperless, { url: `http://127.0.0.1:${host.rec.port}`, user, token: tok.token, user_id: tok.id, version: host.rec.version, connected_at: new Date().toISOString() });
  const s = readJson(ctx.paths.settings, {});
  writeJson(ctx.paths.settings, { ...s, paperless_web: host.rec.address, copy_id: s.copy_id || found.id });
  const plan = readJson(ctx.paths.plan, null), drive = readJson(ctx.paths.drive, null);
  if (plan?.root?.id && drive && !drive.root) writeJson(ctx.paths.drive, { ...drive, root: plan.root });
  writeJson(ctx.paths.restoreIndex, found.copy.index);
  // The empty installation's login is gone with its database: the person signs in as before.
  writeJson(ctx.paths.login, { user, address: host.rec.address, rebuilt_from: restore.made_at });
  Object.assign(host.rec, { user, rebuilt_from: restore.made_at, rebuilt_at: new Date().toISOString() });
  delete host.rec.rebuild;
  host.save(host.rec);

  // 4. Then the usual update, to the newest tested version.
  const target = newest().version;
  let update = null;
  if (compareVersions(host.rec.version, target) < 0) {
    print(`  Updating Paperless ${host.rec.version} to ${target}, as every Clerk-installed Paperless is...`);
    const failAfterStart = ctx.env?.GODSPEED_CLERK_TEST === "1" && ctx.env?.GODSPEED_CLERK_TEST_FAIL_UPDATE === "after-start";
    update = await host.update({ to: target, token: tok.token, failAfterStart });
    if (update.ok) writeJson(ctx.paths.paperless, { ...readJson(ctx.paths.paperless, {}), version: target });
    print(update.ok ? `  Paperless ${target} runs.` : `  The update to ${target} failed (${update.why}); Paperless ${update.from} runs as rebuilt.`);
  }
  return { ok: true, documents: restore.documents, version: host.rec.version, user, update };
}

export { HostError };
