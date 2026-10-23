// F1, the install path: no Paperless on this server, so the Clerk installs one, the way it was done
// by hand on 22 October 2026, and the person never deals with Paperless's setup.
//
//   1. the size check: nothing is installed when the server is too small (room.mjs);
//   2. the address: the server's name from the Caddy that gives Godspeed's notebook its address
//      (https.mjs); without one the Clerk stops and says why;
//   3. Paperless pinned to the newest tested version, with memory limits (stack.mjs), started;
//   4. the person's account (a password made for them), its one token for the Clerk, the starter
//      types and tags in their language, the second factor switched on (host.mjs);
//   5. the HTTPS address added to Caddy, and checked from this server.
// Every step looks for its own result first, so running the line again after a stop carries on
// where it stopped and never makes a second account, a new database password or a second site.
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson, ensurePrivateDir } from "../core/files.mjs";
import { measure, roomCheck } from "./room.mjs";
import { findFront, serverName, freePort, publish, addressAnswers } from "./https.mjs";
import { Host, INSTALL_DIR, newRecord, newPassword, newSecrets, sh } from "./host.mjs";
import { ocrFor, PROJECT } from "./stack.mjs";
import { newest, imageFor } from "./versions.mjs";
import { starterFor } from "./starter.mjs";
import { otpauthUrl } from "./totp.mjs";

// A Paperless already running on this server, not the Clerk's: { name, port } or null.
export function findExisting({ run = sh } = {}) {
  const r = run("docker", ["ps", "--format", "{{.Names}}|{{.Image}}|{{.Ports}}|{{.Label \"com.docker.compose.project\"}}"]);
  if (r.status !== 0) return null;
  for (const line of r.stdout.split("\n")) {
    const [name, image, ports, project] = line.split("|");
    if (!/paperless-ngx/.test(image || "") || project === PROJECT) continue;
    const m = String(ports || "").match(/(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d+)->8000\/tcp/);
    return { name, port: m ? Number(m[1]) : null };
  }
  return null;
}

function localPort(run) {
  const listening = run("ss", ["-ltnH"]).stdout || "";
  for (let p = 8010; p < 8060; p++) if (!new RegExp(`:${p}\\s`).test(listening)) return p;
  throw new Error("no free port for Paperless on this server");
}

const timezone = (env) => {
  const tz = env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz) ? tz : "UTC";
};

// Returns { ok, rec, token, userId, login, missing, why }. `opts`: user, language, chatLanguage,
// host, version (tests only), clerkVersion. `print` gets progress lines.
export async function installPaperless(ctx, opts, deps = {}) {
  try { return await installSteps(ctx, opts, deps); }
  catch (e) { if (e.name === "HostError") return { ok: false, why: `${e.message}.` }; throw e; }
}

