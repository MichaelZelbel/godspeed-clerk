// worker: the background service. Every few minutes one run (under the run lock), a heartbeat in
// the state, and a pause in between. Paused, it keeps its heartbeat and does nothing else. A run
// that fails is written to the log and the next one comes as usual; the worker itself ends only
// when it is stopped.
import { acquire } from "../core/lock.mjs";
import { buildContext } from "../core/context.mjs";
import { runOnce } from "../core/run.mjs";
import { loadSettings } from "../core/settings.mjs";
import { readJson, writeJson, ensurePrivateDir } from "../core/files.mjs";
import { makeLog } from "../core/records.mjs";

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
        if (loadSettings(ctx.paths).active) await runOnce(buildContext(ctx.paths, { env: ctx.env }));
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
