// setup: add the Clerk to an existing Paperless (F1, the connect path; installing Paperless itself
// comes in a later version). It copies the program, connects to Paperless (reading only), names
// the AI that will read the documents, and starts the background service. It leaves the Clerk
// paused: it starts sorting and filing only on `godspeed-clerk resume`, after Google Drive is
// connected and the folder plan confirmed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appDir, binDir, findMissionControl, isRoot, NAME } from "../core/paths.mjs";
import { saveSettings, SORTING } from "../core/settings.mjs";
import { ensurePrivateDir } from "../core/files.mjs";
import { connectPaperless } from "./connect.mjs";
import { approveAi } from "./ai.mjs";
import { installService, removeService } from "../setup/service.mjs";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version;

export function serviceKind({ platform = process.platform, root = isRoot() } = {}) {
  if (platform === "win32") return "windows-task";
  if (platform === "darwin") return "launch-agent";
  return root ? "systemd-system" : "systemd-user";
}

function copyProgram(target) {
  if (path.resolve(target) === PKG) return false;
  const tmp = `${target}.new`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (const p of ["bin", "lib", "package.json", "README.md", "LICENSE", "CHANGELOG.md"]) {
    const from = path.join(PKG, p);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(tmp, p), { recursive: true });
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(tmp, target);
  return true;
}

function writeLauncher(dir, script) {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") {
    const f = path.join(dir, `${NAME}.cmd`);
    fs.writeFileSync(f, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    return f;
  }
  const f = path.join(dir, NAME);
  fs.writeFileSync(f, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  return f;
}

export const commands = [
  {
    meta: {
      name: "setup",
      summary: "Add the Clerk to an existing Paperless: connect (reading only), name the AI, start the service.",
      usage: "setup --paperless <address> --user <name> [--godspeed <folder>]",
      flags: { value: ["sorting", "language", "country"], bool: ["no-service", "no-copy", "paused"] },
    },
    async run(ctx) {
      ensurePrivateDir(ctx.paths.root);
      const patch = {};
      const workspace = findMissionControl({ arg: ctx.flags.godspeed, env: ctx.env });
      if (workspace) patch.workspace = workspace;
      if (ctx.flags.sorting) { if (!SORTING.includes(ctx.flags.sorting)) { ctx.fail("--sorting is godspeed, paperless or nobody"); return 1; } patch.sorting = ctx.flags.sorting; }
      if (ctx.flags.language) patch.language = ctx.flags.language;
      if (ctx.flags.country) patch.country = String(ctx.flags.country).toUpperCase();
      patch.active = false;
      ctx.settings = saveSettings(ctx.paths, patch);

      try { ctx.print((await connectPaperless(ctx)).join("\n")); }
      catch (e) { ctx.fail(`Paperless: not connected: ${e.message}`); return 1; }

      try { ctx.print((await approveAi(ctx)).join("\n")); }
      catch (e) { ctx.print(`AI: not approved yet (${e.message}). Nothing will be sorted until then: godspeed-clerk ai approve`); }

      let script = path.join(PKG, "bin", `${NAME}.mjs`);
      if (!ctx.flags["no-copy"]) {
        const target = appDir({ env: ctx.env });
        copyProgram(target);
        script = path.join(target, "bin", `${NAME}.mjs`);
        ctx.print(`Program: ${target}; command: ${writeLauncher(binDir(), script)}`);
      }
      if (!ctx.flags["no-service"]) {
        const p = { service: serviceKind(), node: process.execPath, script, stateDir: ctx.paths.root, version: VERSION, path: ctx.env.PATH || "/usr/local/bin:/usr/bin:/bin", home: os.homedir() };
        const r = installService(p);
        ctx.print(`Service: ${r.text}`);
        if (!r.ok) return 1;
      }
      ctx.print([
        "",
        `The Clerk is set up and PAUSED: it reads and writes nothing until it is resumed. State: ${ctx.paths.root}`,
        "Next:",
        "  godspeed-clerk drive connect --client-file <your Google app's JSON>   (then: drive finish \"<address>\")",
        "  godspeed-clerk drive folder <link or name of your documents folder>",
        "  godspeed-clerk plan propose, then plan confirm",
        "  godspeed-clerk resume",
      ].join("\n"));
      return 0;
    },
  },
  {
    meta: { name: "uninstall", summary: "Stop and remove the service and the program. Keeps the records and the drive files.", usage: "uninstall" },
    run(ctx) {
      const r = removeService({ service: serviceKind(), home: os.homedir() });
      ctx.print(`Service: ${r.text}`);
      const target = appDir({ env: ctx.env });
      if (path.resolve(target) !== PKG) fs.rmSync(target, { recursive: true, force: true });
      for (const f of [path.join(binDir(), NAME), path.join(binDir(), `${NAME}.cmd`)]) fs.rmSync(f, { force: true });
      ctx.print(`Removed the program. Kept: ${ctx.paths.root} (settings, connections, records) and every file in the drive. Nothing in Paperless was changed.`);
      return 0;
    },
  },
];

