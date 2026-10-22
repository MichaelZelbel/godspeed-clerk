// The AI, only through Godspeed's own connection (F12).
//
// The Clerk has no AI route of its own and no backup of its own. Every request goes to Godspeed's
// `godspeed-model` command (contract: docs/full-version/addon-model.md in the Godspeed product),
// which uses the assistant connection the person chose, gives the model no tools and no memory,
// and keeps no prompt.
//
// THE ROUTE CHECK. At setup the person is told which provider will read their papers, and that
// provider (and a backup, if Godspeed has one) is recorded as approved. Before the first text of
// a run leaves, `--check` is asked again: when Godspeed now names a provider or a backup that was
// not approved, the run sends nothing and says so. Nothing is approved until setup records it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class ModelUnavailable extends Error {
  constructor(message) { super(message); this.name = "ModelUnavailable"; }
}
export class RouteRefused extends Error {
  constructor(message) { super(message); this.name = "RouteRefused"; }
}

export function modelProgram({ env = process.env, workspace, home = os.homedir(), platform = process.platform, extraDirs } = {}) {
  const viaNode = (f) => ({ exe: process.execPath, args: [f] });
  const cmd = env.GODSPEED_MODEL_COMMAND;
  if (cmd) return /\.(mjs|cjs|js)$/i.test(cmd) ? viaNode(cmd) : { exe: cmd, args: [] };
  const launcher = workspace && path.join(workspace, ".godspeed", "model.mjs");
  if (launcher && fs.existsSync(launcher)) return viaNode(launcher);
  const names = platform === "win32" ? ["godspeed-model.cmd", "godspeed-model.exe"] : ["godspeed-model"];
  const dirs = [...String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean),
    ...(extraDirs ?? [path.join(home, ".godspeed", "bin"), ...(platform === "win32" ? [] : ["/usr/local/bin"])])];
  for (const d of dirs) for (const n of names) {
    const f = path.join(d, n);
    try { if (fs.statSync(f).isFile()) return { exe: f, args: [] }; } catch { /* not here */ }
  }
  return null;
}

function run(prog, args, input, { env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let child;
    // A .cmd needs a shell on Windows; nothing of the request is put on its command line.
    const shell = process.platform === "win32" && /\.cmd$/i.test(prog.exe);
    try { child = spawn(prog.exe, [...prog.args, ...args], { cwd: os.tmpdir(), env, windowsHide: true, shell }); } catch (e) { reject(e); return; }
    let out = "", err = "", done = false;
    const timer = setTimeout(() => finish(new Error(`no answer within ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs);
    const finish = (e, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (e) { try { child.kill("SIGKILL"); } catch { /* gone */ } reject(e); } else resolve(v);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { out += d; if (out.length > 4 * 1024 * 1024) finish(new Error("the answer was too long")); });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => finish(e));
    child.on("close", (code) => finish(null, { code, out, err }));
    child.stdin.on("error", () => { /* a program that exits early */ });
    child.stdin.end(input);
  });
}

function need(opts) {
  const prog = modelProgram(opts);
  if (!prog) throw new ModelUnavailable("Godspeed's model connection (godspeed-model) was not found on this computer; update Godspeed Mission Control");
  if (!opts.workspace) throw new ModelUnavailable("the Godspeed folder was not found, so there is no model connection to use");
  return prog;
}

export async function describe({ workspace, env = process.env, home, extraDirs, timeoutMs = 30000 } = {}) {
  const prog = need({ env, workspace, home, extraDirs });
  let r;
  try { r = await run(prog, ["--check", "--workspace", workspace], "", { env, timeoutMs }); } catch (e) { throw new ModelUnavailable(`Godspeed's model connection did not answer: ${e.message}`); }
  let a = null;
  try { a = JSON.parse(r.out); } catch { /* below */ }
  if (r.code !== 0 || !a || a.configured !== true || !a.provider) throw new ModelUnavailable("Godspeed has no configured model connection");
  return { provider: a.provider, model: a.model || "", backup: a.backup?.provider ? { provider: a.backup.provider, model: a.backup.model || "" } : null };
}

export function routeCheck(settings, d) {
  const ok = new Set(settings.approved_ai || []);
  if (!ok.size) return ["no AI has been approved to read documents yet (setup records it, or: godspeed-clerk ai approve)"];
  const out = [];
  if (!ok.has(d.provider)) out.push(`Godspeed now answers with ${d.provider}, which was not approved to read documents`);
  if (d.backup && !ok.has(d.backup.provider)) out.push(`Godspeed's backup AI ${d.backup.provider} was not approved to read documents`);
  return out;
}

// ask({system, prompt, timeoutMs}) -> {text, provider, model, backup}. The route is checked once,
// before the first request of this asker leaves.
export function makeAsker({ settings, workspace, env = process.env, home, extraDirs }) {
  let checked = null;
  return async function ask({ system, prompt, timeoutMs = 120000 }) {
    if (!checked) {
      const d = await describe({ workspace, env, home, extraDirs });
      const bad = routeCheck(settings, d);
      if (bad.length) throw new RouteRefused(`${bad.join("; ")}. Nothing was sent.`);
      checked = d;
    }
    const prog = need({ env, workspace, home, extraDirs });
    const ms = Math.max(1000, Math.min(240000, timeoutMs));
    let r;
    try {
      r = await run(prog, ["--workspace", workspace], JSON.stringify({ system, prompt, timeout_ms: ms, max_tokens: 2048 }), { env, timeoutMs: ms + 15000 });
    } catch (e) { throw new ModelUnavailable(`no answer from Godspeed's model connection: ${e.message}`); }
    let a = null;
    try { a = JSON.parse(r.out); } catch { /* below */ }
    if (r.code !== 0 || !a || typeof a.text !== "string" || !a.text.trim()) {
      throw new ModelUnavailable(`no usable answer from Godspeed's model connection (exit ${r.code})${r.err ? `: ${r.err.trim().slice(-200)}` : ""}`);
    }
    // A backup that answered must be an approved one too; its answer is not used otherwise.
    if (a.provider && !(settings.approved_ai || []).includes(a.provider)) throw new RouteRefused(`the answer came from ${a.provider}, which was not approved; it was not used`);
    return { text: a.text, provider: a.provider || checked.provider, model: a.model || "", backup: !!a.backup };
  };
}
