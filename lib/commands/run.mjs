// run: one run now, under the same lock as the worker. status: where everything stands.
import { acquire } from "../core/lock.mjs";
import { buildContext } from "../core/context.mjs";
import { runOnce } from "../core/run.mjs";
import { statusReport } from "../core/status.mjs";

export function summary(r) {
  if (r.paused) return "The Clerk is paused: nothing was read or written (resume with: godspeed-clerk resume).";
  return [`${r.copied} copied to the drive, ${r.sorted} sorted, ${r.check} to check, ${r.filed} filed, ${r.noted} noted. ${r.progress}${r.notes_progress ? `, ${r.notes_progress}` : ""}; ${r.waiting} waiting, ${r.to_check} to check in all.${r.deadlines ? ` ${r.deadlines} deadline(s) made in Godspeed.` : ""}${r.messaged ? " One message sent." : ""}`, ...r.notes.map((n) => `  ${n}`)].join("\n");
}

export const commands = [
  {
    meta: { name: "run", summary: "One run now: first copies, sorting, filing, notes, the message.", usage: "run [--steps copy,sort,file,note,notify]", flags: { value: ["steps"] } },
    async run(ctx) {
      const lock = acquire(ctx.paths);
      if (!lock) { ctx.print("Not now: another run is still going (the worker's). This one does nothing."); return 0; }
      try {
        const steps = ctx.flags.steps ? String(ctx.flags.steps).split(",").map((s) => s.trim()).filter(Boolean) : undefined;
        ctx.print(summary(await runOnce(buildContext(ctx.paths, { env: ctx.env, steps }))));
        return 0;
      } catch (e) {
        ctx.fail(`The run stopped: ${e.message}`);
        return 1;
      } finally { lock.release(); }
    },
  },
  {
    meta: { name: "status", summary: "Where everything stands: Paperless, the AI, the drive, the plan, the last run.", usage: "status" },
    run(ctx) { ctx.print(statusReport(ctx.paths)); return 0; },
  },
];
