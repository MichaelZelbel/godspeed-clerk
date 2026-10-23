// drive connect | finish | folder | status | disconnect: the Google Drive connection (F8).
import { DEFAULT_PORT, clientFromFile, disconnect, finishSignIn, readDriveConnection, startSignIn, waitForBrowser } from "../core/oauth.mjs";
import { Drive, FOLDER, DriveAccessLost } from "../core/drive.mjs";
import { readJson, writeJson } from "../core/files.mjs";
import { findRestoreCopy } from "../core/restore.mjs";

export const meta = {
  name: "drive",
  summary: "Connect Google Drive and name the documents folder.",
  usage: "drive connect|finish|folder|status|disconnect",
  flags: { value: ["client-id", "client-secret", "client-file", "port", "login-hint"], bool: ["wait"] },
};

function folderId(arg) {
  const s = String(arg).trim();
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null;
}

async function connect(ctx) {
  let clientId = ctx.flags["client-id"] || ctx.env.GODSPEED_CLERK_GOOGLE_CLIENT_ID;
  let clientSecret = ctx.flags["client-secret"] || ctx.env.GODSPEED_CLERK_GOOGLE_CLIENT_SECRET || "";
  if (ctx.flags["client-file"]) ({ clientId, clientSecret } = clientFromFile(ctx.flags["client-file"]));
  if (!clientId) {
    ctx.fail("The Clerk needs your own Google app (a \"Desktop app\" client with the Drive API on). Give it with --client-file <the downloaded JSON>, or --client-id and --client-secret. docs/google-drive.md says how to make one.");
    return 1;
  }
  const port = Number(ctx.flags.port) || DEFAULT_PORT;
  const { url } = startSignIn(ctx.paths, { clientId, clientSecret, port, loginHint: ctx.flags["login-hint"] || "", env: ctx.env });
  ctx.print([
    "Open this link and sign in with the Google account that holds your documents:",
    "",
    url,
    "",
    "Google then asks to let your app \"see, edit, create and delete all of your Google Drive files\". That is",
    "the only permission that can file into folders you already have. The Clerk itself reads and writes only",
    "inside the documents folder you name and in a folder of its own, and never deletes a file.",
    "",
    `After "Allow" the browser shows an address starting with http://127.0.0.1:${port}/callback that does`,
    "not open. Copy that whole address and hand it back:",
    "",
    "  godspeed-clerk drive finish \"<the address>\"",
  ].join("\n"));
  if (ctx.flags.wait) {
    ctx.print(`\nWaiting up to 10 minutes for the browser on 127.0.0.1:${port}...`);
    const r = await waitForBrowser(ctx.paths, { port, env: ctx.env });
    ctx.print(`Connected to the drive of ${r.account}.`);
  }
  return 0;
}

async function finish(ctx) {
  if (!ctx.rest[1]) { ctx.fail("Give the whole address the browser showed after \"Allow\"."); return 1; }
  try {
    const r = await finishSignIn(ctx.paths, ctx.rest[1], { env: ctx.env });
    const state = readJson(ctx.paths.state, {});
    if (state.drive?.lost_since) { delete state.drive.lost_since; state.drive.reconnected_at = new Date().toISOString(); writeJson(ctx.paths.state, state); }
    ctx.print(`Connected to the drive of ${r.account}.${r.keptFolder ? " The documents folder stays as it was; filing goes on with the next run." : r.changedAccount ? " This is another account than before: name its documents folder with `godspeed-clerk drive folder`, then propose a new folder plan." : " Next: name the documents folder with `godspeed-clerk drive folder <its link or name>`."}`);
    // F9: a new installation pointed at a drive with a restore copy offers to rebuild.
    if (!readJson(ctx.paths.plan, null)) {
      try {
        const found = await findRestoreCopy(new Drive({ creds: readDriveConnection(ctx.paths), env: ctx.env }));
        if (found?.restore) ctx.print(`This drive holds a restore copy of a Paperless the Clerk installed (${found.restore.made_at.slice(0, 10)}: ${found.restore.documents} documents). To rebuild Paperless from it instead of starting empty: godspeed-clerk restore`);
      } catch { /* looked for, not found */ }
    }
    return 0;
  } catch (e) { ctx.fail(`Not connected: ${e.message}`); return 1; }
}

async function folder(ctx) {
  const c = readDriveConnection(ctx.paths);
  if (!c) { ctx.fail("Connect Google Drive first: godspeed-clerk drive connect"); return 1; }
  const arg = ctx.rest.slice(1).join(" ").trim();
  if (!arg) { ctx.fail("Name the documents folder: its link from the browser, or its name when it sits at the top of your drive."); return 1; }
  const drive = new Drive({ creds: c, env: ctx.env });
  let f = null;
  try {
    const id = folderId(arg);
    if (id) f = await drive.get(id);
    else {
      // Only a folder at the top of the drive is looked up by name; nothing else is listed.
      const q = `name = '${arg.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and mimeType = '${FOLDER}' and 'root' in parents and trashed = false`;
      const hits = await drive.list(q, "id,name,mimeType,trashed");
      if (hits.length > 1) { ctx.fail(`There are ${hits.length} folders called "${arg}" at the top of your drive; give the link of the right one.`); return 1; }
      f = hits[0] || null;
    }
  } catch (e) {
    if (e instanceof DriveAccessLost) { ctx.fail("Google no longer accepts the connection; connect again with: godspeed-clerk drive connect"); return 1; }
    throw e;
  }
  if (!f || f.trashed || f.mimeType !== FOLDER) { ctx.fail(`No folder "${arg}" was found${folderId(arg) ? "" : " at the top of your drive; give its link instead"}.`); return 1; }
  const plan = readJson(ctx.paths.plan, null);
  writeJson(ctx.paths.drive, { ...c, root: { id: f.id, name: f.name } });
  if (plan && plan.root?.id !== f.id) writeJson(ctx.paths.plan, { ...plan, status: "stale" });
  ctx.print(`The documents folder is "${f.name}". Next: godspeed-clerk plan propose`);
  return 0;
}

function status(ctx) {
  const c = readJson(ctx.paths.drive, null);
  const s = readJson(ctx.paths.state, {});
  if (!c?.refresh_token) { ctx.print(c?.disconnected_at ? "Google Drive: disconnected." : "Google Drive: not connected."); return 0; }
  ctx.print([`Google Drive: ${c.account}`, `  documents folder: ${c.root ? c.root.name : "not named yet"}`, `  access: ${s.drive?.lost_since ? `LOST since ${s.drive.lost_since}; connect again with: godspeed-clerk drive connect` : "ok as far as the last run knows"}`].join("\n"));
  return 0;
}

export async function run(ctx) {
  const sub = ctx.rest[0];
  if (sub === "connect") return connect(ctx);
  if (sub === "finish") return finish(ctx);
  if (sub === "folder") return folder(ctx);
  if (sub === "status" || !sub) return status(ctx);
  if (sub === "disconnect") { ctx.print(`Google Drive: ${await disconnect(ctx.paths, { env: ctx.env })}.`); return 0; }
  ctx.fail(`Unknown: drive ${sub}. Try: godspeed-clerk drive connect|finish|folder|status|disconnect`);
  return 1;
}
