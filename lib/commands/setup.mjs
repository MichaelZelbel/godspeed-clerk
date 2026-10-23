// setup: add the Clerk (F1). With --paperless it connects to a Paperless that already exists and
// changes nothing in it (the connect path). Without it, on a server: a Paperless the Clerk installed
// before is connected again; a Paperless found running here is offered instead of a second one;
// otherwise the Clerk asks "Install Paperless now?" (yes by default, and yes without a keyboard) and
// installs it (lib/install). Then it copies the program, names the AI that will read the documents,
// and starts the background service. A first setup leaves the Clerk paused: it sorts and files only
// on `godspeed-clerk resume`, after Google Drive is connected and the folder plan confirmed. Run
// again (the install line is also the update), it keeps every setting, connection and record.
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
import { readJson } from "../core/files.mjs";
import { installPaperless, findExisting, phoneWords } from "../install/install.mjs";
import { Host } from "../install/host.mjs";
import { heal } from "../install/https.mjs";
import { starterFor } from "../install/starter.mjs";

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

// What the notes are and where they go, in plain words (F10, F11), said once at setup.
export function notebookWords(settings) {
  return [
    `Notes: every document gets a note in your Godspeed notebook, in the folder "${settings.notebook_folder}", with its full text, a short summary, the key facts and links, and an item in the collection "${settings.collection}".`,
    "Notes travel wherever your notebook syncs, for example a private Git repository.",
    `A document with the tag "${settings.tags.not_in_notebook}" gets no note. To keep a document out completely, set the tag before the note is written: added later, the Clerk takes its own text out of the note, but the notebook's history (and the Git repository it syncs to) keeps the earlier versions.`,
    // F19, said once at setup.
    `Sorting in Paperless: when the plan is confirmed, the Clerk adds one storage path to Paperless for each folder of your plan and a "${settings.to_sort}" page that lists the papers it could not place. Pick a storage path for such a paper and the Clerk moves it into that folder in your drive and remembers it for that sender. If your Paperless already has storage paths of its own, you are asked first, and with your "no" they stay as they are.`,
    // F15, said once at setup.
    "Deadlines: a letter that asks you to do something by a date becomes a deadline in Godspeed, which reminds you as the day comes, like any deadline. When a period runs from the day the letter reached you, which it does not print, the Clerk counts from the letter's own date, the earliest the day can be, and asks you to check the date. Once you change or close such a deadline, it is yours: the Clerk never changes it again.",
  ].join("\n");
}

async function ask(question, fallback) {
  if (!process.stdin.isTTY) return fallback;
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(String(a).trim() || fallback); }));
}
const USER = /^[A-Za-z0-9_.@+-]{1,150}$/;

