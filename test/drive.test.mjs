import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startFakeDrive, TEST_CLIENT } from "./fakes/drive.mjs";
import { Drive, Confined, DriveAccessLost, OutsideError } from "../lib/core/drive.mjs";

const TREE = {
  Paperwork: { Invoices: { "Brightwater Utilities": {} }, Taxes: { 2023: {} }, Letters: { "handwritten note.pdf": "a note" } },
  "Holiday photos": { "beach.jpg": "sand" },
};

async function setup(opts = {}) {
  const fake = await startFakeDrive({ tree: TREE, ...opts });
  const creds = { client_id: TEST_CLIENT.id, client_secret: TEST_CLIENT.secret, refresh_token: fake.issue() };
  const drive = new Drive({ creds, env: fake.env, chunkSize: opts.chunkSize });
  const confined = new Confined(drive, { rootId: fake.idOf("Paperwork") });
  await confined.load();
  return { fake, drive, confined };
}

const mark = { clerkDoc: "7", clerkSum: "a".repeat(64) };

test("an upload in three pieces arrives whole, with its size and checksums", async () => {
  const { fake, confined } = await setup({ chunkSize: 1000 });
  try {
    const bytes = crypto.randomBytes(2500);
    const f = await confined.uploadInto(fake.idOf("Paperwork/Letters"), { name: "2026-10-22 Scan.pdf", bytes, appProperties: mark });
    assert.equal(Number(f.size), 2500);
    assert.equal(f.md5Checksum, crypto.createHash("md5").update(bytes).digest("hex"));
    assert.equal(f.sha256Checksum, crypto.createHash("sha256").update(bytes).digest("hex"));
    assert.equal(fake.pathOf(f.id), "Paperwork/Letters/2026-10-22 Scan.pdf");
    assert.deepEqual(f.appProperties, mark);
  } finally { await fake.close(); }
});

test("a crash in the middle of an upload leaves no file behind", async () => {
  const fake = await startFakeDrive({ tree: TREE });
  try {
    const creds = { client_id: TEST_CLIENT.id, client_secret: TEST_CLIENT.secret, refresh_token: fake.issue() };
    const killed = new Error("killed");
    const drive = new Drive({ creds, env: fake.env, chunkSize: 1000, crash: (point) => { if (point === "mid-upload") throw killed; } });
    const confined = new Confined(drive, { rootId: fake.idOf("Paperwork") });
    await confined.load();
    await assert.rejects(confined.uploadInto(fake.idOf("Paperwork/Letters"), { name: "x.pdf", bytes: crypto.randomBytes(2500), appProperties: mark }), /killed/);
    assert.equal(fake.marked(7).length, 0);
    assert.equal(fake.writes.length, 0);
  } finally { await fake.close(); }
});

test("nothing is written outside the documents folder or into a file the Clerk did not make", async () => {
  const { fake, confined } = await setup();
  try {
    const outside = fake.idOf("Holiday photos");
    await assert.rejects(confined.uploadInto(outside, { name: "x.pdf", bytes: Buffer.from("x"), appProperties: mark }), OutsideError);
    const note = await confined.drive.get(fake.idOf("Paperwork/Letters/handwritten note.pdf"));
    await assert.rejects(confined.moveRename(note, { name: "renamed.pdf", parentId: fake.idOf("Paperwork/Letters") }), OutsideError);
    const mine = await confined.uploadInto(fake.idOf("Paperwork/Letters"), { name: "mine.pdf", bytes: Buffer.from("x"), appProperties: mark });
    await assert.rejects(confined.moveRename(mine, { name: "mine.pdf", parentId: outside }), OutsideError);
    await assert.rejects(confined.ensurePath(outside, [{ name: "New", create: true }]), OutsideError);
    assert.deepEqual(fake.writes.map((w) => w.op), ["upload"]);
    const moved = await confined.moveRename(mine, { name: "2025-03-04 Bill.pdf", parentId: fake.idOf("Paperwork/Invoices") });
    assert.equal(fake.pathOf(moved.id), "Paperwork/Invoices/2025-03-04 Bill.pdf");
  } finally { await fake.close(); }
});

test("a folder is made only where the plan allows it", async () => {
  const { fake, confined } = await setup();
  try {
    const root = fake.idOf("Paperwork");
    assert.equal(await confined.ensurePath(root, [{ name: "Receipts", create: false }]), null);
    const sender = await confined.ensurePath(root, [{ name: "Invoices", create: false }, { name: "Brightwater Utilities plc", create: true, sender: true }]);
    assert.equal(sender, fake.idOf("Paperwork/Invoices/Brightwater Utilities"));
    const year = await confined.ensurePath(root, [{ name: "Taxes", create: false }, { name: "2024", create: true }]);
    assert.equal(fake.pathOf(year), "Paperwork/Taxes/2024");
    assert.equal(confined.isInside(year), true);
    assert.deepEqual(fake.writes.map((w) => `${w.op} ${w.name}`), ["create-folder 2024"]);
  } finally { await fake.close(); }
});

test("a withdrawn Google permission is lost access, not a crash", async () => {
  const { fake, drive } = await setup();
  try {
    fake.revoke();
    drive.forgetToken();
    await assert.rejects(drive.about(), DriveAccessLost);
  } finally { await fake.close(); }
});

test("the Clerk's files are found again by their mark, and long lists are read to the end", async () => {
  const { fake, confined, drive } = await setup({ pageSize: 2 });
  try {
    for (let i = 0; i < 5; i++) fake.addFile(`old ${i}.pdf`, fake.idOf("Paperwork/Letters"), `old ${i}`);
    const f = await confined.uploadInto(fake.idOf("Paperwork/Letters"), { name: "mine.pdf", bytes: Buffer.from("x"), appProperties: mark });
    const found = await drive.findByMark({ docId: 7, sum: mark.clerkSum });
    assert.deepEqual(found.map((x) => x.id), [f.id]);
    const all = await drive.list(`'${fake.idOf("Paperwork/Letters")}' in parents and trashed = false`);
    assert.equal(all.length, 7);
    assert.equal((await drive.findByMark({ docId: 8, sum: "b".repeat(64) })).length, 0);
  } finally { await fake.close(); }
});
