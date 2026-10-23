// plan propose | show | confirm | set <file>: the folder plan (F8).
import fs from "node:fs";
import { Drive, Confined } from "../core/drive.mjs";
import { readDriveConnection } from "../core/oauth.mjs";
import { Paperless, Taxonomy } from "../core/paperless.mjs";
import { readJson, writeJson } from "../core/files.mjs";
import { buildContext } from "../core/context.mjs";
import { readTree, proposePlan, proposeWithAi, sentences, confirmPlan, cleanName } from "../core/plan.mjs";
import { saveSettings, loadSettings } from "../core/settings.mjs";
import { prepare } from "../core/run.mjs";
import { mirrorStep, loadMirror, viewLink } from "../core/mirror.mjs";
import { paperlessWeb } from "../core/notes.mjs";
import { acquireWithin } from "../core/lock.mjs";
import { norm } from "../core/names.mjs";

export const meta = { name: "plan", summary: "Propose, show or confirm the folder plan; mirror it into Paperless; rename To sort.", usage: "plan propose|show|confirm|set <file>|mirror|to-sort \"<new name>\" [--storage-paths yes|no]", flags: { value: ["storage-paths"] } };

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
  // "To sort" (made when a plan was confirmed before) is never a folder to propose.
  const before = readJson(ctx.paths.plan, null);
  const toSort = new Set([before?.to_sort?.id, ...confined.children(confined.rootId).filter((f) => f.name === ctx.settings.to_sort).map((f) => f.id)].filter(Boolean));
  const tree = readTree(confined, toSort);
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
  ctx.print(await mirrorNow(ctx));
}

// F19 with the person's yes (F4): Paperless's storage paths mirror the plan, and a "To sort" page
// lists the papers waiting. Asked first when Paperless has storage paths of its own; otherwise the
// confirmation of the plan is the yes. "no" leaves Paperless's storage paths alone.
async function mirrorNow(ctx) {
  const answer = ctx.flags["storage-paths"];
  if (answer !== undefined && !["yes", "no"].includes(answer)) throw new Error("--storage-paths is yes or no");
  let s = answer ? saveSettings(ctx.paths, { storage_paths: answer }) : loadSettings(ctx.paths);
  if (s.storage_paths === "no") return "Paperless's storage paths stay as they are. A paper waiting to be sorted is sorted by picking its sender in Paperless.";
  const bctx = buildContext(ctx.paths, { env: ctx.env });
  if (!bctx.paperless) throw new Error("connect Paperless first: godspeed-clerk connect");
  if (s.storage_paths !== "yes") {
    const mine = loadMirror(ctx.paths).paths;
    const own = (await bctx.paperless.all("storage_paths/")).filter((x) => !mine[x.id]);
    if (own.length) return `Your Paperless already has ${own.length} storage path${own.length === 1 ? "" : "s"} of its own. The Clerk can add one for each folder of your plan and a "To sort" page where you sort the papers it cannot place, and it never changes yours. Yes: godspeed-clerk plan mirror --storage-paths yes. No (Paperless's storage paths stay as they are; you sort by picking a sender): godspeed-clerk plan mirror --storage-paths no`;
    s = saveSettings(ctx.paths, { storage_paths: "yes" });
  }
  const lock = await acquireWithin(ctx.paths, Number(ctx.env.GODSPEED_CLERK_LOCK_WAIT_MS) || 45000);
  if (!lock) throw new Error("a run is going on; try again in a few minutes (the next run does it too)");
  try {
    const c = await prepare(buildContext(ctx.paths, { env: ctx.env }));
    if (!c.confined || !c.plan) return `The storage paths come with the next run, once Google Drive is open and the plan confirmed (${c.notes.join("; ") || "see godspeed-clerk status"}).`;
    const r = await mirrorStep(c);
    const n = Object.values(c.mirrorMap.paths).filter((e) => !e.gone).length;
    const link = viewLink(c, paperlessWeb(c));
    return `Paperless: ${n} storage path${n === 1 ? "" : "s"} for your folders and "${c.plan.to_sort?.name || s.to_sort}" (${r.made} made now, ${r.changed} levelled).${link ? ` The "${c.plan.to_sort?.name || s.to_sort}" page: ${link}` : ""}`;
  } finally { lock.release(); }
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

// The To sort folder renamed, by its id: the papers in it stay in it, the plan and the settings
// follow. For the person's language (F16): "Zu sortieren" becomes "To sort".
async function toSort(ctx) {
  const name = cleanName(ctx.rest.slice(1).join(" "));
  if (!name) throw new Error("give the new name, for example: godspeed-clerk plan to-sort \"To sort\"");
  const plan = readJson(ctx.paths.plan, null);
  if (plan?.status !== "confirmed" || !plan.to_sort?.id) throw new Error("there is no confirmed plan with a To sort folder yet");
  const lock = await acquireWithin(ctx.paths, Number(ctx.env.GODSPEED_CLERK_LOCK_WAIT_MS) || 45000);
  if (!lock) throw new Error("a run is going on; nothing was renamed, try again in a few minutes");
  try {
    const { confined } = await openRoot(ctx);
    const id = plan.to_sort.id;
    if (!confined.isInside(id)) throw new Error("the To sort folder is no longer in the documents folder");
    const parent = confined.folders.get(id).parent;
    const taken = confined.children(parent).find((f) => f.id !== id && norm(f.name) === norm(name));
    if (taken) throw new Error(`there is already a folder "${taken.name}" there`);
    const old = confined.folders.get(id).name;
    await confined.renameFolder(id, name);
    writeJson(ctx.paths.plan, { ...plan, to_sort: { ...plan.to_sort, name } });
    saveSettings(ctx.paths, { to_sort: name });
    ctx.print(`Renamed "${old}" to "${name}" in "${plan.root?.name}". The papers in it stay in it.`);
  } finally { lock.release(); }
}

export async function run(ctx) {
  const sub = ctx.rest[0] || "show";
  try {
    if (sub === "propose") await propose(ctx);
    else if (sub === "confirm") await confirm(ctx);
    else if (sub === "set") set(ctx);
    else if (sub === "to-sort") await toSort(ctx);
    else if (sub === "mirror") ctx.print(await mirrorNow(ctx));
    else if (sub === "show") { const p = readJson(ctx.paths.plan, null); if (p) show(ctx, p); else ctx.print("No folder plan yet: godspeed-clerk plan propose"); }
    else { ctx.fail(`Unknown: plan ${sub}. Try: godspeed-clerk plan propose|show|confirm|set <file>|mirror|to-sort "<new name>"`); return 1; }
    return 0;
  } catch (e) {
    if (e.name === "DriveAccessLost") { ctx.fail("Google no longer accepts the connection; connect again: godspeed-clerk drive connect"); return 1; }
    ctx.fail(`Plan: ${e.message}.`);
    return 1;
  }
}
