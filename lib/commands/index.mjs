// The command registry. Every file in this folder (except index.mjs and files starting with "_")
// is a command module that exports `meta` and `run`, or `commands`, a list of { meta, run }.
//   meta = { name, summary, usage, flags: { value: [], bool: [] }, hidden }
//   run(ctx) -> exit code (or nothing for 0)
// A new command is a new file here; nothing else changes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stateDir, statePaths } from "../core/paths.mjs";
import { loadSettings } from "../core/settings.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GLOBAL = { value: ["state", "godspeed"], bool: ["help"] };

export async function loadCommands(dir = HERE) {
  const out = new Map();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".mjs") && n !== "index.mjs" && !n.startsWith("_")).sort()) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    const list = Array.isArray(mod.commands) ? mod.commands : mod.meta && mod.run ? [{ meta: mod.meta, run: mod.run }] : [];
    for (const c of list) {
      if (out.has(c.meta.name)) throw new Error(`two commands are called ${c.meta.name}`);
      out.set(c.meta.name, { ...c, file: f });
    }
  }
  return out;
}

export function flagSpec(commands) {
  const spec = { value: new Set(GLOBAL.value), bool: new Set(GLOBAL.bool) };
  for (const c of commands.values()) for (const k of ["value", "bool"]) for (const f of c.meta.flags?.[k] || []) spec[k].add(f);
  return spec;
}

export function parse(argv, spec) {
  const known = (a) => typeof a === "string" && a.startsWith("--") && (spec.value.has(a.slice(2)) || spec.bool.has(a.slice(2)));
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!known(a)) { rest.push(a); continue; }
    const k = a.slice(2);
    if (spec.bool.has(k)) { flags[k] = true; continue; }
    if (i + 1 < argv.length && !known(argv[i + 1])) flags[k] = argv[++i];
    else flags[k] = "";
  }
  return { flags, rest };
}

export async function main(argv, { print = (s) => console.log(s), fail = (s) => console.error(s), env = process.env } = {}) {
  const commands = await loadCommands();
  const { flags, rest } = parse(argv, flagSpec(commands));
  const name = rest[0] || (flags.help ? "help" : "status");
  const c = commands.get(name);
  if (!c) { fail(`Unknown command ${name}. Try: godspeed-clerk help`); return 1; }
  if (flags.help && name !== "help") { print(`godspeed-clerk ${c.meta.usage}\n  ${c.meta.summary}`); return 0; }
  const dir = path.resolve(flags.state || stateDir({ env }));
  const paths = statePaths(dir);
  const ctx = { name, flags, rest: rest.slice(1), argv, commands, print, fail, env, paths, settings: loadSettings(paths) };
  return (await c.run(ctx)) ?? 0;
}
