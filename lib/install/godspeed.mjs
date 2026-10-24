// The first released host contract that works for both default server installations.
import fs from "node:fs";
import path from "node:path";
import { dockerInstallation, dockerFetch, PRIVATE_PORT } from "../core/docker.mjs";

export const MINIMUM_GODSPEED = "2.0.0-beta.6";
export const UPDATE_GODSPEED = `Update Godspeed Mission Control to ${MINIMUM_GODSPEED} or newer, then run the Clerk install line again.`;

export function supportedVersion(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/.exec(String(version || ""));
  if (!m) return false;
  const [major, minor, patch] = m.slice(1, 4).map(Number);
  if (major !== 2) return major > 2;
  if (minor || patch) return true;
  return !m[4] || /^beta\.(\d+)$/.test(m[4]) && Number(m[4].slice(5)) >= 6 || /^rc\.\d+$/.test(m[4]);
}

export async function godspeedVersion(workspace, { fetchImpl = globalThis.fetch } = {}) {
  if (!workspace) return null;
  const install = dockerInstallation(workspace);
  if (!install) {
    try {
      const runtime = path.join(workspace, ".godspeed", "integrated-runtime");
      const ref = fs.readFileSync(path.join(runtime, "version"), "utf8").trim();
      if (/^[a-f0-9]{40}$/.test(ref)) return JSON.parse(fs.readFileSync(path.join(runtime, "versions", ref, "notebook", "package.json"), "utf8")).version || null;
    } catch { /* A desktop installation can report its version through its local notebook. */ }
  }
  if (process.env.NODE_TEST_CONTEXT && fetchImpl === globalThis.fetch) return null;
  try {
    const call = install ? dockerFetch(install) : fetchImpl;
    const r = await call(`http://127.0.0.1:${install ? PRIVATE_PORT : 47831}/health`, { signal: AbortSignal.timeout(10000) });
    return r.ok ? (await r.json()).version || null : null;
  } catch { return null; }
}
