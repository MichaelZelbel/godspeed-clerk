import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeAsker, describe, modelProgram, ModelUnavailable, RouteRefused } from "../lib/core/model.mjs";
import { DEFAULTS } from "../lib/core/settings.mjs";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fakes", "model.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "clerk-model-"));
const workspace = () => { const d = tmp(); fs.writeFileSync(path.join(d, "AGENTS.md"), "x"); return d; };

function env(extra = {}) {
  const dir = tmp();
  const prompts = path.join(dir, "prompts.jsonl");
  const answers = path.join(dir, "answers.json");
  fs.writeFileSync(answers, JSON.stringify([{ match: ["electricity"], answer: { title: "ok" } }]));
  return { prompts, e: { PATH: process.env.PATH, GODSPEED_MODEL_COMMAND: FAKE, GODSPEED_CLERK_FAKE_PROMPTS: prompts, GODSPEED_CLERK_FAKE_ANSWERS: answers, ...extra } };
}
const sent = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).length : 0);
const settings = (approved) => ({ ...structuredClone(DEFAULTS), approved_ai: approved });

test("without a Godspeed model connection nothing is sent", async () => {
  const { prompts } = env();
  const e = { PATH: "", Path: "" };
  assert.equal(modelProgram({ env: e, workspace: tmp(), home: tmp(), platform: "linux", extraDirs: [] }), null);
  const ask = makeAsker({ settings: settings(["test-provider"]), workspace: workspace(), env: e, home: tmp(), extraDirs: [] });
  await assert.rejects(ask({ system: "s", prompt: "electricity" }), ModelUnavailable);
  assert.equal(sent(prompts), 0);
});

test("a provider the person did not approve is refused before any text leaves", async () => {
  const { prompts, e } = env({ GODSPEED_CLERK_FAKE_PROVIDER: "some-paid-api" });
  const ask = makeAsker({ settings: settings(["test-provider"]), workspace: workspace(), env: e });
  await assert.rejects(ask({ system: "s", prompt: "electricity" }), (err) => err instanceof RouteRefused && /some-paid-api/.test(err.message));
  assert.equal(sent(prompts), 0);
});

test("a backup the person did not approve is refused too", async () => {
  const { prompts, e } = env({ GODSPEED_CLERK_FAKE_BACKUP: "another-api" });
  const ask = makeAsker({ settings: settings(["test-provider"]), workspace: workspace(), env: e });
  await assert.rejects(ask({ system: "s", prompt: "electricity" }), RouteRefused);
  assert.equal(sent(prompts), 0);
});

test("with nothing approved yet nothing leaves", async () => {
  const { prompts, e } = env();
  const ask = makeAsker({ settings: settings([]), workspace: workspace(), env: e });
  await assert.rejects(ask({ system: "s", prompt: "electricity" }), RouteRefused);
  assert.equal(sent(prompts), 0);
});

test("an approved connection answers, and says who answered", async () => {
  const { prompts, e } = env();
  const ask = makeAsker({ settings: settings(["test-provider"]), workspace: workspace(), env: e });
  const r = await ask({ system: "s", prompt: "the electricity bill" });
  assert.equal(JSON.parse(r.text).title, "ok");
  assert.equal(r.provider, "test-provider");
  assert.equal(sent(prompts), 1);
  const d = await describe({ workspace: workspace(), env: e });
  assert.deepEqual(d, { provider: "test-provider", model: "test-model", backup: null });
});

test("no answer from the connection is a ModelUnavailable", async () => {
  const { e } = env({ GODSPEED_CLERK_FAKE_FAIL: "1" });
  const ask = makeAsker({ settings: settings(["test-provider"]), workspace: workspace(), env: e });
  await assert.rejects(ask({ system: "s", prompt: "electricity" }), ModelUnavailable);
});
