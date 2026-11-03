import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const meta = { name: "version", summary: "Say which version of the Clerk is installed.", usage: "version", hidden: true };

const PACKAGE_JSON = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");

export function versionLine() {
  return `godspeed-clerk ${JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8")).version}`;
}

export async function run(ctx) {
  ctx.print(versionLine());
  return 0;
}
