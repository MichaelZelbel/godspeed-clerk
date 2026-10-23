// Where the Clerk's messages go (F16), the Wingman's way: every channel in the setting `talk` gets
// the message, and it counts as delivered when at least one took it. A message no channel took is
// sent again on a later run (notify.mjs), never lost and never twice.
//
// A channel is lib/channels/<name>.mjs with
//   send({ text, link, settings, env, home }) -> true when it took the message (or throws)
//   ready({ settings, env, home }) -> { ok, why }
import * as telegram from "./telegram.mjs";
import * as desktop from "./desktop.mjs";
import { TALK } from "../core/settings.mjs";

const CHANNELS = { telegram, desktop };

export function isDesktop({ platform = process.platform, env = process.env } = {}) {
  if (platform === "win32" || platform === "darwin") return true;
  return !!(env.DISPLAY || env.WAYLAND_DISPLAY || /^(x11|wayland)$/i.test(env.XDG_SESSION_TYPE || ""));
}

// The channels in use: the setting, or, when it is not set, this computer's notifications on a
// desktop and the assistant's own Telegram bot on a server.
export function talkOf(settings, { platform = process.platform, env = process.env } = {}) {
  const set = Array.isArray(settings.talk) ? settings.talk.filter((t) => TALK.includes(t)) : [];
  return set.length ? [...new Set(set)] : isDesktop({ platform, env }) ? ["desktop"] : ["telegram"];
}

// The one link in a message, for a channel that can open it (a notification's click).
const linkOf = (text) => (String(text).match(/https?:\/\/\S+/) || [null])[0];

export async function tell(text, { settings, env = process.env, home, log = () => {}, impls = {} } = {}) {
  const results = {};
  let delivered = false;
  for (const name of talkOf(settings, { env })) {
    try {
      const ch = impls[name] || CHANNELS[name];
      const ok = await ch.send({ text, link: linkOf(text), settings, env, home });
      results[name] = ok ? "ok" : "not taken";
      if (ok) delivered = true;
    } catch (e) {
      results[name] = e.message;
      log(`message: ${name} did not take it: ${e.message}`);
    }
  }
  return { delivered, results };
}

// For `status`: one line per channel in use.
export function readiness(settings, { env = process.env, home } = {}) {
  return talkOf(settings, { env }).map((name) => {
    try { return { name, ...CHANNELS[name].ready({ settings, env, home }) }; }
    catch (e) { return { name, ok: false, why: e.message }; }
  });
}
