// F1: the size check, before anything is installed. Paperless at rest takes about 0.9 GB of
// memory (its text reading peaks near 1.6 GB, its limit), Postgres and Valkey about 70 MB more, and
// the three images 4.3 GB of disk (measured on Paperless 3.3.3, 23 October 2026). On a small server
// Paperless competes with Godspeed for memory (PRD section 12), so the check is on memory that is
// free now, inside the container's limit when there is one, not on what the machine has in all.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const NEED = Object.freeze({ memory_mb: 1536, disk_gb: 8 });

const gb = (mb) => (mb / 1024).toFixed(1);
const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 30000 }); return { status: r.error ? 127 : r.status, stdout: r.stdout || "" }; };

// Memory free inside the cgroup limits around this process (a container's, a systemd slice's), in
// MB, or null when there is none. cgroup v2: /proc/self/cgroup says "0::<path>", and every folder
// from there up to the top may carry memory.max.
export function cgroupAvailable({ cgroupFile = "/proc/self/cgroup", root = "/sys/fs/cgroup" } = {}) {
  let rel;
  try { rel = (fs.readFileSync(cgroupFile, "utf8").match(/^0::(.*)$/m) || [])[1]; } catch { return null; }
  if (rel === undefined) return null;
  let best = null;
  for (let dir = path.join(root, rel); ; dir = path.dirname(dir)) {
    try {
      const max = fs.readFileSync(path.join(dir, "memory.max"), "utf8").trim();
      if (/^\d+$/.test(max)) {
        let cur = 0;
        try { cur = Number(fs.readFileSync(path.join(dir, "memory.current"), "utf8").trim()) || 0; } catch { /* none */ }
        const free = Math.max(0, Math.floor((Number(max) - cur) / 1048576));
        best = best === null ? free : Math.min(best, free);
      }
    } catch { /* no limit here */ }
    if (path.resolve(dir) === path.resolve(root) || path.dirname(dir) === dir) break;
  }
  return best;
}

function memAvailableMb() {
  try {
    const m = fs.readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+) kB/m);
    if (m) return Math.floor(Number(m[1]) / 1024);
  } catch { /* not Linux */ }
  return Math.floor(os.freemem() / 1048576);
}

function diskFreeGb(dir) {
  let at = path.resolve(dir);
  while (!fs.existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
  try { const s = fs.statfsSync(at); return Math.round((Number(s.bavail) * Number(s.bsize)) / 1073741824 * 10) / 10; } catch { return null; }
}

// What this machine has. `run(cmd, args)` -> { status, stdout } (the tests hand in their own).
export function measure({ dir, run = sh } = {}) {
  const dv = run("docker", ["version", "--format", "{{.Server.Version}}"]);
  const client = run("docker", ["--version"]);
  const compose = run("docker", ["compose", "version", "--short"]);
  const info = dv.status === 0 ? run("docker", ["info", "--format", "{{.DockerRootDir}}"]) : { status: 1, stdout: "" };
  const cg = cgroupAvailable();
  const mem = memAvailableMb();
  const disks = [diskFreeGb(dir || "/opt"), info.status === 0 && info.stdout.trim() ? diskFreeGb(info.stdout.trim()) : null].filter((x) => x !== null);
  return {
    platform: process.platform,
    root: typeof process.getuid === "function" && process.getuid() === 0,
    arch: process.arch,
    mem_available_mb: cg === null ? mem : Math.min(mem, cg),
    disk_free_gb: disks.length ? Math.min(...disks) : 0,
    docker: client.status === 0 ? (dv.stdout.trim() || (client.stdout.match(/(\d+\.\d+\.\d+)/) || [])[1] || "yes") : null,
    docker_running: dv.status === 0,
    compose: compose.status === 0 ? compose.stdout.trim() || "yes" : null,
  };
}

// { ok, missing: [plain sentences], summary }.
export function roomCheck(m, need = NEED) {
  const missing = [];
  if (m.platform !== "linux") {
    missing.push(`Installing Paperless works on a Linux server. On this computer, connect a Paperless you already run instead: godspeed-clerk setup --paperless <its address> --user <your account>`);
    return { ok: false, missing, summary: "" };
  }
  if (!["x64", "arm64"].includes(m.arch)) missing.push(`Paperless runs on 64-bit computers (Intel, AMD or ARM); this one is ${m.arch}.`);
  if (!m.root) missing.push("Installing Paperless needs the administrator's rights once (it runs Docker and gives Paperless its web address): run the line again with sudo, or as root.");
  if (!m.docker) missing.push("Docker is not installed. Paperless runs in Docker: install it (on Ubuntu or Debian: curl -fsSL https://get.docker.com | sh), then run this line again.");
  else if (!m.docker_running) missing.push("Docker is installed but not running. Start it (systemctl start docker), then run this line again.");
  else if (!m.compose) missing.push("Docker Compose is missing (the docker compose command). Install it (on Ubuntu or Debian: apt install docker-compose-v2), then run this line again.");
  if (m.mem_available_mb < need.memory_mb) missing.push(`This computer has ${gb(m.mem_available_mb)} GB of memory free; Paperless needs ${gb(need.memory_mb)} GB. A bigger server, or stopping something else that runs here, makes room.`);
  if (m.disk_free_gb < need.disk_gb) missing.push(`This computer has ${m.disk_free_gb} GB of disk free; Paperless needs ${need.disk_gb} GB to start (its programs take about 4.3 GB), and more as your papers come in.`);
  const summary = `${gb(m.mem_available_mb)} GB of memory free, ${m.disk_free_gb} GB of disk free, Docker ${m.docker || "missing"}`;
  return { ok: missing.length === 0, missing, summary };
}
