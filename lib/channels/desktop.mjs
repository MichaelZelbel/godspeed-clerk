// Notifications on this computer, as the Wingman shows its: Windows through Windows PowerShell and
// the WinRT ToastNotificationManager (nothing to install), macOS through osascript, Linux through
// notify-send. A click opens the message's link where the system allows it.
//
// A notification can appear on a lock screen or a shared screen, so it never names a paper: it
// says only that the Clerk has something to look at. The link shows the rest.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const TITLE = "The Clerk";
export const BODY = "A paper needs your look. Open the link to see which.";
// The app id Windows shows the toast under: Windows PowerShell's own, registered on every Windows.
export const WINDOWS_APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

function findNotifySend(env) {
  for (const d of String(env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const f = path.join(d, "notify-send");
    try { if (fs.statSync(f).isFile()) return f; } catch { /* not here */ }
  }
  return null;
}

export function available({ platform = process.platform, env = process.env } = {}) {
  if (platform === "win32") return { ok: true, how: "Windows notifications" };
  if (platform === "darwin") return { ok: true, how: "macOS notifications" };
  if (!(env.DISPLAY || env.WAYLAND_DISPLAY || env.DBUS_SESSION_BUS_ADDRESS)) return { ok: false, how: "no desktop session on this machine" };
  return findNotifySend(env) ? { ok: true, how: "notify-send" } : { ok: false, how: "notify-send is not installed (package libnotify-bin or libnotify)" };
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function toastXml({ title = TITLE, body = BODY, url }) {
  const launch = url ? ` activationType="protocol" launch="${xml(url)}"` : "";
  return `<toast${launch}><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text></binding></visual></toast>`;
}

export function notifyCommand({ platform = process.platform, env = process.env, url }) {
  if (platform === "win32") {
    const ps = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
      "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
      "$x = New-Object Windows.Data.Xml.Dom.XmlDocument",
      `$x.LoadXml(${ps(toastXml({ url }))})`,
      "$t = New-Object Windows.UI.Notifications.ToastNotification $x",
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${ps(WINDOWS_APP_ID)}).Show($t)`,
    ].join("\n");
    const root = env.SystemRoot || env.SYSTEMROOT || env.windir || "C:\\Windows";
    return { exe: path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")] };
  }
  if (platform === "darwin") return { exe: "/usr/bin/osascript", args: ["-e", `display notification "${BODY}" with title "${TITLE}"`] };
  return { exe: findNotifySend(env) || "notify-send", args: ["--app-name=Godspeed Clerk", TITLE, url ? `${BODY}\n${url}` : BODY] };
}

export function send({ link, env = process.env, platform = process.platform }) {
  const { exe, args } = notifyCommand({ platform, env, url: link });
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(exe, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }); } catch (e) { reject(e); return; }
    let err = "";
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } reject(new Error("the notification took longer than 20 s")); }, 20000);
    child.stderr?.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(true);
      else reject(new Error(`${path.basename(exe)} said no (exit ${code})${err.trim() ? `: ${err.trim().split(/\r?\n/).slice(-1)[0].slice(0, 200)}` : ""}`));
    });
  });
}

export function ready({ env = process.env } = {}) {
  const a = available({ env });
  return { ok: a.ok, why: a.how };
}
