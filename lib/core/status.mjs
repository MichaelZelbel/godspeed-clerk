// `godspeed-clerk status`: everything a person or their assistant needs to know, in plain lines.
import { loadSettings } from "./settings.mjs";
import { readJson } from "./files.mjs";
import { sentences } from "./plan.mjs";
import { readiness } from "../channels/index.mjs";
import { Records } from "./records.mjs";

const WHO = { godspeed: "Godspeed sorts", paperless: "Paperless sorts (the Clerk only files)", nobody: "nobody sorts (the Clerk only files)" };

export function statusReport(paths, { env = process.env, home } = {}) {
  const s = loadSettings(paths);
  const pl = readJson(paths.paperless, null);
  const dr = readJson(paths.drive, null);
  const plan = readJson(paths.plan, null);
  const st = readJson(paths.state, {});
  const lines = [];
  lines.push(`The Clerk: ${s.active ? "active" : "PAUSED (reads and writes nothing; resume with: godspeed-clerk resume)"}. Sorting: ${WHO[s.sorting] || s.sorting}.`);
  lines.push(pl?.token ? `Paperless: ${pl.url} as ${pl.user}${pl.version ? ` (Paperless ${pl.version})` : ""}.` : "Paperless: not connected (godspeed-clerk connect).");
  lines.push(s.approved_ai?.length ? `AI that may read documents: ${s.approved_ai.join(", ")}, through Godspeed's model connection.` : "AI: none approved yet (godspeed-clerk ai approve).");
  if (!dr?.refresh_token) lines.push(`Google Drive: ${dr?.disconnected_at ? "disconnected" : "not connected"} (godspeed-clerk drive connect).`);
  else if (st.drive?.lost_since) lines.push(`Google Drive: access LOST since ${st.drive.lost_since}; filing waits. Connect again: godspeed-clerk drive connect`);
  else lines.push(`Google Drive: ${dr.account}, documents folder ${dr.root ? `"${dr.root.name}"` : "not named yet (godspeed-clerk drive folder)"}.`);
  if (!plan) lines.push("Folder plan: none yet (godspeed-clerk plan propose).");
  else if (plan.status === "confirmed") lines.push(`Folder plan: confirmed ${String(plan.confirmed_at).slice(0, 10)}.`);
  else if (plan.status === "stale") lines.push("Folder plan: made for another documents folder; propose a new one (godspeed-clerk plan propose).");
  else lines.push(`Folder plan: proposed, waiting for the person's yes (godspeed-clerk plan confirm):\n  ${sentences(plan).join("\n  ")}`);
  if (!s.notebook) lines.push("Notebook: off (no notes, no collection).");
  else if (st.notebook?.down_since) lines.push(`Notebook: NOT answering since ${st.notebook.down_since}; the notes wait.`);
  else if (st.notebook?.ok_at) lines.push(`Notebook: answers${st.notebook.web ? ` (${st.notebook.web})` : ""}${st.last_run?.notes_progress ? `; ${st.last_run.notes_progress}` : ""}; collection "${s.collection}".`);
  else lines.push("Notebook: not reached yet.");
  // F15: the deadlines the Clerk made in Godspeed (its records count them, by number only).
  const made = new Records(paths).all().reduce((n, r) => n + (r.asks?.items || []).filter((i) => i.made).length, 0);
  lines.push(`Deadlines: ${made} made in Godspeed from your letters.${st.deadlines?.unsupported_since ? " This Godspeed cannot keep them yet (since " + st.deadlines.unsupported_since.slice(0, 10) + "); update Godspeed and they are made." : ""}`);
  lines.push(`Messages: ${readiness(s, { env, home }).map((c) => `${c.name} ${c.ok ? "ready" : "NOT ready"} (${c.why})`).join("; ")}.`);
  const r = st.last_run;
  if (r) lines.push(`Last run ${r.at}: ${r.progress}, ${r.waiting} waiting, ${r.to_check} to check, ${r.in_drive} of ${r.total} in the drive.${r.failures ? ` ${r.failures} step(s) failed (see the log).` : ""}${r.notes?.length ? `\n  ${r.notes.join("\n  ")}` : ""}`);
  else lines.push("Last run: none yet.");
  const hb = st.worker;
  if (hb?.at) lines.push(`Worker: last seen ${hb.at}${Date.now() - new Date(hb.at).getTime() > 15 * 60000 ? " (NOT running?)" : ""}.`);
  return lines.join("\n");
}
