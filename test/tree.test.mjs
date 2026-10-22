// Loading the documents folder's tree costs a few Drive calls, not one per folder, and is kept
// between runs: a run with nothing new refreshes it with one call to Drive's changes feed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeDrive, TEST_CLIENT } from "./fakes/drive.mjs";
import { Drive, Confined, DriveError } from "../lib/core/drive.mjs";
import { kitWorld } from "./kit-world.mjs";

// Paperwork with 20 folders of 24 each: 500 folders below it. Outside, 100 more.
function bigTree() {
  const inside = {};
  for (let i = 0; i < 20; i++) { const sub = {}; for (let j = 0; j < 24; j++) sub[`Sender ${i}-${j}`] = {}; inside[`Group ${i}`] = sub; }
  const outside = {};
  for (let i = 0; i < 100; i++) outside[`Album ${i}`] = {};
  return { Paperwork: inside, Photos: outside };
}

async function setup(tree = bigTree()) {
  const fake = await startFakeDrive({ tree, pageSize: 1000 });
  const drive = new Drive({ creds: { client_id: TEST_CLIENT.id, client_secret: TEST_CLIENT.secret, refresh_token: fake.issue() }, env: fake.env });
  const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "clerk-tree-")), "drive-tree.json");
  const rootId = fake.idOf("Paperwork"); // kept, as the Clerk keeps it (a binned folder has no path)
  const open = () => new Confined(drive, { rootId }).load({ cachePath });
  return { fake, drive, cachePath, open };
}
const apiCalls = (fake, from = 0) => fake.calls.slice(from).filter((c) => c.path.startsWith("/drive/") || c.path.startsWith("/upload/"));
const folderListings = (calls) => calls.filter((c) => c.path === "/drive/v3/files" && c.method === "GET");

test("a documents folder of 500 folders loads in a handful of calls, and nothing outside it is read", async () => {
  const { fake, open } = await setup();
  try {
    const c = await open();
    assert.equal(c.folders.size, 501);
    assert.equal(c.isInside(fake.idOf("Paperwork/Group 7/Sender 7-3")), true);
    assert.equal(c.isInside(fake.idOf("Photos/Album 3")), false);
    const calls = apiCalls(fake);
    assert.ok(calls.length <= 9, `${calls.length} calls`);
    // Every listing asks for children of folders inside the documents folder, never for all folders.
    for (const q of folderListings(calls).map((x) => x.q)) assert.match(q, /in parents/);
    assert.ok(!folderListings(calls).some((x) => x.q.includes(fake.idOf("Photos"))));
  } finally { await fake.close(); }
});

test("the second time, with nothing new, one call and no reload", async () => {
  const { fake, open } = await setup();
  try {
    await open();
    const from = fake.calls.length;
    const c = await open();
    assert.equal(c.folders.size, 501);
    const calls = apiCalls(fake, from);
    assert.equal(calls.length, 1, JSON.stringify(calls));
    assert.equal(calls[0].path, "/drive/v3/changes");
  } finally { await fake.close(); }
});

test("what changed in the drive since is applied, and a folder moved in with its own folders is loaded whole", async () => {
  const { fake, open } = await setup({ Paperwork: { Letters: {}, Old: { 2019: {} } }, Elsewhere: { Archive: { Inner: { Deep: {} } } } });
  try {
    await open();
    const made = fake.addFolder("New sender", fake.idOf("Paperwork/Letters"));
    fake.userMove(fake.idOf("Paperwork/Old"), "Elsewhere");
    let c = await open();
    assert.equal(c.isInside(made), true);
    assert.equal(c.isInside(fake.idOf("Elsewhere/Old")), false);
    assert.equal(c.isInside(fake.idOf("Elsewhere/Old/2019")), false);
    fake.userMove(fake.idOf("Elsewhere/Archive"), "Paperwork");
    c = await open();
    assert.equal(c.isInside(fake.idOf("Paperwork/Archive/Inner/Deep")), true);
    fake.userRename(fake.idOf("Paperwork/Letters"), "Post");
    c = await open();
    assert.equal(c.children(fake.idOf("Paperwork")).find((f) => f.id === fake.idOf("Paperwork/Post")).name, "Post");
    fake.userTrash(fake.idOf("Paperwork/Post"));
    c = await open();
    assert.equal(c.isInside(made), false);
  } finally { await fake.close(); }
});

test("a documents folder moved to the bin is said plainly, cached or not", async () => {
  const { fake, open } = await setup({ Paperwork: { Letters: {} } });
  try {
    await open();
    fake.userTrash(fake.idOf("Paperwork"));
    await assert.rejects(open(), (e) => e instanceof DriveError && /documents folder/.test(e.message));
  } finally { await fake.close(); }
});

test("a folder the Clerk makes is known at once, and kept", async () => {
  const { fake, open } = await setup({ Paperwork: { Taxes: {} } });
  try {
    const c = await open();
    const y = await c.ensurePath(fake.idOf("Paperwork"), [{ name: "Taxes" }, { name: "2024", create: true }]);
    const from = fake.calls.length;
    const again = await open();
    assert.equal(again.isInside(y), true);
    assert.equal(apiCalls(fake, from).length, 1);
  } finally { await fake.close(); }
});

test("a run with nothing new reloads no tree: one Drive call", async () => {
  const w = await kitWorld({ only: ["utility-invoice", "pay-slip"] });
  try {
    await w.runUntilQuiet();
    const from = w.drive.calls.length;
    const r = await w.run();
    assert.equal(r.copied + r.sorted + r.filed, 0);
    const calls = apiCalls(w.drive, from);
    assert.equal(folderListings(calls).length, 0, JSON.stringify(calls));
    assert.ok(calls.length <= 1, JSON.stringify(calls));
  } finally { await w.close(); }
});

test("when Google finds a query too long, the batch gets smaller and the tree still loads whole", async () => {
  const fake = await startFakeDrive({ tree: bigTree(), pageSize: 1000, maxOr: 30 });
  try {
    const drive = new Drive({ creds: { client_id: TEST_CLIENT.id, client_secret: TEST_CLIENT.secret, refresh_token: fake.issue() }, env: fake.env });
    const c = await new Confined(drive, { rootId: fake.idOf("Paperwork") }).load();
    assert.equal(c.folders.size, 501);
  } finally { await fake.close(); }
});
