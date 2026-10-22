// What several test files share.
import { main } from "../lib/commands/index.mjs";

// Runs one command in this process and collects what it printed.
export async function cli(args, { env = {} } = {}) {
  const out = [], err = [];
  const code = await main(args, { print: (s) => out.push(s), fail: (s) => err.push(s), env: { ...process.env, ...env } });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
