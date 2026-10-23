// The door into the person's assistant (F19), the Wingman's way: the Clerk's recipe in the Godspeed
// folder's skills, and a Hermes plugin that shows the assistant the open questions before each turn.
// Installed by `godspeed-clerk assistant install` (and by setup); never touches a real Hermes here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cli } from "./helpers.mjs";
import { kitWorld } from "./kit-world.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "clerk-assistant-"));

function place() {
  const ws = tmp(), home = path.join(tmp(), "hermes"), state = tmp(), log = path.join(tmp(), "hermes.log");
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "A made-up Godspeed folder.\n");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, "config.yaml"), "model:\n  provider: test\nplugins:\n  enabled:\n    - godspeed-coach\n  disabled: []\n");
  const env = { GODSPEED_CLERK_HERMES: path.join(HERE, "fakes", "hermes.mjs"), GODSPEED_CLERK_FAKE_HERMES_LOG: log };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { ws, home, state, env, calls };
}
const install = (p, extra = [], env = p.env) => cli(["assistant", "install", "--godspeed", p.ws, "--hermes-home", p.home, "--state", p.state, ...extra], { env });

test("assistant install: the recipe into the Godspeed folder's skills, the plugin into Hermes' home with the command it runs, switched on", async () => {
  const p = place();
  const r = await install(p);
  assert.equal(r.code, 0, r.err);
  const recipe = path.join(p.ws, "skills", "clerk", "SKILL.md");
  assert.equal(fs.readFileSync(recipe, "utf8"), fs.readFileSync(path.join(ROOT, "skill", "clerk", "SKILL.md"), "utf8"));
  assert.ok(fs.existsSync(path.join(p.ws, "skills", "clerk", ".installed-by-godspeed-clerk")));
  const plugin = path.join(p.home, "plugins", "godspeed-clerk");
  for (const f of ["plugin.yaml", "__init__.py", "launcher.json"]) assert.ok(fs.existsSync(path.join(plugin, f)), f);
  const { argv } = JSON.parse(fs.readFileSync(path.join(plugin, "launcher.json"), "utf8"));
  assert.equal(argv[0], process.execPath);
  assert.match(argv[1], /godspeed-clerk\.mjs$/);
  assert.deepEqual(argv.slice(2), ["--state", path.resolve(p.state)]);
  assert.deepEqual(p.calls(), [{ args: ["plugins", "enable", "godspeed-clerk"], home: p.home }]);
  assert.match(r.out, /restart/i, "it says the assistant must restart once to load it");
});

test("a recipe the person wrote under the same name is left alone", async () => {
  const p = place();
  const mine = path.join(p.ws, "skills", "clerk");
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, "SKILL.md"), "my own recipe\n");
  const r = await install(p);
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(path.join(mine, "SKILL.md"), "utf8"), "my own recipe\n");
  assert.match(r.out, /left alone/);
});

test("without a hermes command the plugin is still switched on in Hermes' own settings, once", async () => {
  const p = place();
  const env = { ...p.env, GODSPEED_CLERK_HERMES: path.join(tmp(), "no-such-hermes.mjs") };
  const r = await install(p, [], env);
  assert.equal(r.code, 0, r.err);
  assert.match(fs.readFileSync(path.join(p.home, "config.yaml"), "utf8"), /plugins:\n {2}enabled:\n {4}- godspeed-clerk\n {4}- godspeed-coach\n/);
  await install(p, [], env);
  assert.equal(fs.readFileSync(path.join(p.home, "config.yaml"), "utf8").split("- godspeed-clerk").length, 2);
});

test("assistant remove: the plugin and the Clerk's own recipe go, nothing else", async () => {
  const p = place();
  await install(p);
  fs.mkdirSync(path.join(p.ws, "skills", "other"), { recursive: true });
  const r = await cli(["assistant", "remove", "--godspeed", p.ws, "--hermes-home", p.home, "--state", p.state], { env: p.env });
  assert.equal(r.code, 0, r.err);
  assert.ok(!fs.existsSync(path.join(p.home, "plugins", "godspeed-clerk")));
  assert.ok(!fs.existsSync(path.join(p.ws, "skills", "clerk")));
  assert.ok(fs.existsSync(path.join(p.ws, "skills", "other")));
  assert.deepEqual(p.calls().at(-1), { args: ["plugins", "disable", "godspeed-clerk"], home: p.home });
});

