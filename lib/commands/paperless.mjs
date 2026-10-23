// paperless status | update | check | password: the Paperless the Clerk installed (F3). A
// Paperless it did not install is its owner's: these say so and change nothing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireWithin } from "../core/lock.mjs";
import { buildContext } from "../core/context.mjs";
import { readJson, writeJson } from "../core/files.mjs";
import { hostStep, updateNow, installedHost } from "../install/keep.mjs";
import { newPassword } from "../install/host.mjs";
import { newest, isTested } from "../install/versions.mjs";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version;
const NOT_OURS = "The Clerk did not install this Paperless, so it never updates, restarts or exports it: that stays its owner's.";

export const meta = {
  name: "paperless",
  summary: "The Paperless the Clerk installed: status, update (only to tested versions), check (start it if it stopped), password (a new one).",
  usage: "paperless status|update [--to <version>] [--without-restore-copy]|check|password",
  flags: { value: ["to"], bool: ["without-restore-copy"] },
};

async function locked(ctx, fn) {
  const lock = await acquireWithin(ctx.paths, Number(ctx.env.GODSPEED_CLERK_LOCK_WAIT_MS) || 10 * 60000);
  if (!lock) { ctx.fail("Not now: a run of the Clerk is still going. Try again in a few minutes."); return 1; }
  try { return await fn(); } finally { lock.release(); }
}

export async function run(ctx) {
  const sub = ctx.rest[0] || "status";
  const c = buildContext(ctx.paths, { env: ctx.env });
  const host = installedHost(c);
  const rec = readJson(ctx.paths.installed, null);
  if (!host) {
    if (rec && rec.stage !== "done") { ctx.print(`Paperless is being installed (stopped at: ${rec.stage}). Run the install line again; it carries on where it stopped.`); return sub === "status" ? 0 : 1; }
    ctx.print(NOT_OURS);
    return sub === "status" ? 0 : 1;
  }
  if (sub === "status") {
    const pl = readJson(ctx.paths.paperless, null);
    const s = await host.status(pl?.token);
    const st = readJson(ctx.paths.state, {});
    const lines = [
      `Paperless ${host.rec.version}, installed by the Clerk on ${String(host.rec.installed_at).slice(0, 10)}${host.rec.rebuilt_from ? `, rebuilt from the restore copy of ${host.rec.rebuilt_from.slice(0, 10)}` : ""}: ${s.up ? "running" : `NOT answering (${s.why || "down"})`}.`,
      `Address: ${host.rec.address} (Paperless itself on 127.0.0.1:${host.rec.port}); folder ${host.dir}.`,
      newest().version === host.rec.version ? `Version: the newest the Clerk was tested with.` : `Version: ${newest().version} is tested and comes after tonight's restore copy${st.update?.to === newest().version && !st.update.ok ? ` (the last try failed and was put back: ${st.update.why}; godspeed-clerk paperless update tries again)` : ""}.`,
    ];
    if (st.host?.disk_low_since) lines.push(`Disk: nearly full since ${st.host.disk_low_since.slice(0, 16)}.`);
    ctx.print(lines.join("\n"));
    return 0;
  }
  if (sub === "check") {
    return locked(ctx, async () => {
      const r = await hostStep(c, { force: true });
      if (r.up) ctx.print(`Paperless answers.${r.healed ? " Its web address was gone from Caddy and is back." : ""}${r.disk ? ` ${r.disk.gb} GB of disk free.` : ""}`);
      else ctx.print(r.restarted ? "Paperless did not answer, so it was started again; it answers within a minute or two." : "Paperless does not answer, and starting it failed. See: godspeed-clerk paperless status");
      return 0;
    });
  }
  if (sub === "update") {
    const to = ctx.flags.to || newest().version;
    if (!isTested(to)) { ctx.fail(`Paperless ${to} is not a version the Clerk was tested with; it updates only to ${newest().version}.`); return 1; }
    return locked(ctx, async () => {
      ctx.print(`Updating Paperless ${host.rec.version} to ${to}: first a fresh restore copy, then the update; Paperless is away for a few minutes.`);
      const r = await updateNow(c, { to, withoutCopy: !!ctx.flags["without-restore-copy"], clerkVersion: VERSION });
      if (r.nothing) { ctx.print(`Paperless ${r.from} is already ${to} or newer. Nothing to do.`); return 0; }
      if (r.ok) { ctx.print(`Paperless ${to} runs, every document as before. The copy taken before the update is in ${r.backup}.`); return 0; }
      if (r.rolledBack) { ctx.fail(`The update to ${to} did not work (${r.why}), so Paperless ${r.from} runs again with its database, settings and documents as before.`); return 1; }
      if (r.backup) { ctx.fail(`The update to ${to} did not work (${r.why}), and Paperless ${r.from} did not come back (${r.back}). Everything as it was before is in ${r.backup}.`); return 1; }
      ctx.fail(`Not updated: ${r.why}.`);
      return 1;
    });
  }
  if (sub === "password") {
    const login = readJson(ctx.paths.login, null) || { user: host.rec.user };
    const password = newPassword();
    host.setPassword(host.rec.user, password);
    writeJson(ctx.paths.login, { ...login, user: host.rec.user, password, changed_at: new Date().toISOString() });
    ctx.print(`A new Paperless password for ${host.rec.user}: ${password}\nThe old one no longer works; the phone app stays signed in. The second factor is unchanged.`);
    return 0;
  }
  ctx.fail(`Unknown: paperless ${sub}. Try: godspeed-clerk paperless status|update|check|password`);
  return 1;
}
