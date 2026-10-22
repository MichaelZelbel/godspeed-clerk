export const meta = { name: "help", summary: "List the commands.", usage: "help" };

export async function run(ctx) {
  const lines = ["godspeed-clerk: sorts the documents in your Paperless-ngx and files them into your cloud drive.", ""];
  const seen = new Set();
  for (const c of ctx.commands.values()) {
    if (c.meta.hidden || seen.has(c.meta.name)) continue;
    seen.add(c.meta.name);
    lines.push(`  ${c.meta.usage.padEnd(44)} ${c.meta.summary}`);
  }
  lines.push("", "Every command takes --state <folder> to use another state folder.");
  ctx.print(lines.join("\n"));
  return 0;
}
