// F9: rebuilding a Paperless from the restore copy in the person's drive, on a new server where the
// Clerk installed an empty Paperless (the install line, then Google Drive connected). Only into a
// Paperless the Clerk installed and that holds no document: anything else is refused, nothing
// changed. The steps are in restore.mjs's header.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readJson, writeJson } from "../core/files.mjs";
import { findRestoreCopy, takeRecordsBack, RESTORE_FILE } from "../core/restore.mjs";
import { imageFor, newest, compareVersions } from "./versions.mjs";
import { installedHost, saveRecord } from "./keep.mjs";
import { sh, HostError } from "./host.mjs";

const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");

// What a rebuild would bring back, or why there is none. { ok, restore, why }.
export async function lookForCopy(ctx) {
  if (!ctx.driveConn) return { ok: false, why: "Google Drive is not connected yet (godspeed-clerk drive connect)" };
  const found = await findRestoreCopy(ctx.drive());
  if (!found) return { ok: false, why: "there is no folder \"The Clerk\" with a restore copy in this drive" };
  if (!found.restore) return { ok: false, why: "the Clerk's folder in this drive holds no whole restore copy of a Paperless (only the Clerk's records)", found };
  return { ok: true, restore: found.restore, found };
}

export async function rebuild(ctx, { print = () => {}, run = sh, fetchImpl = globalThis.fetch, clerkVersion = "" } = {}) {
  const host = installedHost(ctx, { run, fetchImpl });
  if (!host) return { ok: false, why: "the Clerk has not installed a Paperless on this server: run the install line first (it installs an empty one), then this again" };
  const look = await lookForCopy(ctx);
  if (!look.ok) return look;
  const { restore, found } = look;
  const owners = host.owners();
  const held = Object.values(owners).reduce((a, b) => a + b, 0);
  if (held > 0) return { ok: false, why: `this Paperless already holds ${held} document(s); a rebuild goes only into an empty one, so nothing was changed` };
  const files = found.copy.under("paperless").filter((r) => !["paperless/restore.json", "paperless/clerk-records.json"].includes(r));
  print(`The restore copy of ${restore.made_at.slice(0, 10)}: ${restore.documents} documents, made by Paperless ${restore.paperless_version}. Rebuilding Paperless from it.`);

  // 1. The export, from the drive into Paperless's export folder, each file checked.
  const exportDir = host.file("export");
  run("rm", ["-rf", exportDir]);
  fs.mkdirSync(exportDir, { recursive: true });
  let n = 0;
  for (const rel of files) {
    const bytes = await found.copy.get(rel);
    const want = found.copy.index.files[rel]?.md5;
    if (want && md5(bytes) !== want) return { ok: false, why: `${rel} did not arrive whole from the drive; nothing was imported` };
    const to = path.join(exportDir, rel.slice("paperless/".length));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, bytes);
    n++;
  }
  const manifest = fs.readFileSync(path.join(exportDir, "manifest.json"));
  if (md5(manifest) !== restore.manifest_md5) return { ok: false, why: "the export's manifest in the drive is not the one the restore copy names; nothing was imported" };
  print(`  ${n} files taken from the drive.`);
  run("chown", ["-R", "1000:1000", exportDir]);

  // 2. The same version that made the export, empty, then the import.
  const version = restore.paperless_version;
  const image = imageFor(version);
  host.down();
  for (const d of ["pg", "paperless", "media", "redis"]) { run("rm", ["-rf", host.file("data", d)]); fs.mkdirSync(host.file("data", d), { recursive: true }); }
  host.setImage(image);
  host.pull(image);
  host.up();
  print(`  Paperless ${version} starting empty (its database is set up anew, a minute or two)...`);
  if (!(await host.waitUp({ timeoutMs: 15 * 60000 }))) return { ok: false, why: `Paperless ${version} did not start; see: docker compose -p ${host.rec.project} logs webserver` };
  Object.assign(host.rec, { version, image, stage: "done", rebuilt_from: restore.made_at, rebuilt_at: new Date().toISOString() });
  saveRecord(ctx, host.rec);
  host.importNow();
  const user = restore.user;
  const tok = host.token(user);
  print(`  Imported: ${restore.documents} documents, ${user}'s account with its password and second factor.`);

  // 3. The Clerk's own records of that night, and its connection to the rebuilt Paperless.
  const bundleRaw = await found.copy.get("paperless/clerk-records.json");
  if (bundleRaw) {
    const r = takeRecordsBack(ctx.paths, JSON.parse(bundleRaw.toString("utf8")));
    print(`  The Clerk's records of that night are back (${r.records} documents).`);
  }
  writeJson(ctx.paths.paperless, { url: `http://127.0.0.1:${host.rec.port}`, user, token: tok.token, user_id: tok.id, version, connected_at: new Date().toISOString() });
  const s = readJson(ctx.paths.settings, {});
  writeJson(ctx.paths.settings, { ...s, paperless_web: host.rec.address });
  const plan = readJson(ctx.paths.plan, null), drive = readJson(ctx.paths.drive, null);
  if (plan?.root?.id && drive && !drive.root) writeJson(ctx.paths.drive, { ...drive, root: plan.root });
  writeJson(ctx.paths.restoreIndex, found.copy.index);

  // 4. Then the usual update, to the newest tested version.
  const target = newest().version;
  let update = null;
  if (compareVersions(version, target) < 0) {
    print(`  Updating Paperless ${version} to ${target}, as every Clerk-installed Paperless is...`);
    const failAfterStart = ctx.env?.GODSPEED_CLERK_TEST === "1" && ctx.env?.GODSPEED_CLERK_TEST_FAIL_UPDATE === "after-start";
    update = await host.update({ to: target, token: tok.token, failAfterStart });
    saveRecord(ctx, host.rec);
    if (update.ok) writeJson(ctx.paths.paperless, { ...readJson(ctx.paths.paperless, {}), version: target });
    print(update.ok ? `  Paperless ${target} runs.` : `  The update to ${target} failed (${update.why}); Paperless ${version} runs as rebuilt.`);
  }
  return { ok: true, documents: restore.documents, version: host.rec.version, user, update };
}

export { HostError, RESTORE_FILE };
