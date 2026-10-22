// ai: which AI reads the documents. Always Godspeed's own connection (F12); this records which
// provider the person approved, so a change in Godspeed's choice is noticed before any page leaves.
import { describe } from "../core/model.mjs";
import { findMissionControl } from "../core/paths.mjs";
import { saveSettings } from "../core/settings.mjs";

export const meta = { name: "ai", summary: "Show, or approve, the AI that reads the documents (Godspeed's own).", usage: "ai [approve]" };

export async function approveAi(ctx) {
  const workspace = ctx.settings.workspace || findMissionControl({ arg: ctx.flags.godspeed, env: ctx.env });
  const d = await describe({ workspace, env: ctx.env });
  const approved = [d.provider, ...(d.backup ? [d.backup.provider] : [])];
  saveSettings(ctx.paths, { approved_ai: approved, workspace: workspace || "" });
  return [`Documents are read by ${d.provider}${d.model ? ` (${d.model})` : ""}, through Godspeed's own model connection${d.backup ? `, and by its backup ${d.backup.provider} when that one does not answer` : ""}.`,
    "What that provider keeps of a request is set by your own agreement with it. If Godspeed later switches to another provider, the Clerk sends nothing until you approve it again."];
}

export async function run(ctx) {
  if (ctx.rest[0] === "approve") {
    try { ctx.print((await approveAi(ctx)).join("\n")); return 0; } catch (e) { ctx.fail(`Not approved: ${e.message}`); return 1; }
  }
  const a = ctx.settings.approved_ai || [];
  ctx.print(a.length ? `Approved to read documents: ${a.join(", ")}.` : "No AI is approved to read documents yet: godspeed-clerk ai approve");
  return 0;
}
