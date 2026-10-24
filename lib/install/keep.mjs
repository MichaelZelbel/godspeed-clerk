// F3: keep the Paperless the Clerk installed running, safe and up to date. Nothing here runs for a
// Paperless the Clerk did not install (no installed.json): that one stays its owner's.
//
// Every worker loop, also while the Clerk is paused (it reads no document): is Paperless answering?
// Not: `docker compose up -d` at once, then at most every ten minutes; still down after half an
// hour: one message. Once an hour: the disk (under 3 GB or 5 percent free: one message per low
// stretch) and the HTTPS address (a Godspeed update may have dropped its line; heal puts it back).
//
// Every night, while the Clerk is active: the restore copy (restore.mjs), and after a whole copy,
// in the night's hours, the update to the newest tested Paperless when this one is older. On a
// Paperless where another account keeps papers there is no restore copy (F9), so the update goes
// on with the copy it keeps on the server. A failed update is put back (host.mjs) and told once;
// the same version is not tried again by itself (godspeed-clerk paperless update tries it on
// purpose). An update cut off on the way (host.mjs's journal) is finished or undone first, at the
// next look.
import fs from "node:fs";
import { readJson, writeJson } from "../core/files.mjs";
import { now } from "../core/records.mjs";
import { copyStep, nightNow } from "../core/restore.mjs";
import { Host, sh } from "./host.mjs";
import { heal } from "./https.mjs";
import { newest, compareVersions } from "./versions.mjs";

const MIN = 60000;
export const DISK_LOW_GB = 3;

export function installedHost(ctx, { run = sh, fetchImpl = globalThis.fetch } = {}) {
  const rec = readJson(ctx.paths.installed, null);
  if (!rec || rec.stage !== "done") return null;
  return new Host(rec, { run, fetchImpl, log: ctx.log, clock: ctx.clock || Date.now, save: (r) => writeJson(ctx.paths.installed, r) });
}

// An update cut off on the way, finished or undone; the person hears it only when it was put back
// (or could not be). Returns what recover gave, or null.
export async function recoverUpdate(ctx, host) {
  if (!host?.rec.update) return null;
  const pl = readJson(ctx.paths.paperless, null);
  const r = await host.recover({ token: pl?.token });
  if (!r) return r;
  // Cut off before the new version ever started: nothing changed but a stop, so nothing is told or
  // remembered, and the night tries the update again.
  if (r.untouched) { ctx.log?.(`update: cut off before ${r.to} started; Paperless ${r.from} runs on, and the update is due again`); return r; }
  if (r.outcome === "new") { if (pl) writeJson(ctx.paths.paperless, { ...pl, version: r.to }); }
  else ctx.outbox({ kind: "update-failed", to: r.to, from: r.from, rolled_back: !!r.rolledBack });
  const st = readJson(ctx.paths.state, {});
  st.update = { to: r.to, from: r.from, at: now(), ok: r.outcome === "new", rolled_back: !!r.rolledBack, why: "it was cut off" };
  writeJson(ctx.paths.state, st);
  return r;
}
export const saveRecord = (ctx, rec) => writeJson(ctx.paths.installed, rec);

function diskFree(dir) {
  try { const s = fs.statfsSync(dir); return { gb: Math.round(Number(s.bavail) * Number(s.bsize) / 1073741824 * 10) / 10, pct: Number(s.bavail) / Number(s.blocks) * 100 }; } catch { return null; }
}

// Returns { up, restarted, healed, disk } (or null: no Paperless of the Clerk's).
export async function hostStep(ctx, { run = sh, fetchImpl = globalThis.fetch, root = "/", force = false, disk = diskFree } = {}) {
  const host = installedHost(ctx, { run, fetchImpl });
  if (!host) return null;
  const t = (ctx.clock || Date.now)();
  const at = new Date(t).toISOString(); // one clock for every time kept here
  const out = { up: true, restarted: false, healed: false };
  out.recovered = await recoverUpdate(ctx, host);
  const st = readJson(ctx.paths.state, {});
  const h = st.host || {};
  const token = readJson(ctx.paths.paperless, null)?.token;
  const s = await host.status(token);
  // The version Paperless itself says it runs is the one the Clerk keeps (labels, updates).
  if (s.up && s.version && s.version !== host.rec.version && !host.rec.update) {
    ctx.log(`Paperless says it runs ${s.version}, not ${host.rec.version}; the Clerk keeps ${s.version}`);
    host.rec.version = s.version;
    host.save(host.rec);
  }
  if (!s.up) {
    out.up = false;
    h.down_since ||= at;
    if (!h.restart_at || t - Date.parse(h.restart_at) >= 10 * MIN || force) {
      const r = host.dc(["up", "-d"]);
      h.restart_at = at;
      out.restarted = r.status === 0;
      ctx.log(`Paperless did not answer; started it again (${r.status === 0 ? "docker compose up" : `failed: ${(r.stderr || "").trim().slice(-160)}`})`);
    }
    if (t - Date.parse(h.down_since) >= 30 * MIN && h.told_down !== h.down_since) { h.told_down = h.down_since; ctx.outbox({ kind: "paperless-down", since: h.down_since }); }
  } else if (h.down_since) {
    ctx.log("Paperless answers again");
    delete h.down_since; delete h.restart_at;
  }
  if (force || !h.hourly_at || t - Date.parse(h.hourly_at) >= 60 * MIN) {
    h.hourly_at = at;
    const d = disk(host.dir);
    out.disk = d;
    if (d && (d.gb < DISK_LOW_GB || d.pct < 5)) {
      if (!h.disk_low_since) { h.disk_low_since = at; ctx.outbox({ kind: "disk-low", since: h.disk_low_since, free: d.gb }); ctx.log(`the disk is nearly full: ${d.gb} GB free`); }
    } else if (h.disk_low_since) delete h.disk_low_since;
    try {
      const r = await heal({ host: host.rec.host, port: host.rec.https_port, upstream: host.rec.port, root, run });
      out.healed = r.healed;
      if (r.healed) ctx.log("Paperless's web address was gone from Caddy (a Godspeed update?); it is back");
      else if (!r.ok) ctx.log(`Paperless's web address: ${r.why}`);
    } catch (e) { ctx.log(`Paperless's web address could not be checked: ${e.message}`); }
  }
  st.host = h;
  writeJson(ctx.paths.state, st);
  return out;
}

