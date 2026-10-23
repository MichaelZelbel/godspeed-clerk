// The worker runs as the person, started with their login on a desktop, or as a service on a
// server:
//   Windows        a scheduled task "Godspeed Clerk": at logon, the current user, no window,
//                  an absolute node.exe path, started again when it stops
//   macOS          a LaunchAgent (~/Library/LaunchAgents/com.godspeed.clerk.plist)
//   Linux desktop  a systemd user unit (~/.config/systemd/user/godspeed-clerk.service)
//   Linux server   a systemd system unit (/etc/systemd/system/godspeed-clerk.service), as root,
//                  with User= the account that owns the mission control when that is not root
// The file builders are pure (the tests read them); install and remove run the system's tools.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TASK = "Godspeed Clerk";
export const AGENT = "com.godspeed.clerk";
export const UNIT = "godspeed-clerk.service";

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 60000, stdio: ["ignore", "pipe", "pipe"], ...opts });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", error: r.error };
};

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const winQuote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
// systemd: a word in double quotes, with \ and " escaped, and % doubled (its own specifiers).
// Only settings that take a list of words (ExecStart=, Environment=) read quotes. A single-path
// setting (WorkingDirectory=) is the rest of the line, taken as it stands: quotes there are a fatal
// unit error ("path is not absolute") and nothing is unescaped, so a space, a quote or a backslash
// is written as itself (an escaped space fails with 200/CHDIR). Only % is doubled. Checked against
// systemd 255.
const sdPath = (s) => String(s).replace(/%/g, "%%");
const sdQuote = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;

export function workerArgs(p) {
  return [p.script, "worker", "--state", p.stateDir];
}

