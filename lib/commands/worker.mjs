// worker: the background service. Every few minutes one run (under the run lock), a heartbeat in
// the state, and a pause in between. Paused, it keeps its heartbeat and reads no document. On a
// Paperless the Clerk installed it also keeps Paperless running (every loop, paused or not) and,
// while active, makes the nightly restore copy and the update after it (F3, F9). A run that fails is
// written to the log and the next one comes as usual; the worker itself ends only when it is stopped.
import { acquire } from "../core/lock.mjs";
import { buildContext } from "../core/context.mjs";
import { runOnce } from "../core/run.mjs";
import { loadSettings } from "../core/settings.mjs";
import { readJson, writeJson, ensurePrivateDir } from "../core/files.mjs";
import { makeLog } from "../core/records.mjs";
import { hostStep, nightly } from "../install/keep.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8")).version;

export const meta = { name: "worker", summary: "The background service (started by the installer).", usage: "worker [--once]", flags: { bool: ["once"] } };

export async function run(ctx) {
  ensurePrivateDir(ctx.paths.root);
  const log = makeLog(ctx.paths);
  let stopping = false, wake = null;
  const stop = () => { stopping = true; if (wake) wake(); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  log(`worker started (pid ${process.pid})`);
  while (!stopping) {
    const st = readJson(ctx.paths.state, {});
    st.worker = { at: new Date().toISOString(), pid: process.pid };
    writeJson(ctx.paths.state, st);
    const lock = acquire(ctx.paths);
    if (lock) {
      try {
        const c = buildContext(ctx.paths, { env: ctx.env });
        try { await hostStep(c); } catch (e) { log(`keeping Paperless running failed: ${e.message}`); }
        if (loadSettings(ctx.paths).active) {
          await runOnce(c);
          try { await nightly(buildContext(ctx.paths, { env: ctx.env }), { clerkVersion: VERSION }); } catch (e) { log(`the nightly restore copy failed: ${e.message}`); }
        }
      } catch (e) { log(`run failed: ${e.message}`); }
      finally { lock.release(); }
    }
    if (ctx.flags.once) break;
    const minutes = Math.max(1, Number(loadSettings(ctx.paths).interval_minutes) || 3);
    await new Promise((r) => { wake = r; setTimeout(r, minutes * 60000); });
    wake = null;
  }
  log("worker stopped");
  return 0;
}