// The update, now: a fresh restore copy first (unless the person said to go without one), then
// host.update. Returns the update's result, or { ok: false, why } when it did not start.
export async function updateNow(ctx, { to = newest().version, withoutCopy = false, run = sh, fetchImpl = globalThis.fetch, clerkVersion = "" } = {}) {
  const host = installedHost(ctx, { run, fetchImpl });
  if (!host) return { ok: false, why: "the Clerk did not install this Paperless, so it never updates it" };
  const pl = readJson(ctx.paths.paperless, null);
  if (!pl?.token) return { ok: false, why: "the Clerk is not connected to its Paperless" };
  const cut = await recoverUpdate(ctx, host);
  if (cut?.outcome === "new" && compareVersions(host.rec.version, to) >= 0) return { ok: true, from: cut.from, to, recovered: true };
  if (compareVersions(host.rec.version, to) >= 0) return { ok: true, nothing: true, from: host.rec.version, to };
  if (!withoutCopy) {
    let c;
    try { c = await copyStep(ctx, { host, user: pl.user, force: true, clerkVersion }); } catch (e) { return { ok: false, why: `the restore copy before the update failed (${e.message}); nothing was changed` }; }
    // A shared Paperless has no restore copy (F9); the update keeps its copy on the server only.
    if (!c.done && !c.shared) return { ok: false, why: `no fresh restore copy (${c.why || "not finished"}); nothing was changed` };
  }
  const failAfterStart = ctx.env?.GODSPEED_CLERK_TEST === "1" && ctx.env?.GODSPEED_CLERK_TEST_FAIL_UPDATE === "after-start";
  const r = await host.update({ to, token: pl.token, failAfterStart });
  saveRecord(ctx, host.rec);
  const st = readJson(ctx.paths.state, {});
  st.update = { to, from: r.from, at: now(), ok: r.ok, rolled_back: !!r.rolledBack, why: r.why || null };
  writeJson(ctx.paths.state, st);
  if (r.ok) {
    const conn = readJson(ctx.paths.paperless, {});
    writeJson(ctx.paths.paperless, { ...conn, version: to });
  }
  return r;
}

// The night's work, while the Clerk is active: the restore copy, then the update when one is due.
export async function nightly(ctx, { run = sh, fetchImpl = globalThis.fetch, clerkVersion = "" } = {}) {
  const host = installedHost(ctx, { run, fetchImpl });
  const pl = readJson(ctx.paths.paperless, null);
  const c = await copyStep(ctx, { host, user: pl?.user, clerkVersion });
  // The update: after a whole copy (or, shared, the night's records), only in the night's hours.
  if (!host || !(c.done || c.shared) || !nightNow(ctx.settings, (ctx.clock || Date.now)())) return { copy: c };
  const target = newest().version;
  const st = readJson(ctx.paths.state, {});
  if (compareVersions(host.rec.version, target) >= 0 || st.update?.to === target) return { copy: c };
  const failAfterStart = ctx.env?.GODSPEED_CLERK_TEST === "1" && ctx.env?.GODSPEED_CLERK_TEST_FAIL_UPDATE === "after-start";
  ctx.log(`update: Paperless ${host.rec.version} to ${target}, after tonight's restore copy`);
  const r = await host.update({ to: target, token: pl.token, failAfterStart });
  if (r.ok) writeJson(ctx.paths.paperless, { ...pl, version: target });
  // Only an update that began (Paperless stopped, its copy made) is remembered and told about; one
  // that never started (Paperless was not healthy, the download failed) changed nothing and is tried
  // again the next night.
  if (r.ok || r.backup) {
    const st2 = readJson(ctx.paths.state, {});
    st2.update = { to: target, from: r.from, at: now(), ok: r.ok, rolled_back: !!r.rolledBack, why: r.why || null };
    writeJson(ctx.paths.state, st2);
  }
  if (!r.ok && r.backup) ctx.outbox({ kind: "update-failed", to: target, from: r.from, rolled_back: !!r.rolledBack });
  else if (!r.ok) ctx.log(`update: not started (${r.why})`);
  return { copy: c, update: r };
}
