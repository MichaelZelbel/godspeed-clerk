import { loadSettings, saveSettings, setSetting, DEFAULTS } from "../core/settings.mjs";
import { writeJson, readJson } from "../core/files.mjs";

function show(ctx) {
  ctx.print(JSON.stringify(loadSettings(ctx.paths), null, 2));
  return 0;
}

export const commands = [
  {
    meta: { name: "settings", summary: "Show the settings, set one (settings sorting nobody), or reset one to its default.", usage: "settings [<name> <value> | reset <name>]" },
    run(ctx) {
      if (!ctx.rest.length) return show(ctx);
      if (ctx.rest[0] === "reset") {
        const key = ctx.rest[1];
        if (!key || !(key in DEFAULTS)) { ctx.fail(`Nothing changed: there is no setting ${key ?? ""}.`); return 1; }
        const saved = readJson(ctx.paths.settings, {});
        delete saved[key];
        writeJson(ctx.paths.settings, saved);
        ctx.print(`${key} is back to its default.`);
        return 0;
      }
      if (ctx.rest.length < 2) { ctx.fail("Give a name and a value, for example: godspeed-clerk settings sorting nobody"); return 1; }
      try {
        const next = setSetting(loadSettings(ctx.paths), ctx.rest[0], ctx.rest.slice(1).join(" "));
        writeJson(ctx.paths.settings, next);
        ctx.print(`${ctx.rest[0]} is now ${JSON.stringify(ctx.rest[0].split(".").reduce((o, k) => o[k], next))}`);
        return 0;
      } catch (e) {
        ctx.fail(`Nothing changed: ${e.message}.`);
        return 1;
      }
    },
  },
  {
    meta: { name: "pause", summary: "Stop sorting and filing until resume. The worker keeps running.", usage: "pause" },
    run(ctx) { saveSettings(ctx.paths, { active: false }); ctx.print("Paused: the Clerk reads and writes nothing until you resume it."); return 0; },
  },
  {
    meta: { name: "resume", summary: "Start sorting and filing again.", usage: "resume" },
    run(ctx) { saveSettings(ctx.paths, { active: true }); ctx.print("Active: the next run starts within a few minutes."); return 0; },
  },
];
