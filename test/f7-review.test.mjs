// F7 judged field by field, with what the independent review of the first round of batch 2b checked
// (fresh made-up papers), and the storage paths of papers filed below a place (F19).
import { test } from "node:test";
import assert from "node:assert/strict";
import { kitWorld } from "./kit-world.mjs";
import { cli } from "./helpers.mjs";
import { readJson } from "../lib/core/files.mjs";
import { statusReport } from "../lib/core/status.mjs";

const tram = { slug: "tram", owner: "alex", content: "Fairway Rail. Your tram pass FR-TRAM-5512, valid November 2026. Holder Alex Morgan, 12 Elm Row, 40210 Fairford." };
for (const [why, tree, unsureOf] of [
  ["unsure of the sender itself", { Paperwork: { "Fairway Rail": {}, Letters: {} } }, ["correspondent", "document_type"]],
  ["a look-alike folder that is not the same name", { Paperwork: { "Fairway Railways": {}, Letters: {} } }, ["document_type"]],
  ["a folder named like the sender, but outside the documents folder", { Paperwork: { Letters: {} }, "Fairway Rail": {} }, ["document_type"]],
]) {
  test(`F7: ${why}: Check this, To sort, no sender made`, async () => {
    const answers = [{ match: ["FR-TRAM-5512"], answer: { title: "Tram pass November 2026", correspondent: "Fairway Rail", document_type: "Receipt", tags: [], created: "2026-10-20", folder: null, confident: false, unsure: unsureOf } }];
    const w = await kitWorld({ only: [], extra: [tram], tree, rules: [{ folder: "{sender}" }], answers });
    try {
      await w.runUntilQuiet();
      assert.ok(w.tagNames(w.doc("tram")).includes("Check this"), why);
      assert.match(w.pathOf("tram"), /^Paperwork\/To sort\//, why);
      assert.equal(w.pl.writes.filter((x) => x.path === "/api/correspondents/").length, 0, why);
    } finally { await w.close(); }
  });
}

test("F7: a title the AI is unsure of is not set, even when the sender is placed by its own folder", async () => {
  const tree = { Paperwork: { "Fairway Rail": {}, Letters: {} } };
  const pass = { slug: "rail-pass", owner: "alex", content: "Fairway Rail. Monthly pass FR-PASS-3318, zone 1 to 3, November 2026. Holder Alex Morgan, 12 Elm Row, 40210 Fairford." };
  const answers = [{ match: ["FR-PASS-3318"], answer: { title: "Monthly pass November 2026", correspondent: "Fairway Rail", document_type: "Receipt", tags: [], created: "2026-10-20", folder: "{sender}", confident: false, unsure: ["title", "document_type"] } }];
  const w = await kitWorld({ only: [], extra: [pass], tree, rules: [{ folder: "{sender}" }], answers });
  try {
    await w.runUntilQuiet();
    const d = w.doc("rail-pass");
    assert.equal(w.senderName(d), "Fairway Rail");
    assert.equal(w.typeName(d), null);
    assert.match(d.title, /^Scan /, `the title the AI was unsure of is left for the person, got "${d.title}"`);
    assert.equal(w.pathOf("rail-pass"), "Paperwork/Fairway Rail/2026-10-20 Fairway Rail.pdf", "named by its date and sender meanwhile");
  } finally { await w.close(); }
});

test("F19: a paper filed below a sender folder carries that sender folder's storage path, set once", async () => {
  const tree = { Paperwork: { Northgate: { Car: {}, Home: {} }, Letters: {} } };
  const statement = { slug: "car-statement", owner: "alex", content: "Northgate. Car insurance statement NG-CAR-9910 for 2025, total paid 522.00 EUR. Alex Morgan, 12 Elm Row, 40210 Fairford." };
  const answers = [{ match: ["NG-CAR-9910"], answer: { title: "Car insurance statement 2025", correspondent: "Northgate", document_type: "Insurance", tags: [], created: "2026-01-31", folder: "{sender}", sender_folder: "Northgate/Car", confident: true } }];
  const w = await kitWorld({ only: [], extra: [statement], tree, rules: [{ folder: "{sender}" }], answers, settings: { storage_paths: "yes" } });
  try {
    await w.runUntilQuiet();
    assert.equal(w.pathOf("car-statement"), "Paperwork/Northgate/Car/2026-01-31 Car insurance statement 2025.pdf");
    const sp = w.pl.state.storagePaths.get(w.doc("car-statement").storage_path);
    assert.equal(sp?.name, "Northgate");
    const patches = w.pl.writes.length;
    await w.runUntilQuiet();
    assert.equal(w.pl.writes.length, patches, "nothing more to write");
  } finally { await w.close(); }
});

test("F19: renaming To sort renames its storage path and the To sort page", async () => {
  const w = await kitWorld({ only: ["blurry-scan"], settings: { storage_paths: "yes" } });
  try {
    await w.runUntilQuiet();
    const r = await cli(["plan", "to-sort", "Waiting room", "--state", w.paths.root], { env: w.env });
    assert.equal(r.code, 0, r.err);
    await w.runUntilQuiet();
    const sp = [...w.pl.state.storagePaths.values()].find((s) => s.matching_algorithm === 0);
    assert.equal(sp.name, "Waiting room");
    assert.equal(sp.path, "Paperwork/Waiting room/{{ added }} {{ title }}");
    assert.equal([...w.pl.state.savedViews.values()][0].name, "Waiting room");
    assert.deepEqual(w.pl.viewDocs([...w.pl.state.savedViews.values()][0].id), [w.ids["blurry-scan"]]);
  } finally { await w.close(); }
});

test("status names the To sort page and how many papers wait there", async () => {
  const w = await kitWorld({ only: ["blurry-scan", "utility-invoice"], settings: { storage_paths: "yes" } });
  try {
    await w.runUntilQuiet();
    const id = [...w.pl.state.savedViews.values()][0].id;
    assert.match(statusReport(w.paths, { env: {}, home: w.paths.root }), new RegExp(`To sort in Paperless: 1 paper waiting, ${w.pl.url.replace(/[.]/g, "\\.")}/view/${id}`));
    assert.ok(readJson(w.paths.mirror).view.id === id);
  } finally { await w.close(); }
});
