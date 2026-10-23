// Where messages go (F16): the assistant's own Telegram bot, or this computer's notifications.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { tell, readiness, talkOf } from "../lib/channels/index.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "clerk-channels-"));

// A Godspeed folder whose assistant has its own Telegram bot (the server installation's layout).
function godspeedWithBot() {
  const ws = tmp();
  const dir = path.join(ws, ".godspeed", "integrated-runtime", "hermes");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".env"), "TELEGRAM_BOT_TOKEN=123:made-up\nTELEGRAM_HOME_CHANNEL=4242\nOTHER=x\n");
  return { ws, env: path.join(dir, ".env") };
}

async function fakeTelegram() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls.push({ path: req.url, body: JSON.parse(raw || "{}") });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, result: { message_id: calls.length } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

test("telegram: the assistant's own bot from the Godspeed folder, one sendMessage with the text", async () => {
  const tg = await fakeTelegram();
  try {
    const { ws } = godspeedWithBot();
    const r = await tell("The Clerk: one paper to check.\nhttps://notebook.example/collections/documents", {
      settings: { talk: ["telegram"], workspace: ws, telegram_env: "" }, env: { GODSPEED_CLERK_TELEGRAM_API: tg.url, GODSPEED_CLERK_TEST: "1" }, home: tmp(),
    });
    assert.equal(r.delivered, true);
    assert.equal(tg.calls.length, 1);
    assert.equal(tg.calls[0].path, "/bot123:made-up/sendMessage");
    assert.equal(tg.calls[0].body.chat_id, "4242");
    assert.equal(tg.calls[0].body.text, "The Clerk: one paper to check.\nhttps://notebook.example/collections/documents");
  } finally { await tg.close(); }
});

test("a fake Telegram address outside test mode is refused", async () => {
  const tg = await fakeTelegram();
  try {
    const { ws } = godspeedWithBot();
    const r = await tell("x", { settings: { talk: ["telegram"], workspace: ws }, env: { GODSPEED_CLERK_TELEGRAM_API: tg.url }, home: tmp() });
    assert.equal(r.delivered, false);
    assert.match(r.results.telegram, /only in test mode/);
    assert.equal(tg.calls.length, 0);
  } finally { await tg.close(); }
});

test("readiness names the bot's .env, or says what is missing", () => {
  const { ws, env } = godspeedWithBot();
  const [ok] = readiness({ talk: ["telegram"], workspace: ws }, { env: {}, home: tmp() });
  assert.equal(ok.ok, true);
  assert.ok(ok.why.includes(env), ok.why);
  const [missing] = readiness({ talk: ["telegram"], workspace: tmp() }, { env: {}, home: tmp() });
  assert.equal(missing.ok, false);
  assert.match(missing.why, /no Telegram bot/);
});

test("where messages go when nothing is set: this computer's notifications on a desktop, else Telegram", () => {
  assert.deepEqual(talkOf({ talk: null }, { platform: "win32", env: {} }), ["desktop"]);
  assert.deepEqual(talkOf({ talk: null }, { platform: "linux", env: {} }), ["telegram"]);
  assert.deepEqual(talkOf({ talk: ["telegram"] }, { platform: "win32", env: {} }), ["telegram"]);
});

test("a channel gets the message's own link, not a web address from the text", async () => {
  const got = [];
  const r = await tell("The Clerk:\nCould not be placed: \"Order from shop.example https://shop.example/orders/77\".\nhttps://notebook.example/collections/documents", {
    settings: { talk: ["desktop"] }, env: {}, link: "https://notebook.example/collections/documents",
    impls: { desktop: { send: async ({ link }) => { got.push(link); return true; } } },
  });
  assert.equal(r.delivered, true);
  assert.deepEqual(got, ["https://notebook.example/collections/documents"]);
});

test("telegram: a message longer than Telegram allows keeps its last line, the link", async () => {
  const tg = await fakeTelegram();
  try {
    const { ws } = godspeedWithBot();
    const text = `The Clerk:\n${"x".repeat(5000)}\nhttps://notebook.example/collections/documents`;
    await tell(text, { settings: { talk: ["telegram"], workspace: ws }, env: { GODSPEED_CLERK_TELEGRAM_API: tg.url, GODSPEED_CLERK_TEST: "1" }, home: tmp() });
    const sent = tg.calls[0].body.text;
    assert.ok(sent.length <= 4000, `${sent.length}`);
    assert.match(sent, /\nhttps:\/\/notebook\.example\/collections\/documents$/);
  } finally { await tg.close(); }
});
