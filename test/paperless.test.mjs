import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakePaperless } from "./fakes/paperless.mjs";
import { Paperless, ReadOnlyError, Taxonomy, obtainToken } from "../lib/core/paperless.mjs";

const TAGS = [{ id: 1, name: "Inbox", is_inbox_tag: true, matching_algorithm: 0 }, { id: 2, name: "Tax 2024" }];

test("in 'paperless sorts' and 'nobody sorts' there is no way to write", async () => {
  const fake = await startFakePaperless({ tags: TAGS, docs: [{ id: 5, tags: [1] }] });
  try {
    const pl = new Paperless({ url: fake.url, token: "tok-alex" });
    assert.throws(() => pl.writer("nobody"), ReadOnlyError);
    assert.throws(() => pl.writer("paperless"), ReadOnlyError);
    await assert.rejects(pl.request("PATCH", "documents/5/", { body: { title: "x" } }), ReadOnlyError);
    await assert.rejects(pl.request("POST", "tags/", { body: { name: "x" } }), ReadOnlyError);
    assert.deepEqual(fake.writes, []);
  } finally { await fake.close(); }
});

test("the Clerk never deletes and never asks for a new token, even when writing is allowed", async () => {
  const fake = await startFakePaperless({ tags: TAGS, docs: [{ id: 5, tags: [1] }] });
  try {
    const pl = new Paperless({ url: fake.url, token: "tok-alex" });
    const w = pl.writer("godspeed");
    await assert.rejects(w.raw("DELETE", "documents/5/"), ReadOnlyError);
    await assert.rejects(w.raw("POST", "profile/generate_auth_token/"), ReadOnlyError);
    assert.deepEqual(fake.writes, []);
    await w.patchDocument(5, { title: "Electricity bill March 2025" });
    assert.equal(fake.doc(5).title, "Electricity bill March 2025");
    await assert.rejects(w.patchDocument(5, { owner: 9 }), /may not change owner/);
  } finally { await fake.close(); }
});

test("lists follow the next page on the address the Clerk was given", async () => {
  const docs = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, tags: [1] }));
  const fake = await startFakePaperless({ tags: TAGS, docs });
  try {
    const pl = new Paperless({ url: fake.url, token: "tok-alex" });
    const all = await pl.all("documents/", { page_size: 3, fields: "id" });
    assert.deepEqual(all.map((d) => d.id), [1, 2, 3, 4, 5, 6, 7]);
  } finally { await fake.close(); }
});

test("the token is read once with the account's password, through token/ only", async () => {
  const fake = await startFakePaperless({ tags: TAGS });
  try {
    const token = await obtainToken({ url: fake.url, user: "alex", password: "pw" });
    assert.equal(token, "tok-alex");
    assert.deepEqual(fake.writes.map((w) => w.path), ["/api/token/"]);
    await assert.rejects(obtainToken({ url: fake.url, user: "alex", password: "wrong" }), /refused the sign-in/);
  } finally { await fake.close(); }
});

test("an address with or without /api works", async () => {
  const fake = await startFakePaperless({ tags: TAGS });
  try {
    for (const url of [fake.url, `${fake.url}/`, `${fake.url}/api`, `${fake.url}/api/`]) {
      const me = await new Paperless({ url, token: "tok-alex" }).me();
      assert.equal(me.id, 2);
    }
  } finally { await fake.close(); }
});

test("the taxonomy knows the inbox tags and finds names whatever their case", async () => {
  const fake = await startFakePaperless({ tags: [...TAGS, { id: 3, name: "Second inbox", is_inbox_tag: true }], types: [{ id: 1, name: "Invoice" }], correspondents: [{ id: 1, name: "Brightwater Utilities" }] });
  try {
    const tax = await Taxonomy.load(new Paperless({ url: fake.url, token: "tok-alex" }));
    assert.deepEqual(tax.inboxIds(), [1, 3]);
    assert.equal(tax.tag("tax 2024").id, 2);
    assert.equal(tax.type("INVOICE").id, 1);
    assert.equal(tax.name(tax.correspondents, 1), "Brightwater Utilities");
  } finally { await fake.close(); }
});
