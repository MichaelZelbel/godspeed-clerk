// Godspeed's installed Docker contract, not a second notebook or model connection.
// The host marker belongs to the public server installer; private API requests stay inside its
// fixed godspeed service, on the product's loopback-only add-on port.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export const PRIVATE_PORT = 47832;
const sync = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, ...opts });
  return { status: r.error ? 127 : r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
};
const absolute = (p) => typeof p === "string" && path.isAbsolute(p) && !p.split(/[\\/]/).includes("..");

export function dockerInstallation(workspace) {
  if (!absolute(workspace)) return null;
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(workspace, ".godspeed", "model-host.json"), "utf8"));
    if (marker.format !== 1 || marker.kind !== "godspeed-docker" || marker.service !== "godspeed" || !absolute(marker.workspace)) return null;
    const compose = path.join(workspace, "compose.yaml");
    if (!fs.statSync(compose).isFile()) return null;
    return { root: workspace, compose, service: "godspeed", workspace: marker.workspace };
  } catch { return null; }
}

export function findDockerInstallation({ run = sync } = {}) {
  const usual = dockerInstallation("/opt/godspeed-mission-control");
  if (usual) return usual;
  const r = run("docker", ["ps", "--filter", "label=com.docker.compose.service=godspeed", "--format", '{{.Label "com.docker.compose.project.working_dir"}}']);
  if (r.status !== 0) return null;
  const found = [...new Set(r.stdout.split(/\r?\n/).filter(Boolean))].map(dockerInstallation).filter(Boolean);
  return found.length === 1 ? found[0] : null;
}

export const composeArgs = (install) => ["compose", "-f", install.compose, "--project-directory", install.root];
export const execArgs = (install, args) => [...composeArgs(install), "exec", "-T", "--user", "hermes", install.service, ...args];

// The only paths the Clerk uses: structured notebook records, its deadlines and a notebook link.
const ROUTES = new Set(["/health", "/api/query", "/api/functions/addon-deadlines", "/mcp"]);
const RELAY = `
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const q=JSON.parse(raw);
if(!['/health','/api/query','/api/functions/addon-deadlines','/mcp'].includes(q.path))throw Error('Unknown notebook route');
const method=q.path==='/health'?'GET':'POST';
const r=await fetch('http://127.0.0.1:47832'+q.path,{method,headers:{'content-type':'application/json'},...(method==='POST'?{body:q.body}:{}),signal:AbortSignal.timeout(30000)});
console.log(JSON.stringify({status:r.status,body:await r.text()}));
`;

export function dockerFetch(install, { spawnImpl = spawn } = {}) {
  return async (url, opts = {}) => {
    const u = new URL(url);
    if (u.origin !== `http://127.0.0.1:${PRIVATE_PORT}` || !ROUTES.has(u.pathname) || u.search || u.hash) throw new Error("unknown private notebook request");
    const method = u.pathname === "/health" ? "GET" : "POST";
    if ((opts.method || "GET") !== method) throw new Error("unknown private notebook method");
    opts.signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const c = spawnImpl("docker", execArgs(install, ["node", "--input-type=module", "-e", RELAY]), { windowsHide: true });
      let out = "", done = false;
      const finish = (err, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", abort);
        if (err) { c.kill("SIGKILL"); reject(err); } else resolve(value);
      };
      const abort = () => finish(opts.signal.reason || new Error("private notebook request stopped"));
      const timer = setTimeout(() => finish(new Error("private notebook did not answer")), 40000);
      opts.signal?.addEventListener("abort", abort, { once: true });
      c.stdout.setEncoding("utf8");
      c.stdout.on("data", (s) => { out += s; if (out.length > 16 * 1024 * 1024) finish(new Error("private notebook answer was too long")); });
      c.stderr.resume(); // Never include container output or credentials in an error.
      c.on("error", () => finish(new Error("Godspeed's Docker service did not answer")));
      c.on("close", (code) => {
        if (done) return;
        try {
          if (code !== 0) throw new Error();
          const answer = JSON.parse(out);
          finish(null, new Response(answer.body, { status: answer.status, headers: { "content-type": "application/json" } }));
        } catch { finish(new Error("Godspeed's private notebook did not answer")); }
      });
      c.stdin.on("error", () => {});
      c.stdin.end(JSON.stringify({ path: u.pathname, body: opts.body }));
    });
  };
}

// Credentials are read fresh from the actual verified assistant home. They are returned to the
// channel in memory, never copied to Clerk settings or logs, and no unrelated host bot is tried.
export function dockerAssistantEnv(install, { run = sync } = {}) {
  const script = `const fs=require('node:fs'),path=require('node:path');const d=JSON.parse(fs.readFileSync(path.join(process.argv[1],'.godspeed/assistant.json'),'utf8'));if(!d.verified||!path.isAbsolute(d.home))throw Error('No verified assistant');process.stdout.write(fs.readFileSync(path.join(d.home,'.env'),'utf8'));`;
  const r = run("docker", execArgs(install, ["node", "-e", script, install.workspace]));
  return r.status === 0 ? r.stdout : "";
}

export function dockerFront(install, { run = sync } = {}) {
  const id = run("docker", [...composeArgs(install), "ps", "-q", "https"]);
  if (id.status !== 0 || !/^[a-f0-9]{12,64}$/.test(id.stdout.trim())) return null;
  const inspected = run("docker", ["inspect", id.stdout.trim()]);
  try {
    const c = JSON.parse(inspected.stdout)[0];
    const data = c.Mounts.find((m) => m.Destination === "/data");
    if (!c.State.Running || !data || !["volume", "bind"].includes(data.Type) || !c.Config.Image) return null;
    const host = fs.readFileSync(path.join(install.root, ".env"), "utf8").match(/^GODSPEED_HOST=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (!host || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host)) return null;
    return { kind: "docker", install, host, image: c.Config.Image, storage: { type: data.Type, source: data.Type === "volume" ? data.Name : data.Source }, caddyfile: "/opt/godspeed-clerk/https/Caddyfile" };
  } catch { return null; }
}
