// Where things live.
//
// Everything the Clerk keeps is in one private state folder, never in git and never in the mission
// control folder: its settings, the Paperless and Google connections, the folder plan, one record
// per document, the log and the outbox. Linux as root: /var/lib/godspeed/clerk; otherwise
// ~/.godspeed/clerk. GODSPEED_CLERK_STATE names another one (the tests use that).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const NAME = "godspeed-clerk";

export const isRoot = () => typeof process.getuid === "function" && process.getuid() === 0;

export function stateDir({ env = process.env, platform = process.platform, root = isRoot(), home = os.homedir() } = {}) {
  if (env.GODSPEED_CLERK_STATE) return path.resolve(env.GODSPEED_CLERK_STATE);
  if (platform === "linux" && root) return "/var/lib/godspeed/clerk";
  return path.join(home, ".godspeed", "clerk");
}

export function statePaths(dir) {
  const p = (...a) => path.join(dir, ...a);
  return {
    root: dir,
    settings: p("settings.json"),        // the person's choices: who sorts, names, batches
    paperless: p("paperless.json"),      // address, account and the account's existing token
    drive: p("drive.json"),              // the Google connection and the documents folder
    plan: p("plan.json"),                // the folder plan, proposed or confirmed
    state: p("state.json"),              // the last run, Drive access, counts
    records: p("records"),               // one file per document: numbers, marks, folders, hashes
    log: p("clerk.log"),                 // one line per step, documents by number only
    outbox: p("outbox.jsonl"),           // what the person should hear about (sent by Godspeed, batch 2)
    pendingOauth: p("google-sign-in.json"),
    lock: p("run.lock"),
    tmp: p("tmp"),
  };
}

// Where the program is copied to, and where its command goes.
export function appDir({ env = process.env, platform = process.platform, root = isRoot(), home = os.homedir() } = {}) {
  if (env.GODSPEED_CLERK_APP) return path.resolve(env.GODSPEED_CLERK_APP);
  if (platform === "linux" && root) return "/usr/local/lib/godspeed-clerk";
  return path.join(home, ".godspeed", "addons", NAME);
}

export function binDir({ platform = process.platform, root = isRoot(), home = os.homedir() } = {}) {
  if (platform === "linux" && root) return "/usr/local/bin";
  return path.join(home, ".godspeed", "bin");
}

// The mission control folder, for Godspeed's model connection: the argument, the environment, the
// device file Godspeed writes, the folder this runs in (or one above it), the default folders.
// A folder counts when it holds AGENTS.md or the server installer's model launcher.
export function findMissionControl({ arg, cwd = process.cwd(), userHome = os.homedir(), env = process.env } = {}) {
  const isMc = (d) => !!d && (fs.existsSync(path.join(d, "AGENTS.md")) || fs.existsSync(path.join(d, ".godspeed", "model.mjs")));
  for (const c of [arg, env.GODSPEED_MODEL_WORKSPACE, env.GODSPEED_WORKSPACE, env.GODSPEED_ROOT, env.GODSPEED_DIR]) {
    if (c) return isMc(path.resolve(c)) ? path.resolve(c) : null;
  }
  try {
    const m = fs.readFileSync(path.join(userHome, ".godspeed", "device.env"), "utf8").match(/^\s*GODSPEED_DIR=(.+)$/m);
    if (m) {
      const d = m[1].trim().replace(/^["']|["']$/g, "");
      if (isMc(d)) return path.resolve(d);
    }
  } catch { /* no device file */ }
  let d = path.resolve(cwd);
  for (;;) {
    if (isMc(d)) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  for (const name of ["godspeed-v2", "godspeed"]) {
    const dflt = path.join(userHome, name);
    if (isMc(dflt)) return dflt;
  }
  return null;
}