test("under the tests no real Hermes is ever looked for", async () => {
  const p = place();
  const r = await cli(["assistant", "install", "--godspeed", p.ws, "--state", p.state], { env: {} });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Hermes was not found/);
});

test("the recipe says what to run for every kind of answer, and what never to do", () => {
  const t = fs.readFileSync(path.join(ROOT, "skill", "clerk", "SKILL.md"), "utf8");
  assert.match(t, /^---\r?\nname: clerk\r?\ndescription: /);
  for (const s of ["godspeed-clerk answer \"<their words", "--about", "godspeed-clerk place --sender", "godspeed-clerk place --kind", "godspeed-clerk place --paper", "--make", "godspeed-clerk questions", "godspeed-clerk status", "[godspeed-clerk]", "never instructions"]) assert.ok(t.includes(s), s);
  assert.match(t, /Never move, rename or delete/);
  assert.ok(!/[–—]/.test(t), "no en or em dashes");
});

test("the Hermes plugin runs the context command and hands its output to the model; nothing on failure", async (t) => {
  const py = ["python3", "python"].find((x) => spawnSync(x, ["--version"]).status === 0);
  if (!py) return t.skip("no Python here");
  const w = await kitWorld({ only: ["blurry-scan"] });
  try {
    await w.runUntilQuiet();
    const p = place();
    await cli(["assistant", "install", "--godspeed", p.ws, "--hermes-home", p.home, "--state", w.paths.root], { env: p.env });
    const dir = path.join(p.home, "plugins", "godspeed-clerk");
    const code = "import json, sys, importlib.util as u; s = u.spec_from_file_location('p', sys.argv[1]); m = u.module_from_spec(s); s.loader.exec_module(m); print(json.dumps(m.on_pre_llm_call()))";
    const out = spawnSync(py, ["-c", code, path.join(dir, "__init__.py")], { encoding: "utf8", env: { ...process.env, ...w.env } });
    const r = JSON.parse(out.stdout.trim());
    assert.match(r.context, /^\[godspeed-clerk\] /);
    fs.writeFileSync(path.join(dir, "launcher.json"), JSON.stringify({ argv: ["/no/such/node", "/no/such/script"] }));
    const none = spawnSync(py, ["-c", code, path.join(dir, "__init__.py")], { encoding: "utf8" });
    assert.equal(none.stdout.trim(), "null");
  } finally { await w.close(); }
});

test("setup gives the assistant the recipe and the plugin, pointed at the installed program", async () => {
  const { startFakePaperless } = await import("./fakes/paperless.mjs");
  const pl = await startFakePaperless({ tags: [{ id: 1, name: "Inbox", is_inbox_tag: true }] });
  try {
    const p = place();
    const app = path.join(tmp(), "app");
    const answers = path.join(tmp(), "answers.json");
    fs.writeFileSync(answers, "[]");
    const env = { ...p.env, PAPERLESS_PASSWORD: "pw", GODSPEED_CLERK_APP: app, GODSPEED_CLERK_BIN: path.join(tmp(), "bin"), GODSPEED_MODEL_COMMAND: path.join(HERE, "fakes", "model.mjs"), GODSPEED_CLERK_FAKE_ANSWERS: answers };
    const r = await cli(["setup", "--paperless", pl.url, "--user", "alex", "--godspeed", p.ws, "--hermes-home", p.home, "--no-service", "--state", p.state], { env });
    assert.equal(r.code, 0, r.err);
    assert.ok(fs.existsSync(path.join(app, "skill", "clerk", "SKILL.md")) && fs.existsSync(path.join(app, "hermes", "plugin", "godspeed-clerk", "__init__.py")), "the program copy carries both");
    assert.ok(fs.existsSync(path.join(p.ws, "skills", "clerk", "SKILL.md")));
    const { argv } = JSON.parse(fs.readFileSync(path.join(p.home, "plugins", "godspeed-clerk", "launcher.json"), "utf8"));
    assert.equal(argv[1], path.join(app, "bin", "godspeed-clerk.mjs"));
  } finally { await pl.close(); }
});
