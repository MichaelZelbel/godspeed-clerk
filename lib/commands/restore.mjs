// copy: the nightly restore copy, now (F9). restore: rebuild Paperless from the restore copy in the
// drive, on a new server where the Clerk installed an empty Paperless.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireWithin } from "../core/lock.mjs";
import { buildContext } from "../core/context.mjs";
import { readJson } from "../core/files.mjs";
import { copyStep } from "../core/restore.mjs";
import { installedHost } from "../install/keep.mjs";
import { rebuild, lookForCopy } from "../install/rebuild.mjs";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version;

async function locked(ctx, fn) {
  const lock = await acquireWithin(ctx.paths, Number(ctx.env.GODSPEED_CLERK_LOCK_WAIT_MS) || 10 * 60000);
  if (!lock) { ctx.fail("Not now: a run of the Clerk is still going. Try again in a few minutes."); return 1; }
  try { return await fn(); } finally { lock.release(); }
}

// What the person reads after a rebuild.
export function doneWords({ r, rec }) {
  return [
    "",
    `Paperless is rebuilt: ${r.documents} documents, Paperless ${r.version}, at ${rec.address}.`,
    `Your phone signs in once more (the copy keeps no sign-ins): in the app, change the server to ${rec.address} if it changed, and sign in as ${r.user} with your Paperless password and the code from your authenticator app, both as before. Lost the password? godspeed-clerk paperless password`,
    "The Clerk goes on from its records of that night; what came after, it finds again in your drive and notebook without making anything twice.",
    ...(r.fromCopy ? [`The copy it was rebuilt from stays in your drive (folder The Clerk/paperless/${r.fromCopy}${r.fromHost ? `, from ${r.fromHost}` : ""}); this server makes its own from now on. Once the old server is gone for good, that folder can be deleted in Google Drive.`] : []),
  ].join("\n");
}

export const commands = [
  {
    meta: { name: "copy", summary: "The restore copy, now: the Clerk's records, and Paperless's export when the Clerk installed it.", usage: "copy" },
    run(ctx) {
      return locked(ctx, async () => {
        const c = buildContext(ctx.paths, { env: ctx.env });
        const host = installedHost(c);
        const pl = readJson(ctx.paths.paperless, null);
        try {
          const r = await copyStep(c, { host, user: pl?.user, force: true, clerkVersion: VERSION });
          if (!r.ran) { ctx.fail(`No restore copy: ${r.why}.`); return 1; }
          if (r.shared) ctx.print("The Clerk's records are in your drive. Paperless itself is not copied: another account keeps documents in it, and a shared Paperless needs a backup its owners agree on.");
          else if (!host) ctx.print("The Clerk's records are in your drive (folder \"The Clerk\"). This Paperless was not installed by the Clerk, so its backup stays its owner's.");
          else ctx.print(r.done ? `The restore copy is whole in your drive (folder "The Clerk"): ${r.uploaded} file(s) uploaded this time.` : `${r.uploaded} file(s) uploaded; the rest follows in the next runs.`);
          return 0;
        } catch (e) { ctx.fail(`The restore copy failed: ${e.message}`); return 1; }
      });
    },
  },
  {
    meta: { name: "restore", summary: "Rebuild Paperless from the restore copy in your drive (on a new server, into the empty Paperless the Clerk installed).", usage: "restore [--check] [--copy <id>] [--anyway]", flags: { bool: ["check", "anyway"], value: ["copy"] } },
    run(ctx) {
      return locked(ctx, async () => {
        const c = buildContext(ctx.paths, { env: ctx.env });
        if (ctx.flags.check) {
          const l = await lookForCopy(c, { copyId: ctx.flags.copy || null });
          const mine = readJson(ctx.paths.settings, {}).copy_id || null;
          const all = l.found?.all || [];
          if (all.length) ctx.print(["Restore copies in your drive (newest first):", ...all.map((x) => `  ${x.id}: ${String(x.restore.made_at).slice(0, 16).replace("T", " ")}, ${x.restore.documents} documents, Paperless ${x.restore.paperless_version}${x.restore.host ? `, from ${x.restore.host}` : ""}${x.id === mine ? " (this server's own copy)" : ""}`)].join("\n"));
          if (!l.ok && all.some((x) => x.id === mine) && !ctx.flags.copy) { ctx.print("This server makes its own copy every night. A rebuild from it is for a new server: there, after the install line and connecting the same Google Drive, godspeed-clerk restore."); return 0; }
          if (!l.ok) { ctx.print(`No restore copy to rebuild from: ${l.why}.`); return 0; }
          ctx.print(`To rebuild from the one with the newest paper (${l.found.id}): godspeed-clerk restore --copy ${l.found.id}`);
          return 0;
        }
        const r = await rebuild(c, { print: ctx.print, clerkVersion: VERSION, copyId: ctx.flags.copy || null, anyway: !!ctx.flags.anyway });
        if (!r.ok) { ctx.fail(`Not rebuilt: ${r.why}.`); return 1; }
        ctx.print(doneWords({ r, rec: readJson(ctx.paths.installed, null) }));
        return 0;
      });
    },
  },
];
