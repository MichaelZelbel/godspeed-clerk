import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeDrive, TEST_CLIENT } from "./fakes/drive.mjs";
import { startSignIn, finishSignIn, readDriveConnection } from "../lib/core/oauth.mjs";
import { statePaths } from "../lib/core/paths.mjs";
import { cli } from "./helpers.mjs";

const tmp = () => statePaths(fs.mkdtempSync(path.join(os.tmpdir(), "clerk-oauth-")));
// What the person's browser does: follow the link, consent, land on the address that does not open.
async function consent(url) {
  const r = await fetch(url, { redirect: "manual" });
  return r.headers.get("location");
}

test("the sign-in link asks for the whole drive, offline, with PKCE", async () => {
  const fake = await startFakeDrive();
  try {
    const p = tmp();
    const { url, redirect } = startSignIn(p, { clientId: TEST_CLIENT.id, clientSecret: TEST_CLIENT.secret, port: 47999, env: fake.env });
    const q = new URL(url).searchParams;
    assert.equal(q.get("scope"), "https://www.googleapis.com/auth/drive");
    assert.equal(q.get("code_challenge_method"), "S256");
    assert.equal(q.get("access_type"), "offline");
    assert.equal(q.get("prompt"), "consent");
    assert.equal(q.get("response_type"), "code");
    assert.equal(redirect, "http://127.0.0.1:47999/callback");
    assert.equal(q.get("redirect_uri"), redirect);
    assert.ok(q.get("state").length >= 16);
    if (process.platform !== "win32") assert.equal(fs.statSync(p.pendingOauth).mode & 0o777, 0o600);
  } finally { await fake.close(); }
});

test("finishing with the address the browser landed on connects the account", async () => {
  const fake = await startFakeDrive({ account: "alex@example.test" });
  try {
    const p = tmp();
    const { url } = startSignIn(p, { clientId: TEST_CLIENT.id, clientSecret: TEST_CLIENT.secret, port: 47999, env: fake.env });
    const landed = await consent(url);
    const r = await finishSignIn(p, landed, { env: fake.env });
    assert.equal(r.account, "alex@example.test");
    const c = readDriveConnection(p);
    assert.equal(c.account, "alex@example.test");
    assert.ok(c.refresh_token);
    assert.equal(fs.existsSync(p.pendingOauth), false);
  } finally { await fake.close(); }
});

test("finish refuses an address from another sign-in", async () => {
  const fake = await startFakeDrive();
  try {
    const p = tmp();
    const { url } = startSignIn(p, { clientId: TEST_CLIENT.id, clientSecret: TEST_CLIENT.secret, port: 47999, env: fake.env });
    const landed = new URL(await consent(url));
    landed.searchParams.set("state", "someone-else");
    await assert.rejects(finishSignIn(p, landed.toString(), { env: fake.env }), /not the sign-in this Clerk started/);
    assert.equal(readDriveConnection(p), null);
    await assert.rejects(finishSignIn(p, "4/0AfJohXn-just-a-code", { env: fake.env }), /whole address/);
  } finally { await fake.close(); }
});

test("a grant without the drive permission is refused", async () => {
  const fake = await startFakeDrive({ grantScope: "https://www.googleapis.com/auth/drive.file" });
  try {
    const p = tmp();
    const { url } = startSignIn(p, { clientId: TEST_CLIENT.id, clientSecret: TEST_CLIENT.secret, port: 47999, env: fake.env });
    await assert.rejects(finishSignIn(p, await consent(url), { env: fake.env }), /whole drive/);
    assert.equal(readDriveConnection(p), null);
  } finally { await fake.close(); }
});

test("a declined consent is said plainly and nothing is kept", async () => {
  const p = tmp();
  startSignIn(p, { clientId: TEST_CLIENT.id, clientSecret: TEST_CLIENT.secret, port: 47999, env: {} });
  const pending = JSON.parse(fs.readFileSync(p.pendingOauth, "utf8"));
  await assert.rejects(finishSignIn(p, `http://127.0.0.1:47999/callback?error=access_denied&state=${pending.state}`, { env: {} }), /did not allow/);
  assert.equal(readDriveConnection(p), null);
});

test("the command line: connect prints the link, finish connects, folder takes a link or a top-level name", async () => {
  const fake = await startFakeDrive({ tree: { Paperwork: { Letters: {} }, Other: {} } });
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-oauth-cli-"));
    const r = await cli(["drive", "connect", "--client-id", TEST_CLIENT.id, "--client-secret", TEST_CLIENT.secret, "--state", dir], { env: fake.env });
    assert.equal(r.code, 0);
    const link = r.out.match(/(http\S+\/o\/oauth2\/v2\/auth\S+)/)[1];
    const done = await cli(["drive", "finish", await consent(link), "--state", dir], { env: fake.env });
    assert.equal(done.code, 0, done.err);
    assert.match(done.out, /alex@example.test/);
    const byName = await cli(["drive", "folder", "Paperwork", "--state", dir], { env: fake.env });
    assert.equal(byName.code, 0, byName.err);
    assert.equal(readDriveConnection(statePaths(dir)).root.id, fake.idOf("Paperwork"));
    const byLink = await cli(["drive", "folder", `https://drive.google.com/drive/u/0/folders/${fake.idOf("Other")}?usp=sharing`, "--state", dir], { env: fake.env });
    assert.equal(byLink.code, 0, byLink.err);
    assert.equal(readDriveConnection(statePaths(dir)).root.name, "Other");
    const missing = await cli(["drive", "folder", "Nowhere", "--state", dir], { env: fake.env });
    assert.equal(missing.code, 1);
  } finally { await fake.close(); }
});
