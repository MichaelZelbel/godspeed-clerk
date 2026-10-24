// Paperless's web address (F1, section 5): HTTPS always, on the server's own name, the way
// Godspeed's installer gives the notebook its address. Ports 80 and 443, which a certificate needs,
// are held by one Caddy on a Godspeed server: Godspeed's own (godspeed-https.service, its Caddyfile
// in the Godspeed folder) or the server's (caddy.service, /etc/caddy/Caddyfile, to which the
// notebook added itself). The Clerk adds Paperless to that same Caddy: a site file of its own
// ("<name>:48444", handed to Paperless on 127.0.0.1) and one import line, so Paperless gets the
// name's certificate without a second program fighting for the ports. On the server's Caddy a reload
// it refuses puts both files back as they were (the notebook's installer does the same).
//
// Godspeed's installer writes its own Caddyfile whole on every update, which drops the line; the
// worker puts it back (heal) within the hour. No Caddy: the Clerk says so instead of guessing.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { dockerInstallation, findDockerInstallation, dockerFront } from "../core/docker.mjs";

export const SITE_FILE_NAME = "godspeed-clerk.caddy";
export const DEFAULT_PORT = 48444;
const OWN_UNIT = "godspeed-https.service";
const SERVER_CADDYFILE = "/etc/caddy/Caddyfile";
const NOTEBOOK_SITE = "/etc/caddy/godspeed-notebook.caddy";
const MARK = "# Paperless-ngx's web address, added by The Clerk (godspeed-clerk), which keeps this line.";
const ADDON_DIR = "/etc/caddy/godspeed-addons";
const DOCKER_FRONT = "godspeed-clerk-https";
const OWNER_LABEL = "org.godspeed.clerk.role";

const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 120000 }); return { status: r.error ? 127 : r.status, stdout: r.stdout || "", stderr: r.stderr || "" }; };
const at = (root, p) => path.join(root, p);
const read = (root, p) => { try { return fs.readFileSync(at(root, p), "utf8"); } catch { return null; } };

// { kind: "own", unit, caddyfile } | { kind: "caddy", unit, caddyfile } | { kind: "none" }
export function findFront({ root = "/", run = sh, workspace } = {}) {
  const install = dockerInstallation(workspace);
  if (install) return dockerFront(install, { run }) || { kind: "none" };
  const native = (front) => {
    const texts = [read(root, front.caddyfile), ...(front.kind === "caddy" ? [read(root, NOTEBOOK_SITE)] : [])];
    return texts.some((t) => /^\s*import\s+\/etc\/caddy\/godspeed-addons\/\*\.caddy\s*$/m.test(t || "")) ? { ...front, addonDir: ADDON_DIR } : front;
  };
  const unit = read(root, `/etc/systemd/system/${OWN_UNIT}`);
  if (unit) {
    const exec = (unit.match(/^ExecStart=(.*)$/m) || [])[1] || "";
    const m = exec.match(/--config\s+(?:"((?:[^"\\]|\\.)*)"|(\S+))/);
    const caddyfile = m ? (m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2]) : null;
    if (caddyfile && read(root, caddyfile) !== null) return native({ kind: "own", unit: OWN_UNIT, caddyfile });
  }
  if (run("systemctl", ["is-active", "--quiet", "caddy"]).status === 0 && read(root, SERVER_CADDYFILE) !== null) return native({ kind: "caddy", unit: "caddy.service", caddyfile: SERVER_CADDYFILE });
  if (root === "/") {
    const docker = findDockerInstallation({ run });
    if (docker) return dockerFront(docker, { run }) || { kind: "none" };
  }
  return { kind: "none" };
}

// The first site address in a Caddyfile: a line "<name>[:port] {" outside the global options, not
// a snippet "(x) {". Only names (no ":80", no "http://").
export function firstSite(text) {
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^\s*(?:https:\/\/)?([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::\d+)?\s*\{\s*$/i);
    if (m && m[1].includes(".")) return m[1].toLowerCase();
  }
  return null;
}

// The name Godspeed's notebook is reached by.
export function serverName(front, { root = "/" } = {}) {
  if (front.kind === "docker") return front.host;
  if (front.kind === "own") return firstSite(read(root, front.caddyfile));
  if (front.kind === "caddy") return firstSite(read(root, NOTEBOOK_SITE)) || firstSite(read(root, SERVER_CADDYFILE));
  return null;
}

