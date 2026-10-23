// The door into the person's assistant (F19), the Wingman's way:
//   the recipe   skill/clerk -> <Godspeed folder>/skills/clerk, with a marker so a recipe the person
//                wrote under the same name is never replaced or removed
//   the plugin   hermes/plugin/godspeed-clerk -> <Hermes home>/plugins/godspeed-clerk, with the exact
//                command line it runs (launcher.json), switched on with `hermes plugins enable`, or,
//                without a hermes command, in Hermes' own config.yaml
// Which Hermes: --hermes-home; else the one Godspeed runs for this folder
// (<Godspeed folder>/.godspeed/integrated-runtime/hermes, a server installation); else HERMES_HOME;
// else Godspeed's Hermes on Windows; else what `hermes config path` says. Under the tests only a
// home given with --hermes-home and a hermes named in GODSPEED_CLERK_HERMES are ever used.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NAME } from "../core/paths.mjs";

export const PLUGIN = NAME;
export const RECIPES = ["clerk"];
export const MARKER = `.installed-by-${NAME}`;

const testing = (env) => !!(env.NODE_TEST_CONTEXT || process.env.NODE_TEST_CONTEXT);

function findHermes({ env, platform, home }) {
  if (env.GODSPEED_CLERK_HERMES) {
    const f = env.GODSPEED_CLERK_HERMES;
    if (!fs.existsSync(f)) return null;
    return /\.(mjs|js)$/i.test(f) ? { exe: process.execPath, args: [f] } : { exe: f, args: [] };
  }
  if (testing(env)) return null;
  const names = platform === "win32" ? ["hermes.exe", "hermes.cmd"] : ["hermes"];
  const dirs = [...String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean), path.join(home, ".local", "bin"), "/usr/local/bin", "/opt/hermes-src/venv/bin"];
  for (const d of dirs) for (const n of names) { const f = path.join(d, n); try { if (fs.statSync(f).isFile()) return { exe: f, args: [] }; } catch { /* not here */ } }
  return null;
}