// The scheduled task, as Task Scheduler XML. conhost --headless gives node a console nobody sees,
// so no window opens at logon; the task starts the worker again when it
// stops.
export function windowsTaskXml(p) {
  const conhost = p.conhost !== undefined ? p.conhost : path.join(process.env.SystemRoot || "C:\\Windows", "System32", "conhost.exe");
  const args = workerArgs(p).map(winQuote).join(" ");
  const command = conhost || p.node;
  const argline = conhost ? `--headless ${winQuote(p.node)} ${args}` : args;
  const user = p.user || `${process.env.USERDOMAIN || os.hostname()}\\${process.env.USERNAME || os.userInfo().username}`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${xml(`Godspeed Mission Control: the Clerk (godspeed-clerk ${p.version})`)}</Description>
    <URI>\\${xml(TASK)}</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${xml(user)}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xml(user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(command)}</Command>
      <Arguments>${xml(argline)}</Arguments>
      <WorkingDirectory>${xml(p.stateDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

export function launchAgentPlist(p) {
  const s = (v) => `<string>${xml(v)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${s(AGENT)}
  <key>ProgramArguments</key>
  <array>
    ${[p.node, ...workerArgs(p)].map(s).join("\n    ")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>${s(p.path)}
  </dict>
  <key>WorkingDirectory</key>${s(p.stateDir)}
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>20</integer>
  <key>ProcessType</key>${s("Background")}
  <key>StandardOutPath</key>${s(path.join(p.stateDir, "worker.out.log"))}
  <key>StandardErrorPath</key>${s(path.join(p.stateDir, "worker.out.log"))}
</dict>
</plist>
`;
}

// A systemd unit. `system` true: a system service (as root), with User= when it runs as someone
// else; false: a user service (systemctl --user), started with the person's session.
export function systemdUnit(p, { system = false } = {}) {
  const lines = [
    "[Unit]",
    `Description=Godspeed Mission Control: the Clerk (godspeed-clerk ${p.version})`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    ...(system && p.runAs ? [`User=${p.runAs.user}`, `Group=${p.runAs.group || p.runAs.user}`] : []),
    ...(system ? [`Environment=${sdQuote(`HOME=${p.runAs?.home || "/root"}`)}`] : []),
    `Environment=${sdQuote(`PATH=${p.path}`)}`,
    // Extra settings for the worker, kept in the state folder (a proxy, another notebook address).
    `EnvironmentFile=-${sdPath(`${p.stateDir}/service.env`)}`,
    `WorkingDirectory=${sdPath(p.stateDir)}`,
    `ExecStart=${[p.node, ...workerArgs(p)].map(sdQuote).join(" ")}`,
    "Restart=always",
    "RestartSec=20",
    "Nice=10",
    // Everything the worker writes is readable by its owner only.
    "UMask=0077",
    "",
    "[Install]",
    `WantedBy=${system ? "multi-user.target" : "default.target"}`,
    "",
  ];
  return lines.join("\n");
}

export function serviceFile(p) {
  if (p.service === "launch-agent") return path.join(p.home, "Library", "LaunchAgents", `${AGENT}.plist`);
  if (p.service === "systemd-user") return path.join(p.home, ".config", "systemd", "user", UNIT);
  if (p.service === "systemd-system") return path.join("/etc/systemd/system", UNIT);
  return null;
}

// Installs and starts the worker. Returns { ok, text }.
export function installService(p) {
  if (p.service === "windows-task") {
    const file = path.join(os.tmpdir(), `godspeed-clerk-task-${process.pid}.xml`);
    // Task Scheduler reads its XML as UTF-16 with a byte order mark.
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(windowsTaskXml(p), "utf16le")]));
    try {
      const c = run("schtasks", ["/Create", "/TN", TASK, "/XML", file, "/F"]);
      if (c.status !== 0) return { ok: false, text: `the scheduled task was refused: ${(c.stderr || c.stdout).trim()}` };
      run("schtasks", ["/End", "/TN", TASK]);
      const r = run("schtasks", ["/Run", "/TN", TASK]);
      return r.status === 0 ? { ok: true, text: `scheduled task "${TASK}": starts at every logon, running now` } : { ok: false, text: `the task is there but did not start: ${(r.stderr || r.stdout).trim()}` };
    } finally { fs.rmSync(file, { force: true }); }
  }
  const file = serviceFile(p);
  if (!file) return { ok: true, text: "no service (--no-service): start the worker yourself with `godspeed-clerk worker`" };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (p.service === "launch-agent") {
    fs.writeFileSync(file, launchAgentPlist(p));
    const uid = process.getuid?.() ?? 0;
    run("launchctl", ["bootout", `gui/${uid}/${AGENT}`]);
    let r = run("launchctl", ["bootstrap", `gui/${uid}`, file]);
    if (r.status !== 0) r = run("launchctl", ["load", "-w", file]);
    return r.status === 0 ? { ok: true, text: `LaunchAgent ${AGENT}: starts at every login, running now` } : { ok: false, text: `the LaunchAgent did not load: ${(r.stderr || r.stdout).trim()}` };
  }
  const system = p.service === "systemd-system";
  fs.writeFileSync(file, systemdUnit(p, { system }));
  const sc = (...a) => run("systemctl", system ? a : ["--user", ...a]);
  sc("daemon-reload");
  sc("enable", UNIT);
  const r = sc("restart", UNIT);
  if (r.status !== 0) return { ok: false, text: `${UNIT} did not start: ${(r.stderr || r.stdout).trim()}${system ? "" : " (a user service needs a logged-in session; on a server run `loginctl enable-linger` for this account)"}` };
  return { ok: true, text: `${system ? "" : "user "}service ${UNIT} running${system && p.runAs ? ` as ${p.runAs.user}` : ""}` };
}

// Stops and removes the worker's task or service. Returns { ok, text }.
export function removeService(p) {
  if (p.service === "windows-task") {
    run("schtasks", ["/End", "/TN", TASK]);
    const r = run("schtasks", ["/Delete", "/TN", TASK, "/F"]);
    return r.status === 0 ? { ok: true, text: `scheduled task "${TASK}" removed` } : { ok: true, text: `no scheduled task "${TASK}" to remove` };
  }
  const file = serviceFile(p);
  if (!file) return { ok: true, text: "no service" };
  if (!fs.existsSync(file)) return { ok: true, text: "no service to remove" };
  if (p.service === "launch-agent") {
    const uid = process.getuid?.() ?? 0;
    const r = run("launchctl", ["bootout", `gui/${uid}/${AGENT}`]);
    if (r.status !== 0) run("launchctl", ["unload", "-w", file]);
  } else {
    const system = p.service === "systemd-system";
    const sc = (...a) => run("systemctl", system ? a : ["--user", ...a]);
    sc("disable", "--now", UNIT);
    fs.rmSync(file, { force: true });
    sc("daemon-reload");
    return { ok: true, text: `${UNIT} stopped and removed` };
  }
  fs.rmSync(file, { force: true });
  return { ok: true, text: `${AGENT} stopped and removed` };
}