// Connects the Clerk to its Paperless. Returns what installPaperless gave (or null for the connect
// path), or false when setup stops (it said why).
async function paperlessFor(ctx, { first }) {
  const rec = readJson(ctx.paths.installed, null);
  const conn = readJson(ctx.paths.paperless, null);
  if (ctx.flags.paperless || (conn?.url && !rec)) { ctx.print((await connectPaperless(ctx)).join("\n")); return null; }
  if (rec?.stage === "done") {
    // The Clerk's own Paperless, run again (an update of the Clerk): its token, its address checked.
    const h = new Host(rec, { log: () => {} });
    const tok = h.token(rec.user);
    Object.assign(ctx.flags, { paperless: `http://127.0.0.1:${rec.port}`, user: rec.user, token: tok.token });
    ctx.print((await connectPaperless(ctx)).join("\n"));
    const r = await heal({ host: rec.host, port: rec.https_port, upstream: rec.port });
    ctx.print(`Paperless ${rec.version}, installed by the Clerk, at ${rec.address}${r.healed ? " (its web address was put back)" : ""}.`);
    return null;
  }
  if (!rec) {
    const other = process.platform === "linux" ? findExisting() : null;
    if (other) {
      const where = other.port ? `http://127.0.0.1:${other.port}` : "<its address>";
      ctx.print(`A Paperless already runs on this server (${other.name}). The Clerk works with it instead of installing a second one, and changes nothing in it.`);
      const user = ctx.flags.user || (await ask("Your account in that Paperless: ", ""));
      if (!user || !other.port) { ctx.fail(`Connect it with: godspeed-clerk setup --paperless ${where} --user <your account>`); return false; }
      Object.assign(ctx.flags, { paperless: where, user });
      ctx.print((await connectPaperless(ctx)).join("\n"));
      return null;
    }
    if (ctx.flags["no-install"]) { ctx.fail("No Paperless here, and --no-install: nothing was installed. Connect one that runs elsewhere with: godspeed-clerk setup --paperless <its address> --user <your account>"); return false; }
    const yes = ctx.flags.yes ? "y" : await ask("There is no Paperless on this server. Install Paperless now? [Y/n] ", "y");
    if (!/^y/i.test(yes)) { ctx.fail("Nothing was installed. Connect a Paperless that runs elsewhere with: godspeed-clerk setup --paperless <its address> --user <your account>"); return false; }
  }
  const fallback = ctx.env.SUDO_USER && ctx.env.SUDO_USER !== "root" ? ctx.env.SUDO_USER : "me";
  const user = rec?.user || ctx.flags.user || (await ask(`Your name for signing in to Paperless [${fallback}]: `, fallback));
  if (!USER.test(user)) { ctx.fail(`"${user}" cannot be a Paperless account name: letters, digits and . _ @ + - only.`); return false; }
  if (ctx.flags["paperless-version"] && ctx.env.GODSPEED_CLERK_TEST !== "1") { ctx.fail("--paperless-version is for the Clerk's own tests; the Clerk installs the newest Paperless it was tested with."); return false; }
  const s = readJson(ctx.paths.settings, {});
  const res = await installPaperless(ctx, { user, language: s.language || "English", chatLanguage: s.chat_language || s.language || "English", host: ctx.flags.host, version: ctx.flags["paperless-version"], clerkVersion: VERSION }, { print: ctx.print });
  if (!res.ok) {
    if (res.missing) ctx.fail(["Paperless was not installed, because:", ...res.missing.map((m) => `- ${m}`)].join("\n"));
    else ctx.fail(`Paperless is not ready: ${res.why} Run this line again once that is fixed; it carries on where it stopped.`);
    return false;
  }
  if (!res.addressOk) ctx.print(`Paperless runs, but its web address ${res.rec.address} did not answer from this server yet (${res.addressWhy}). If the hosting provider has a firewall, it must let in port ${res.rec.https_port}.`);
  // The Clerk's words for its tags and its To sort folder, in the person's language (the starter set's).
  const st = starterFor(res.rec.chat_language);
  ctx.settings = saveSettings(ctx.paths, first || !s.paperless_web ? { tags: st.tags, to_sort: st.to_sort, paperless_web: res.rec.address } : { paperless_web: res.rec.address });
  Object.assign(ctx.flags, { paperless: `http://127.0.0.1:${res.rec.port}`, user, token: res.token });
  ctx.print((await connectPaperless(ctx)).join("\n"));
  return res;
}

export const commands = [
  {
    meta: {
      name: "setup",
      summary: "Add the Clerk: install Paperless on this server (or connect to one that exists), name the AI, start the service.",
      usage: "setup [--paperless <address> --user <name>] [--user <name> --language <your papers' language> --chat-language <yours>] [--no-install] [--godspeed <folder>]",
      flags: { value: ["sorting", "language", "country", "chat-language", "host", "paperless-version"], bool: ["no-service", "no-copy", "paused", "no-install", "yes"] },
    },
    async run(ctx) {
      ensurePrivateDir(ctx.paths.root);
      const first = !fs.existsSync(ctx.paths.settings);
      const patch = {};
      const workspace = findMissionControl({ arg: ctx.flags.godspeed, env: ctx.env });
      if (workspace) patch.workspace = workspace;
      if (ctx.flags.sorting) { if (!SORTING.includes(ctx.flags.sorting)) { ctx.fail("--sorting is godspeed, paperless or nobody"); return 1; } patch.sorting = ctx.flags.sorting; }
      if (ctx.flags.language) patch.language = ctx.flags.language;
      if (ctx.flags["chat-language"]) patch.chat_language = ctx.flags["chat-language"];
      if (ctx.flags.country) patch.country = String(ctx.flags.country).toUpperCase();
      // Paused on the first setup only: run again (an update), the Clerk goes on as it was.
      if (first || ctx.flags.paused) patch.active = false;
      ctx.settings = saveSettings(ctx.paths, patch);

      let installed = null;
      try {
        installed = await paperlessFor(ctx, { first });
        if (installed === false) return 1;
      } catch (e) { ctx.fail(`Paperless: not connected: ${e.message}`); return 1; }

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
      if (installed?.login) ctx.print(["", `Paperless runs at ${installed.rec.address}. The Clerk installed it, keeps it running, updates it and copies it to your drive every night.`, phoneWords(installed.rec, installed.login), "(godspeed-clerk phone shows this again.)"].join("\n"));
      if (!ctx.settings.active) ctx.print([
        "",
        notebookWords(ctx.settings),
        "",
        `The Clerk is set up and PAUSED: it reads and writes nothing until it is resumed. State: ${ctx.paths.root}`,
        "Next:",
        "  godspeed-clerk drive connect --client-file <your Google app's JSON>   (then: drive finish \"<address>\")",
        "  godspeed-clerk drive folder <link or name of your documents folder>",
        "  godspeed-clerk plan propose, then plan confirm",
        "  godspeed-clerk resume",
      ].join("\n"));
      else ctx.print(`The Clerk ${VERSION} is set up and goes on as it was. State: ${ctx.paths.root}`);
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