async function installSteps(ctx, opts, { run = sh, fetchImpl = globalThis.fetch, root = "/", print = () => {} } = {}) {
  const { paths, env } = ctx;
  ensurePrivateDir(paths.root);
  let rec = readJson(paths.installed, null);
  const dir = rec?.dir || env.GODSPEED_CLERK_PAPERLESS_DIR || INSTALL_DIR;

  // 1. Room, unless the install was started before (then its programs are there already).
  if (!rec) {
    const room = roomCheck(measure({ dir, run }));
    print(`This server: ${room.summary}.`);
    if (!room.ok) return { ok: false, missing: room.missing };
  }

  // 2. The address.
  const front = findFront({ root, run });
  const host = opts.host || rec?.host || serverName(front, { root });
  if (front.kind === "none" || !host) {
    return { ok: false, missing: [front.kind === "none"
      ? "This server has no web address yet: no Caddy answers on ports 80 and 443. Godspeed's own installer gives a server its address (with a certificate); run it, or update Godspeed, then run this line again."
      : "The Clerk could not find the name this server is reached by in Caddy's settings. Give it with --host <name>, then run this line again."] };
  }

  // 3. Paperless itself.
  const s = starterFor(opts.chatLanguage || opts.language);
  if (!rec) {
    const version = opts.version || newest().version;
    const readAt = (p) => { try { return fs.readFileSync(path.join(root, p), "utf8"); } catch { return ""; } };
    // Ports the server's Caddy already serves (not counting the Clerk's own site from before).
    const texts = [readAt(front.caddyfile), readAt("/etc/caddy/godspeed-notebook.caddy")];
    rec = newRecord({ dir, version, port: localPort(run), host, httpsPort: freePort({ texts, run }), front: front.kind, language: opts.language || "English", chatLanguage: s.language, user: opts.user, clerkVersion: opts.clerkVersion, timezone: timezone(env) });
    writeJson(paths.installed, rec);
  }
  const h = new Host(rec, { run, fetchImpl, log: ctx.log || (() => {}) });
  if (!fs.existsSync(h.file("compose.yaml")) || !fs.existsSync(h.file("paperless.env"))) {
    // The secrets only once: the database is set up with them on its first start.
    h.writeFiles({ image: imageFor(rec.version), port: rec.port, url: rec.address, host: rec.host, ocr: ocrFor(rec.language), timezone: rec.timezone, clerkVersion: opts.clerkVersion, secrets: fs.existsSync(h.file("paperless.env")) ? null : newSecrets() });
  }
  print(`Downloading Paperless ${rec.version} (about 1.5 GB, a few minutes on a fresh server)...`);
  h.must(h.dc(["pull", "-q"]), "downloading Paperless");
  h.up();
  print("Starting Paperless (the first start sets up its database, a minute or two)...");
  if (!(await h.waitUp({ timeoutMs: 15 * 60000 }))) return { ok: false, why: `Paperless did not start within 15 minutes. What it said: docker compose -p ${rec.project} logs webserver` };

  // 4. The account, its token, the starter set, the second factor.
  let login = readJson(paths.login, null);
  const fresh = !login || login.user !== rec.user || !login.password;
  if (fresh) login = { user: rec.user, password: newPassword(), made_at: new Date().toISOString() };
  const acc = h.account(rec.user, login.password);
  // The account was made by an earlier run of this install whose login was lost: a new password.
  if (!acc.made && fresh) h.setPassword(rec.user, login.password);
  const tok = h.token(rec.user);
  const made = await h.starter(tok.token, s, new Date().getFullYear());
  if (made) print(`The starter set in ${s.language}: ${s.types.length} document types and ${made - s.types.length > 0 ? made - s.types.length : 0} tags.`);
  const sf = await h.secondFactor(tok.token);
  if (sf.secret) Object.assign(login, { secret: sf.secret, recovery: sf.recovery, otpauth: otpauthUrl({ secret: sf.secret, account: rec.user, issuer: `Paperless (${rec.host})` }) });
  login.address = rec.address;
  writeJson(paths.login, login);
  rec.stage = "account";
  writeJson(paths.installed, rec);

  // 5. The address.
  const pub = await publish({ front, host: rec.host, port: rec.https_port, upstream: rec.port, root, run });
  if (!pub.ok) return { ok: false, why: pub.why, rec, token: tok.token, userId: tok.id, login };
  print(`Waiting for the certificate of ${rec.address} (seconds to a minute or two)...`);
  const ans = await addressAnswers(rec.address, { fetchImpl });
  rec.stage = "done";
  rec.address_checked = ans.ok ? new Date().toISOString() : null;
  writeJson(paths.installed, rec);
  return { ok: true, rec, token: tok.token, userId: tok.id, login, addressOk: ans.ok, addressWhy: ans.why };
}

// What the person needs for the phone (F2), in plain words for Godspeed's chat.
export function phoneWords(rec, login) {
  const lines = [
    "Your phone, in four steps:",
    "1. On your iPhone, install the free app \"Swift Paperless\" from the App Store.",
    `2. Open it, add a server, and type this address: ${rec.address}`,
    `3. Sign in as ${login?.user || rec.user}${login?.password ? ` with the password ${login.password}` : " with your Paperless password"}.`,
  ];
  if (login?.secret) {
    lines.push(
      "4. The app then asks for a code. That is the second factor: a six-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, or your iPhone's own Passwords app). Add Paperless there once with this setup key:",
      `   ${login.secret.replace(/(.{4})/g, "$1 ").trim()}`,
      `   (or open this link on the phone: ${login.otpauth})`,
      "   Then type the code the authenticator app shows. Paperless asks for it at every new sign-in, so nobody who learns your password can get in.",
      `   If you ever lose the authenticator app, one of these recovery codes signs you in once each: ${(login.recovery || []).join(" ")}`,
    );
  } else {
    lines.push("4. When it asks for a code, type the six digits your authenticator app shows for Paperless.");
  }
  lines.push(
    "Keep the password and the recovery codes in your password manager.",
    "Then scan a letter with the app. The Clerk tells you when your first scan has arrived.",
  );
  return lines.join("\n");
}
