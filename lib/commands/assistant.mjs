// assistant install | remove: the recipe the person's assistant follows and the Hermes plugin that
// shows it the Clerk's open questions before each turn (F19). Setup runs `install`; run it again
// after an update. The assistant loads a new plugin when it restarts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMissionControl } from "../core/paths.mjs";
import { locate, installRecipe, installPlugin, removeAll, commitRecipe } from "../setup/assistant.mjs";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version;

// The command line the plugin runs, without its verb: the program (this one, or the copy setup just
// installed), with this state folder.
export const launcherArgv = (stateDir, script = path.join(PKG, "bin", "godspeed-clerk.mjs")) => [process.execPath, script, "--state", path.resolve(stateDir)];

export function installAssistant(ctx, { script } = {}) {
  const lines = [];
  const workspace = findMissionControl({ arg: ctx.flags.godspeed, env: ctx.env }) || ctx.settings.workspace || null;
  if (workspace) {
    const made = [];
    for (const r of installRecipe(workspace, PKG, { version: VERSION })) { lines.push(`${r.ok ? "ok  " : "NOTE"} ${r.text}`); if (r.file) made.push(r.file); }
    const saved = commitRecipe(workspace, made, `The Clerk's recipe (godspeed-clerk ${VERSION})`);
    if (saved === false) lines.push("NOTE the recipe is in place; saving it in the Godspeed folder's history did not work, it is saved with the next change there");
  } else lines.push("NOTE the Godspeed folder was not found, so the assistant gets no recipe (add --godspeed <folder>)");
  const h = locate({ flags: ctx.flags, env: ctx.env, workspace });
  const p = installPlugin(h, PKG, launcherArgv(ctx.paths.root, script));
  lines.push(`${p.ok && p.enabled !== false ? "ok  " : "NOTE"} ${p.text}`);
  if (p.ok) lines.push("Restart the assistant once (its Hermes gateway) so it loads the plugin; after that the person can answer the Clerk in the chat.");
  return lines;
}

export const meta = {
  name: "assistant",
  summary: "Give the person's assistant the Clerk's recipe and plugin, so they can answer it in the chat.",
  usage: "assistant install|remove [--godspeed <folder>] [--hermes-home <folder>]",
  flags: { value: ["hermes-home"] },
};

export function removeAssistant(ctx) {
  const workspace = findMissionControl({ arg: ctx.flags.godspeed, env: ctx.env }) || ctx.settings.workspace || null;
  const out = removeAll(locate({ flags: ctx.flags, env: ctx.env, workspace }), workspace);
  return out.length ? out : ["Nothing of the Clerk's was in the assistant."];
}

export async function run(ctx) {
  const sub = ctx.rest[0] || "install";
  if (sub === "install") { ctx.print(installAssistant(ctx).join("\n")); return 0; }
  if (sub === "remove") { ctx.print(removeAssistant(ctx).join("\n")); return 0; }
  ctx.fail(`Unknown: assistant ${sub}. Try: godspeed-clerk assistant install|remove`);
  return 1;
}
