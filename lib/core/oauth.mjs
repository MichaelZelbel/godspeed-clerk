// Signing in to Google, the way Godspeed's own Gmail connection does it (tools/mc-mail-gmail.js
// in the product): the person's own Google app (a "Desktop app" client), PKCE with S256, a random
// state, and an address on this computer (127.0.0.1) that Google sends the answer to.
//
// ON A SERVER WITHOUT A BROWSER the same link is opened on any device. After "Allow", that
// browser goes to http://127.0.0.1:<port>/callback?code=...&state=..., which does not open there
// (nothing listens on that device). The person hands that whole address back, through their
// assistant: `godspeed-clerk drive finish "<address>"`. The code in it is useless to anyone else:
// it only works with the secret verifier kept here, and only once, within minutes. With an SSH
// tunnel to the server (`ssh -L <port>:127.0.0.1:<port>`), `drive connect --wait` catches it
// itself.
//
// Kept: drive.json (readable by its owner only) with the client, the lasting refresh token, the
// account and the documents folder. Nothing is printed that would let anyone else use it.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { DRIVE_SCOPE, Drive, endpoints } from "./drive.mjs";
import { readJson, writeJson } from "./files.mjs";

export const DEFAULT_PORT = 47863;
const PENDING_MINUTES = 60;

export function readDriveConnection(paths) {
  const c = readJson(paths.drive, null);
  return c && c.refresh_token ? c : null;
}

export function clientFromFile(file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const c = j.installed || j.web || j;
  if (!c.client_id) throw new Error("that file holds no client_id (download the JSON of a Desktop app client in Google Cloud)");
  return { clientId: c.client_id, clientSecret: c.client_secret || "" };
}

export function startSignIn(paths, { clientId, clientSecret = "", port = DEFAULT_PORT, loginHint = "", env = process.env }) {
  if (!/\.apps\.googleusercontent\.com$/.test(String(clientId || ""))) throw new Error("that does not look like a Google client ID (it ends in .apps.googleusercontent.com)");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");
  const redirect = `http://127.0.0.1:${port}/callback`;
  writeJson(paths.pendingOauth, { client_id: clientId, client_secret: clientSecret, verifier, state, redirect, at: new Date().toISOString() });
  const q = { client_id: clientId, redirect_uri: redirect, response_type: "code", scope: DRIVE_SCOPE, access_type: "offline", prompt: "consent",
    state, code_challenge: challenge, code_challenge_method: "S256", ...(loginHint ? { login_hint: loginHint } : {}) };
  return { url: `${endpoints(env).auth}?${new URLSearchParams(q)}`, redirect };
}

export async function finishSignIn(paths, pasted, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const p = readJson(paths.pendingOauth, null);
  if (!p) throw new Error("no sign-in is waiting; start one with: godspeed-clerk drive connect");
  if (Date.now() - new Date(p.at).getTime() > PENDING_MINUTES * 60000) throw new Error("that sign-in is more than an hour old; start a new one with: godspeed-clerk drive connect");
  let u;
  try { u = new URL(String(pasted).trim().replace(/^["']|["']$/g, "")); } catch { throw new Error("give the whole address the browser showed after \"Allow\" (it starts with http://127.0.0.1)"); }
  const q = u.searchParams;
  if (!q.get("state") && !q.get("error")) throw new Error("give the whole address the browser showed after \"Allow\"; it has no state in it");
  if (q.get("state") !== p.state) throw new Error("that address is not the sign-in this Clerk started; nothing was changed");
  if (q.get("error")) throw new Error(`you did not allow access (${q.get("error")}); nothing was connected`);
  const code = q.get("code");
  if (!code) throw new Error("that address has no code in it");

  let res, tok = {};
  try {
    res = await fetchImpl(endpoints(env).token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: p.client_id, client_secret: p.client_secret || "", code_verifier: p.verifier, grant_type: "authorization_code", redirect_uri: p.redirect }).toString(),
      signal: AbortSignal.timeout(30000) });
    tok = await res.json().catch(() => ({}));
  } catch (e) { throw new Error(`Google was not reached: ${e.cause?.code || e.message}`); }
  if (!res.ok || !tok.refresh_token) throw new Error(`Google did not hand over a lasting connection (${tok.error || res.status}); start again with: godspeed-clerk drive connect`);
  const granted = String(tok.scope || "").split(/\s+/);
  if (!granted.includes(DRIVE_SCOPE)) throw new Error("Google granted less than the whole drive, which the Clerk needs to file into your own folders; nothing was kept. Tick the Drive box on Google's screen and start again");

  const creds = { client_id: p.client_id, client_secret: p.client_secret || "", refresh_token: tok.refresh_token };
  const user = await new Drive({ creds, env, fetchImpl }).about();
  const before = readJson(paths.drive, null);
  const same = before?.account && before.account === user.emailAddress;
  writeJson(paths.drive, { ...creds, account: user.emailAddress, scope: DRIVE_SCOPE, connected_at: new Date().toISOString(), root: same ? before.root || null : null });
  fs.rmSync(paths.pendingOauth, { force: true });
  return { account: user.emailAddress, keptFolder: !!(same && before.root), changedAccount: !!(before?.account && !same) };
}

// The browser on this computer (or through a tunnel): catch the answer ourselves.
export function waitForBrowser(paths, { port = DEFAULT_PORT, timeoutMs = 10 * 60000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${port}`);
      if (u.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
      const page = (msg, ok) => { res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" }); res.end(`<!doctype html><meta charset="utf-8"><title>The Clerk</title><p style="font:16px sans-serif;margin:3em">${msg}</p>`); };
      try {
        const r = await finishSignIn(paths, u.toString(), { env });
        page(`Done. The Clerk is connected to the drive of ${r.account}. You can close this tab.`, true);
        server.close();
        resolve(r);
      } catch (e) {
        page(`Not connected: ${e.message}`, false);
        server.close();
        reject(e);
      }
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1");
    setTimeout(() => { server.close(); reject(new Error("no answer from the browser within 10 minutes; the link still works with: godspeed-clerk drive finish \"<address>\"")); }, timeoutMs).unref();
  });
}

export async function disconnect(paths, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const c = readJson(paths.drive, null);
  const mark = () => {
    const { refresh_token, ...rest } = c || {};
    writeJson(paths.drive, { ...rest, disconnected_at: new Date().toISOString() });
    const state = readJson(paths.state, {});
    if (state.drive?.lost_since) { delete state.drive.lost_since; writeJson(paths.state, state); }
  };
  if (!c?.refresh_token) { mark(); return "disconnected; sorting, notebook notes and deadlines continue without Drive"; }
  let google = "Google was asked to forget the permission";
  try {
    const r = await fetchImpl(env.GODSPEED_CLERK_GOOGLE_REVOKE_URL || "https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: c.refresh_token }).toString(), signal: AbortSignal.timeout(20000) });
    if (!r.ok) google = "Google did not confirm; remove it at myaccount.google.com/permissions";
  } catch { google = "Google was not reached; remove it at myaccount.google.com/permissions"; }
  mark();
  return `disconnected; ${google}. Sorting, notebook notes and deadlines continue without Drive`;
}
