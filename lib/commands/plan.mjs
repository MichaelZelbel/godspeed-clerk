// plan propose | show | confirm | set <file>: the folder plan (F8).
import fs from "node:fs";
import { Drive, Confined } from "../core/drive.mjs";
import { readDriveConnection } from "../core/oauth.mjs";
import { Paperless, Taxonomy } from "../core/paperless.mjs";
import { readJson, writeJson } from "../core/files.mjs";
import { buildContext } from "../core/context.mjs";
import { readTree, proposePlan, proposeWithAi, sentences, confirmPlan } from "../core/plan.mjs";

export const meta = { name: "plan", summary: "Propose, show or confirm the folder plan.", usage: "plan propose|show|confirm|set <file>" };

async function openRoot(ctx) {
  const c = readDriveConnection(ctx.paths);
  if (!c) throw new Error("connect Google Drive first: godspeed-clerk drive connect");
  if (!c.root?.id) throw new Error("name the documents folder first: godspeed-clerk drive folder <its link or name>");
  const confined = await new Confined(new Drive({ creds: c, env: ctx.env }), { rootId: c.root.id }).load({ cachePath: ctx.paths.driveTree });
  return { conn: c, confined };
}

function show(ctx, plan) {
  ctx.print([`Folder plan for "${plan.root?.name}" (${plan.status}):`, ...sentences(plan).map((s) => `  ${s}`)].join("\n"));
  if (plan.open?.length) ctx.print(`No folder fits these types yet, so their papers wait in "${plan.to_sort?.name || ctx.settings.to_sort}": ${plan.open.join(", ")}.`);
}

async function propose(ctx) {
  const { conn, confined } = await openRoot(ctx);
  const pc = readJson(ctx.paths.paperless, null);
  if (!pc?.token) throw new Error("connect Paperless first: godspeed-clerk connect");
  const tax = await Taxonomy.load(new Paperless({ url: pc.url, token: pc.token }));
  const types = [...tax.types.values()].map((t) => t.name);
  const senders = [...tax.correspondents.values()].map((c) => c.name);
  const tree = readTree(confined);
  let plan = proposePlan({ tree, types, senders, settings: ctx.settings });
  if (plan.open.length) {
    try { plan = await proposeWithAi({ plan, tree, types, senders, settings: ctx.settings, ask: buildContext(ctx.paths, { env: ctx.env }).ask }); }
    catch (e) {
      if (e.name !== "ModelUnavailable" && e.name !== "RouteRefused") throw e;
      plan.notes.push(`the AI did not help with the rest (${e.message})`);
    }
  }
  const out = { format: 1, status: "proposed", root: conn.root, to_sort: { name: ctx.settings.to_sort }, rules: plan.rules, open: plan.open, notes: plan.notes, proposed_at: new Date().toISOString() };
  writeJson(ctx.paths.plan, out);
  show(ctx, out);
  for (const n of plan.notes) ctx.print(`Note: ${n}.`);
  ctx.print("Nothing was written to the drive. Confirm with: godspeed-clerk plan confirm (or correct it first: godspeed-clerk plan set <file>)");
}

async function confirm(ctx) {
  const plan = readJson(ctx.paths.plan, null);
  if (!plan) throw new Error("there is no plan yet: godspeed-clerk plan propose");
  if (plan.status === "stale") throw new Error("the plan was made for another documents folder: godspeed-clerk plan propose");
  const { conn, confined } = await openRoot(ctx);
  if (plan.root?.id !== conn.root.id) throw new Error("the plan was made for another documents folder: godspeed-clerk plan propose");
  const done = await confirmPlan(confined, plan, ctx.settings);
  writeJson(ctx.paths.plan, done);
  show(ctx, done);
  ctx.print(`Confirmed. "${done.to_sort.name}" is ready in "${done.root.name}".${ctx.settings.active ? "" : " The Clerk is still paused; start it with: godspeed-clerk resume"}`);
}

function set(ctx) {
  const file = ctx.rest[1];
  if (!file) throw new Error("give a JSON file with the rules: { \"rules\": [ { \"type\": \"Invoice\", \"folder\": \"Invoices/{sender}\" } ] }");
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const rules = Array.isArray(j) ? j : j.rules;
  if (!Array.isArray(rules) || !rules.every((r) => r && typeof r.folder === "string" && r.folder.trim())) throw new Error("every rule needs a folder");
  const before = readJson(ctx.paths.plan, null);
  const conn = readDriveConnection(ctx.paths);
  const plan = { format: 1, status: "proposed", root: before?.root || conn?.root, to_sort: { name: ctx.settings.to_sort }, rules, open: [], notes: [], proposed_at: new Date().toISOString() };
  writeJson(ctx.paths.plan, plan);
  show(ctx, plan);
  ctx.print("Saved as a proposal. It takes effect after: godspeed-clerk plan confirm");
}

export async function run(ctx) {
  const sub = ctx.rest[0] || "show";
  try {
    if (sub === "propose") await propose(ctx);
    else if (sub === "confirm") await confirm(ctx);
    else if (sub === "set") set(ctx);
    else if (sub === "show") { const p = readJson(ctx.paths.plan, null); if (p) show(ctx, p); else ctx.print("No folder plan yet: godspeed-clerk plan propose"); }
    else { ctx.fail(`Unknown: plan ${sub}. Try: godspeed-clerk plan propose|show|confirm|set <file>`); return 1; }
    return 0;
  } catch (e) {
    if (e.name === "DriveAccessLost") { ctx.fail("Google no longer accepts the connection; connect again: godspeed-clerk drive connect"); return 1; }
    ctx.fail(`Plan: ${e.message}.`);
    return 1;
  }
}
