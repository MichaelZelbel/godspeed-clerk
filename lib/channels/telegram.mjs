// Messages on the person's assistant's own Telegram bot, so they arrive in the chat the person
// already uses, the way the Wingman sends its. The assistant (Hermes) owns the bot; the Clerk only
// sends (sendMessage). The token and the chat are read from that Hermes home's .env file each
// time, never copied anywhere.
//
// Which .env: the setting `telegram_env`; else the one of the Godspeed folder's own assistant
// (<godspeed>/.godspeed/integrated-runtime/hermes/.env, a server installation); else HERMES_HOME,
// Godspeed's Windows Hermes, Hermes' own Windows home, ~/.hermes and its profiles.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function readEnv(file) {
  const out = {};
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function credentials(file) {
  if (!file) return null;
  const env = readEnv(file);
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN || "";
  // The home channel first; else the one allowed user (their private chat with the bot).
  const allowed = String(env.TELEGRAM_ALLOWED_USERS || "").split(/[,\s]+/).filter(Boolean);
  const chat = env.TELEGRAM_HOME_CHANNEL || env.TELEGRAM_CHAT_ID || env.CHAT_ID || (allowed.length === 1 ? allowed[0] : "");
  return token && chat ? { token, chat: String(chat) } : null;
}

// A Hermes home's own .env: .../hermes/.env, .../.hermes/.env, .../hermes-profile/.env, or a
// profile's (.../profiles/<p>/.env). Nothing else is ever read as one.
export function validTelegramEnv(p) {
  if (typeof p !== "string" || !p) return false;
  const n = p.replace(/\\/g, "/");
  if (!/^(\/|[A-Za-z]:\/)/.test(n)) return false;
  const seg = n.split("/").filter(Boolean);
  if (seg.includes("..") || seg.includes(".") || seg[seg.length - 1] !== ".env") return false;
  const home = (s) => [".hermes", "hermes", "hermes-profile"].includes(String(s).toLowerCase());
  return home(seg[seg.length - 2]) || (seg[seg.length - 3] === "profiles" && home(seg[seg.length - 4]));
}

export function envCandidates({ settings = {}, env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const out = [];
  if (settings.workspace) out.push(path.join(settings.workspace, ".godspeed", "integrated-runtime", "hermes", ".env"));
  if (env.HERMES_HOME) out.push(path.join(env.HERMES_HOME, ".env"));
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    out.push(path.join(local, "Godspeed Mission Control Full Alpha State", "hermes-profile", ".env"));
    out.push(path.join(local, "hermes", ".env"));
  }
  const dot = path.join(home, ".hermes");
  out.push(path.join(dot, ".env"));
  try { for (const p of fs.readdirSync(path.join(dot, "profiles")).sort()) out.push(path.join(dot, "profiles", p, ".env")); } catch { /* no profiles */ }
  return [...new Set(out)];
}

export function resolveEnvFile({ settings = {}, env = process.env, home = os.homedir() } = {}) {
  if (settings.telegram_env && validTelegramEnv(settings.telegram_env)) return settings.telegram_env;
  return envCandidates({ settings, env, home }).find((f) => validTelegramEnv(f) && credentials(f)) || null;
}

function apiBase(env) {
  if (env.GODSPEED_CLERK_TELEGRAM_API) {
    if (env.GODSPEED_CLERK_TEST !== "1") throw new Error("a pretend Telegram address is honoured only in test mode");
    return env.GODSPEED_CLERK_TELEGRAM_API.replace(/\/+$/, "");
  }
  return "https://api.telegram.org";
}

// Asked again only when Telegram surely did not take the message: no connection, or it said so
// (busy, a server error). No answer in time is never asked again: the message may have arrived,
// and the person must not get it twice. A message that did not go is sent on a later run.
async function call(base, creds, method, body, timeoutMs = 30000) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${base}/bot${creds.token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      const j = await r.json().catch(() => ({}));
      if (j.ok === true) return j.result;
      last = new Error(`Telegram ${method} refused: ${j.description || r.status}`);
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break; // asking again does not help
    } catch (e) {
      last = e;
      if (e.name === "TimeoutError" || e.name === "AbortError") break;
    }
    if (i < 2) await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  throw last;
}

// Telegram takes 4096 characters. A longer message is shortened in the middle: its last line, the
// link, always stays.
export function fit(text, max = 4000) {
  const t = String(text);
  if (t.length <= max) return t;
  const cut = t.lastIndexOf("\n");
  const last = cut >= 0 ? t.slice(cut + 1) : "";
  return `${t.slice(0, Math.max(0, max - last.length - 5))}...\n${last}`.slice(0, max);
}

export async function send({ text, settings, env = process.env, home, timeoutMs }) {
  const base = apiBase(env); // a wrong address fails at once
  const creds = credentials(resolveEnvFile({ settings, env, home }));
  if (!creds) throw new Error("no Telegram bot token and chat in a Hermes .env (telegram_env)");
  return !!(await call(base, creds, "sendMessage", { chat_id: creds.chat, text: fit(text), disable_web_page_preview: true }, timeoutMs));
}

export function ready({ settings, env = process.env, home }) {
  const file = resolveEnvFile({ settings, env, home });
  if (!file) return { ok: false, why: "no Telegram bot was found: no Hermes .env with a bot token and chat (set telegram_env)" };
  return credentials(file) ? { ok: true, why: `the assistant's Telegram bot from ${file}` } : { ok: false, why: `no bot token and chat in ${file}` };
}