// { home, hermes(sub) -> { status, stdout, stderr } }
export function locate({ flags = {}, env = process.env, platform = process.platform, home = os.homedir(), workspace = null } = {}) {
  const prog = findHermes({ env, platform, home });
  const run = (hermesHome) => (sub, opts = {}) => {
    if (!prog) return { status: null, stdout: "", stderr: "hermes was not found" };
    const shell = platform === "win32" && /\.cmd$/i.test(prog.exe);
    const r = spawnSync(prog.exe, [...prog.args, ...sub], { encoding: "utf8", windowsHide: true, shell, timeout: 60000, stdio: ["ignore", "pipe", "pipe"], env: { ...env, ...(hermesHome ? { HERMES_HOME: hermesHome } : {}) }, ...opts });
    return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
  };
  let hermesHome = flags["hermes-home"] ? path.resolve(flags["hermes-home"]) : null;
  if (!hermesHome && !testing(env)) {
    const own = workspace && path.join(workspace, ".godspeed", "integrated-runtime", "hermes");
    const win = path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Godspeed Mission Control Full Alpha State", "hermes-profile");
    if (own && fs.existsSync(own)) hermesHome = own;
    else if (env.HERMES_HOME && fs.existsSync(env.HERMES_HOME)) hermesHome = path.resolve(env.HERMES_HOME);
    else if (platform === "win32" && fs.existsSync(win)) hermesHome = win;
    else if (prog) {
      const cfg = run(null)(["config", "path"]).stdout.trim().split(/\r?\n/).pop();
      if (cfg && fs.existsSync(path.dirname(cfg))) hermesHome = path.dirname(cfg);
    }
  }
  return { home: hermesHome, hermes: run(hermesHome), found: !!prog };
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

// Switched on in Hermes' own settings, when there is no hermes command: the plugin's name added
// to the list under `plugins:` / `enabled:`, once, and nothing else changed.
export function enableInConfig(file, name) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return false; }
  const lines = text.split("\n");
  const p = lines.findIndex((l) => /^plugins:\s*$/.test(l));
  if (p < 0) return false;
  const e = lines.findIndex((l, i) => i > p && /^\s+enabled:\s*$/.test(l));
  if (e < 0 || lines.slice(p + 1, e).some((l) => /^\S/.test(l))) return false;
  const indent = `${lines[e].match(/^\s*/)[0]}  `;
  for (let i = e + 1; i < lines.length && lines[i].startsWith(indent); i++) if (lines[i].trim().replace(/^-\s*/, "").replace(/^["']|["']$/g, "") === name) return true;
  lines.splice(e + 1, 0, `${indent}- ${name}`);
  fs.writeFileSync(file, lines.join("\n"));
  return true;
}

export function installRecipe(workspace, pkgDir, { version }) {
  const out = [];
  for (const name of RECIPES) {
    const src = path.join(pkgDir, "skill", name);
    if (!fs.existsSync(path.join(src, "SKILL.md"))) continue;
    const dst = path.join(workspace, "skills", name);
    if (fs.existsSync(dst) && !fs.existsSync(path.join(dst, MARKER))) { out.push({ ok: false, text: `left alone: ${dst} holds a recipe the person wrote under the same name` }); continue; }
    fs.rmSync(dst, { recursive: true, force: true });
    copyDir(src, dst);
    fs.writeFileSync(path.join(dst, MARKER), `${NAME} ${version}\n`);
    out.push({ ok: true, text: `recipe ${dst}`, file: dst });
  }
  return out;
}

export function installPlugin(h, pkgDir, argv) {
  if (!h.home) return { ok: false, text: "Hermes was not found here, so the assistant gets no plugin (add --hermes-home <folder> if it lives elsewhere)" };
  const dst = path.join(h.home, "plugins", PLUGIN);
  const wasThere = fs.existsSync(dst);
  fs.rmSync(dst, { recursive: true, force: true });
  copyDir(path.join(pkgDir, "hermes", "plugin", PLUGIN), dst);
  fs.writeFileSync(path.join(dst, "launcher.json"), `${JSON.stringify({ argv }, null, 2)}\n`);
  const en = h.hermes(["plugins", "enable", PLUGIN]);
  let enabled = en.status === 0;
  let how = "hermes plugins enable";
  if (!enabled && enableInConfig(path.join(h.home, "config.yaml"), PLUGIN)) { enabled = true; how = "its config.yaml"; }
  return { ok: true, wasThere, dir: dst, enabled, text: enabled ? `plugin ${dst}, switched on (${how})` : `plugin copied to ${dst}; switch it on with: hermes plugins enable ${PLUGIN}` };
}

export function removeAll(h, workspace) {
  const out = [];
  if (h.home && fs.existsSync(path.join(h.home, "plugins", PLUGIN))) {
    h.hermes(["plugins", "disable", PLUGIN]);
    fs.rmSync(path.join(h.home, "plugins", PLUGIN), { recursive: true, force: true });
    out.push(`removed the plugin from ${h.home}`);
  }
  for (const name of RECIPES) {
    const dst = workspace && path.join(workspace, "skills", name);
    if (!dst || !fs.existsSync(dst)) continue;
    if (!fs.existsSync(path.join(dst, MARKER))) { out.push(`left alone: ${dst} was not put there by the Clerk`); continue; }
    fs.rmSync(dst, { recursive: true, force: true });
    out.push(`removed ${dst}`);
  }
  return out;
}

// The recipe saved in the Godspeed folder's history, when that folder is a Git repository.
export function commitRecipe(workspace, files, message) {
  if (!files.length || !fs.existsSync(path.join(workspace, ".git"))) return null;
  const rel = files.map((f) => path.relative(workspace, f));
  const git = (args) => spawnSync("git", ["-C", workspace, ...args], { encoding: "utf8", windowsHide: true, timeout: 60000 });
  git(["add", "-A", "--", ...rel]);
  const r = git(["commit", "-m", message, "--", ...rel]);
  return r.status === 0;
}
