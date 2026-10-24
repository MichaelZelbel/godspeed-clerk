// What several test files share.
import { main } from "../lib/commands/index.mjs";
import fs from "node:fs";
import path from "node:path";

// A native installed-version receipt, not a real notebook or model connection.
export function installedVersion(workspace, version = "2.0.0-beta.6") {
  const runtime = path.join(workspace, ".godspeed", "integrated-runtime");
  const ref = "a".repeat(40);
  fs.mkdirSync(path.join(runtime, "versions", ref, "notebook"), { recursive: true });
  fs.writeFileSync(path.join(runtime, "version"), ref + "\n");
  fs.writeFileSync(path.join(runtime, "versions", ref, "notebook", "package.json"), JSON.stringify({ version }));
  return workspace;
}

// Runs one command in this process and collects what it printed.
export async function cli(args, { env = {} } = {}) {
  const out = [], err = [];
  const code = await main(args, { print: (s) => out.push(s), fail: (s) => err.push(s), env: { ...process.env, ...env } });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