const legacySiteFile = (front) => (front.kind === "own" ? path.posix.join(path.posix.dirname(front.caddyfile), SITE_FILE_NAME) : `/etc/caddy/${SITE_FILE_NAME}`);
export const siteFile = (front) => front.kind === "docker" ? front.caddyfile : front.addonDir ? path.posix.join(front.addonDir, SITE_FILE_NAME) : legacySiteFile(front);

export function siteText({ host, port, upstream }) {
  return `# Paperless-ngx's web address. The Clerk (godspeed-clerk) writes this file and keeps it.\n${host}:${port} {\n\treverse_proxy 127.0.0.1:${upstream}\n}\n`;
}

const importLine = (front) => `import ${siteFile(front)}`;
export const hasImport = (text, front) => !!front.addonDir || String(text || "").split("\n").some((l) => l.trim() === importLine(front));

// A port for the address: DEFAULT_PORT unless a Caddyfile names it or something listens on it.
export function freePort({ texts = [], run = sh, from = DEFAULT_PORT } = {}) {
  const listening = run("ss", ["-ltnH"]).stdout || "";
  for (let p = from; p < from + 40; p++) {
    if (texts.some((t) => new RegExp(`:${p}\\b`).test(String(t || "")))) continue;
    if (new RegExp(`:${p}\\s`).test(listening)) continue;
    return p;
  }
  throw new Error("no free port for Paperless's web address");
}

function openPort(port, run) {
  const ufw = run("ufw", ["status"]);
  if (ufw.status === 0 && /^Status: active/m.test(ufw.stdout)) run("ufw", ["allow", `${port}/tcp`]);
  if (run("firewall-cmd", ["--state"]).status === 0) { run("firewall-cmd", ["--quiet", "--permanent", `--add-port=${port}/tcp`]); run("firewall-cmd", ["--quiet", "--reload"]); }
}

function writeKeep(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.clerk-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: 0o644 });
  fs.chmodSync(tmp, 0o644);
  fs.renameSync(tmp, file);
}

