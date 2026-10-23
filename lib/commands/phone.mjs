// phone: connect the phone (F2). What the person needs, in plain words for Godspeed's chat: the app,
// the address, the login, the second factor. From then on the Clerk watches for the first scan and
// says when it has arrived. `phone --forget` takes the password and the second factor's key out of
// the Clerk's records once the person has them in their password manager.
import { readJson, writeJson } from "../core/files.mjs";
import { phoneWords } from "../install/install.mjs";

export const meta = { name: "phone", summary: "Connect the phone: the app, the address, the login and the second factor; the first scan is reported.", usage: "phone [--forget]", flags: { bool: ["forget"] } };

export function run(ctx) {
  const rec = readJson(ctx.paths.installed, null);
  const login = readJson(ctx.paths.login, null);
  const conn = readJson(ctx.paths.paperless, null);
  if (ctx.flags.forget) {
    if (!login) { ctx.print("The Clerk keeps no Paperless login."); return 0; }
    writeJson(ctx.paths.login, { user: login.user, address: login.address, forgotten_at: new Date().toISOString() });
    ctx.print("The Clerk no longer keeps your Paperless password, setup key or recovery codes. A new password, if you ever need one: godspeed-clerk paperless password");
    return 0;
  }
  if (rec?.stage === "done") ctx.print(phoneWords(rec, login));
  else if (conn?.url) {
    const web = String(ctx.settings.paperless_web || conn.url).replace(/\/+$/, "");
    ctx.print([
      "Your phone, in three steps:",
      "1. On your iPhone, install the free app \"Swift Paperless\" from the App Store.",
      `2. Open it, add a server, and type the address your phone reaches this Paperless at (the Clerk knows it as ${web}).`,
      `3. Sign in as ${conn.user} with your Paperless password, and the code from your authenticator app if Paperless asks for one.`,
      "Then scan a letter. The Clerk tells you when your first scan has arrived.",
    ].join("\n"));
  } else { ctx.fail("Paperless is not connected yet: godspeed-clerk setup"); return 1; }
  const st = readJson(ctx.paths.state, {});
  if (!st.phone?.connected_at) { st.phone = { ...(st.phone || {}), shown_at: st.phone?.shown_at || new Date().toISOString() }; writeJson(ctx.paths.state, st); }
  else ctx.print(`(Your phone is connected: its first scan arrived ${st.phone.connected_at.slice(0, 16).replace("T", " ")}.)`);
  return 0;
}
