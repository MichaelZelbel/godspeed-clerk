// connect: point the Clerk at a Paperless that already exists (F1, the connect path). It signs in
// with the account's existing token and only reads: what it found is shown, nothing in Paperless
// changes. The password, when given, is used once to read the token and is not kept.
import { Paperless, Taxonomy, obtainToken, apiBase } from "../core/paperless.mjs";
import { readJson, writeJson, ensurePrivateDir } from "../core/files.mjs";

export const meta = {
  name: "connect",
  summary: "Connect to an existing Paperless-ngx (reads only; changes nothing in it).",
  usage: "connect --paperless <address> --user <name> [--token <t>]",
  flags: { value: ["paperless", "user", "token", "password-env", "code"], bool: [] },
};

async function askHidden(question) {
  if (!process.stdin.isTTY) return "";
  const { createInterface } = await import("node:readline");
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
  });
}

const count = async (pl, params) => (await pl.get("documents/", { page_size: 1, fields: "id", ...params })).count ?? 0;

export async function connectPaperless(ctx) {
  const before = readJson(ctx.paths.paperless, {});
  const url = ctx.flags.paperless || before.url;
  const user = ctx.flags.user || before.user;
  if (!url || !user) throw new Error("give the Paperless address and the account: --paperless <address> --user <name>");
  apiBase(url);
  let token = ctx.flags.token || ctx.env.PAPERLESS_API_TOKEN || "";
  // Run again for the same Paperless and account: the token it already has, no new sign-in.
  if (!token && before.token && before.url === url && before.user === user) token = before.token;
  if (!token) {
    const pwVar = ctx.flags["password-env"] || "PAPERLESS_PASSWORD";
    const password = ctx.env[pwVar] || (await askHidden(`Paperless password for ${user} (it is used once and not kept): `));
    if (!password) throw new Error(`no password: put it in the environment variable ${pwVar}, or give the account's token with --token`);
    token = await obtainToken({ url, user, password, code: ctx.flags.code });
  }
  const pl = new Paperless({ url, token });
  const me = await pl.me();
  if (me.username && me.username !== user) throw new Error(`that token belongs to ${me.username}, not ${user}`);
  const tax = await Taxonomy.load(pl);
  const inbox = tax.inboxIds();
  const mine = await count(pl, { owner__id: me.id });
  const waiting = inbox.length ? await count(pl, { owner__id: me.id, tags__id__all: inbox[0] }) : 0;
  const unowned = await count(pl, { owner__isnull: "true" });
  const all = await count(pl, {});
  const others = Math.max(0, all - mine - unowned);
  ensurePrivateDir(ctx.paths.root);
  writeJson(ctx.paths.paperless, { url, user, token, user_id: me.id, version: me.version, connected_at: new Date().toISOString() });
  const lines = [
    `Connected to Paperless ${me.version || ""} at ${url} as ${user}.${ctx.installedHere ? "" : " Nothing in Paperless was changed."}`.replace("Paperless  at", "Paperless at"),
    `- ${mine} documents of yours, ${waiting} waiting in the inbox${inbox.length ? ` (tag "${tax.tags.get(inbox[0]).name}")` : " (Paperless has no inbox tag: no document counts as new until one is made)"}.`,
    `- ${tax.types.size} document types, ${tax.tags.size} tags, ${tax.correspondents.size} senders.`,
  ];
  if (others) lines.push(`- ${others} documents belong to other accounts. The Clerk never reads, sorts or copies them.`);
  if (unowned) lines.push(`- ${unowned} documents have no owner. The Clerk leaves them alone unless you say they are yours (godspeed-clerk settings include_unowned true).`);
  return lines;
}

export async function run(ctx) {
  try { ctx.print((await connectPaperless(ctx)).join("\n")); return 0; }
  catch (e) { ctx.fail(`Not connected: ${e.message}`); return 1; }
}