// Godspeed's Docker front has no admin door or add-on config mount. A Clerk-owned front shares
// its existing certificate storage; Caddy officially coordinates instances using the same storage.
// Only Paperless's own port listens. The existing Godspeed compose and configuration stay intact.
async function publishDocker({ front, host, port, upstream, run }) {
  const config = `{\n\tadmin off\n\tauto_https disable_redirects\n}\n\n${siteText({ host, port, upstream })}`;
  let before = null;
  try { before = fs.readFileSync(front.caddyfile, "utf8"); } catch { /* first installation */ }
  const inspected = run("docker", ["inspect", DOCKER_FRONT]);
  let old = null;
  try { old = JSON.parse(inspected.stdout)[0]; } catch { /* no Clerk front yet */ }
  if (old && old.Config?.Labels?.[OWNER_LABEL] !== "https") return { ok: false, why: `A container named ${DOCKER_FRONT} belongs to another installation; it was kept.` };
  if (old?.State?.Running && old.Config.Image === front.image && before === config) return { ok: true, changed: false, front, site: front.caddyfile };
  writeKeep(front.caddyfile, config);
  if (old) {
    const removed = run("docker", ["rm", "-f", DOCKER_FRONT]);
    if (removed.status !== 0) return { ok: false, why: "The Clerk's HTTPS container could not be updated.", front };
  }
  const r = run("docker", ["run", "-d", "--name", DOCKER_FRONT, "--restart", "unless-stopped", "--network", "host", "--label", `${OWNER_LABEL}=https`,
    "--mount", `type=bind,src=${path.dirname(front.caddyfile)},dst=/etc/caddy,readonly`,
    "--mount", `type=${front.storage.type},src=${front.storage.source},dst=/data`, "-e", "XDG_DATA_HOME=/data", front.image,
    "caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]);
  if (r.status !== 0) return { ok: false, why: "The Clerk's HTTPS container did not start; check docker logs godspeed-clerk-https, then run this line again.", front };
  openPort(port, run);
  return { ok: true, changed: true, front, site: front.caddyfile };
}

// Adds (or keeps) the site and the import line, then restarts Godspeed's Caddy (it has no admin
// endpoint, so a change is a restart) or reloads the server's. Returns { ok, why, site, front }.
export async function publish({ front, host, port, upstream, root = "/", run = sh }) {
  if (front.kind === "none") return { ok: false, why: "no Caddy holds ports 80 and 443 here" };
  if (front.kind === "docker") return publishDocker({ front, host, port, upstream, run });
  const cfPath = at(root, front.caddyfile), sitePath = at(root, siteFile(front));
  const cfBefore = fs.readFileSync(cfPath, "utf8");
  const siteBefore = read(root, siteFile(front));
  const site = siteText({ host, port, upstream });
  const legacy = front.addonDir ? legacySiteFile(front) : null;
  const legacyBefore = legacy ? read(root, legacy) : null;
  const cfAfter = front.addonDir
    ? cfBefore.split("\n").filter((l) => l.trim() !== `import ${legacy}` && l.trim() !== MARK).join("\n")
    : hasImport(cfBefore, front) ? cfBefore : `${cfBefore.replace(/\n*$/, "\n")}\n${MARK}\n${importLine(front)}\n`;
  if (cfAfter === cfBefore && siteBefore === site && legacyBefore === null) return { ok: true, changed: false, site: siteFile(front), front };
  writeKeep(sitePath, site);
  if (cfAfter !== cfBefore) {
    const st = fs.statSync(cfPath);
    writeKeep(cfPath, cfAfter);
    try { fs.chmodSync(cfPath, st.mode & 0o777); fs.chownSync(cfPath, st.uid, st.gid); } catch { /* as it was, as far as allowed */ }
  }
  const r = front.kind === "own" ? run("systemctl", ["restart", front.unit]) : run("systemctl", ["reload", "caddy"]);
  if (r.status !== 0) {
    writeKeep(cfPath, cfBefore);
    if (siteBefore === null) fs.rmSync(sitePath, { force: true }); else writeKeep(sitePath, siteBefore);
    if (front.kind === "own") run("systemctl", ["restart", front.unit]); else run("systemctl", ["reload", "caddy"]);
    const logs = front.kind === "own" ? `journalctl -u ${front.unit} -n 50` : "journalctl -u caddy -n 50";
    return { ok: false, why: `Caddy did not take Paperless's web address, so it serves what it served before. What it said: ${logs}`, front };
  }
  if (legacyBefore !== null) fs.rmSync(at(root, legacy), { force: true });
  openPort(port, run);
  return { ok: true, changed: true, site: siteFile(front), front };
}

// The worker's hourly look: the site file and the import line still there? Puts back what a
// Godspeed update took away. Returns { healed, ok, why }.
export async function heal({ host, port, upstream, workspace, root = "/", run = sh }) {
  const front = findFront({ root, run, workspace });
  if (front.kind === "none") return { healed: false, ok: false, why: "no Caddy holds ports 80 and 443 any more" };
  if (front.kind === "docker") {
    const r = await publish({ front, host, port, upstream, root, run });
    return { healed: r.ok && r.changed, ok: r.ok, why: r.why };
  }
  if (hasImport(read(root, front.caddyfile), front) && read(root, siteFile(front)) === siteText({ host, port, upstream }) && (!front.addonDir || read(root, legacySiteFile(front)) === null && !String(read(root, front.caddyfile)).includes(`import ${legacySiteFile(front)}`))) return { healed: false, ok: true };
  const r = await publish({ front, host, port, upstream, root, run });
  return { healed: r.ok, ok: r.ok, why: r.why };
}

// The address answers: Paperless's API over HTTPS, with a certificate this computer trusts, says it
// wants a sign-in (401). A new certificate takes Caddy seconds to a minute or two.
export async function addressAnswers(url, { tries = 40, waitMs = 4000, fetchImpl = globalThis.fetch } = {}) {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetchImpl(`${url.replace(/\/+$/, "")}/api/ui_settings/`, { redirect: "manual", signal: AbortSignal.timeout(10000) });
      if (r.status === 401 || r.status === 403) return { ok: true };
      last = `HTTP ${r.status}`;
    } catch (e) { last = e.cause?.code || e.cause?.message || e.message; }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, waitMs));
  }
  return { ok: false, why: last };
}
