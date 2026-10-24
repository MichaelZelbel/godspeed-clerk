import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { kitWorld, KIT, KIT_RULES, text } from "./kit-world.mjs";
import { readJson, writeJson } from "../lib/core/files.mjs";
import { Drive, Confined } from "../lib/core/drive.mjs";
import { TEST_CLIENT } from "./fakes/drive.mjs";
import { confirmPlan } from "../lib/core/plan.mjs";
import { loadSettings } from "../lib/core/settings.mjs";
import { statusReport } from "../lib/core/status.mjs";
import { nightly, updateNow } from "../lib/install/keep.mjs";
import { disconnect } from "../lib/core/oauth.mjs";

async function addDrive(w) {
  const root = { id: w.drive.idOf("Paperwork"), name: "Paperwork" };
  const creds = { client_id: TEST_CLIENT.id, client_secret: TEST_CLIENT.secret, refresh_token: w.drive.issue(), account: KIT.drive.account, root };
  writeJson(w.paths.drive, creds);
  const confined = await new Confined(new Drive({ creds, env: w.env }), { rootId: root.id }).load();
  writeJson(w.paths.plan, await confirmPlan(confined, { root, rules: KIT_RULES }, loadSettings(w.paths)));
}

test("without Drive a scan is sorted, noted and given deadlines with Paperless links, then gains one Drive copy without duplicates", async () => {
  const w = await kitWorld({ connectDrive: false, only: ["water-invoice"] });
  try {
    await w.runUntilQuiet();
    const note = w.noteOf("water-invoice"), items = w.nb.rows("collection_items"), record = w.record("water-invoice");
    const deadlines = (await w.context().notebook.deadlines({action:"list"})).deadlines;
    assert.equal(record.sort.result, "sorted");
    assert.equal(record.file, undefined);
    assert.equal(w.drive.state.calls.length, 0);
    assert.equal(items.length, 1);
    assert.equal(items[0].data.status, "sorted");
    assert.equal(items[0].data.in_drive, false);
    assert.equal(items[0].data.drive, "");
    assert.match(note.content, /documents\/1\/details/);
    assert.doesNotMatch(note.content, /drive\.google/);
    assert.equal(deadlines.length, 1);
    assert.match(statusReport(w.paths), /Google Drive: optional, not connected/);
    assert.match(statusReport(w.paths), /no off-server backup/);
    assert.match(statusReport(w.paths), /Folder plan: not needed/);
    const ids = { note: note.id, item: items[0].id, due: deadlines[0].id };
    await addDrive(w);
    await w.runUntilQuiet();
    assert.equal(w.fileOf("water-invoice").length, 1);
    assert.equal(w.notes().length, 1);
    assert.equal(w.noteOf("water-invoice").id, ids.note);
    assert.match(w.noteOf("water-invoice").content, /drive\.google/);
    assert.equal(w.nb.rows("collection_items").length, 1);
    assert.equal(w.nb.rows("collection_items")[0].id, ids.item);
    assert.equal(w.nb.rows("collection_items")[0].data.in_drive, true);
    assert.deepEqual(((await w.context().notebook.deadlines({action:"list"})).deadlines).map(d=>d.id), [ids.due]);
    await w.run();
    assert.equal(w.fileOf("water-invoice").length, 1);
  } finally { await w.close(); }
});

test("an earlier Drive connection lost or removed is not treated as intentionally skipped", async () => {
  const w = await kitWorld({ only: ["water-invoice"] });
  try {
    w.drive.revoke();
    await w.runUntilQuiet();
    assert.equal(w.notes().length, 0, "existing first-copy safeguard remains during lost access");
    assert.ok(readJson(w.paths.state).drive.lost_since);
    assert.match(statusReport(w.paths), /access LOST/);
    assert.doesNotMatch(statusReport(w.paths), /optional, not connected/);
    fs.rmSync(w.paths.drive);
    await w.run();
    assert.equal(w.notes().length, 0);
    assert.match(statusReport(w.paths), /filing waits/);
    assert.doesNotMatch(statusReport(w.paths), /Folder plan: not needed/);
  } finally { await w.close(); }
});

test("explicit Drive disconnect keeps old files and lets new papers get notes and deadlines, then reconnects without duplicates", async () => {
  const w = await kitWorld({only:["utility-invoice"]});
  try {
    await w.runUntilQuiet();
    const oldFile=w.fileOf("utility-invoice")[0];
    const writes=w.drive.state.writes.length;
    w.drive.revoke(); await w.run();
    assert.ok(readJson(w.paths.state).drive.lost_since);
    await disconnect(w.paths,{fetchImpl:async()=>new Response("",{status:200})});
    assert.equal(readJson(w.paths.state).drive.lost_since,undefined);
    w.ids["water-invoice"]=50;
    w.pl.addDoc({id:50,content:text("water-invoice"),title:"Scan 2026-10-22 16-30-00",original_file_name:"Scan 2026-10-22 16-30-00.pdf",tags:[1],owner:2,created:"2026-10-22",added:new Date().toISOString()});
    await w.runUntilQuiet();
    const note=w.noteOf("water-invoice");
    const item=w.nb.rows("collection_items").find(i=>i.source_id===w.record("water-invoice").sum);
    const due=(await w.context().notebook.deadlines({action:"list"})).deadlines;
    assert.equal(due.length,1);
    assert.equal(w.record("water-invoice").file,undefined);
    assert.equal(w.drive.state.writes.length,writes);
    assert.equal(w.fileOf("utility-invoice")[0].id,oldFile.id);
    assert.match(statusReport(w.paths),/disconnected by you/);
    await addDrive(w); await w.runUntilQuiet();
    assert.equal(w.fileOf("water-invoice").length,1);
    assert.equal(w.fileOf("utility-invoice")[0].id,oldFile.id);
    assert.equal(w.noteOf("water-invoice").id,note.id);
    assert.equal(w.nb.rows("collection_items").find(i=>i.source_id===w.record("water-invoice").sum).id,item.id);
    assert.deepEqual((await w.context().notebook.deadlines({action:"list"})).deadlines.map(d=>d.key),due.map(d=>d.key));
  } finally {await w.close();}
});

for (const sorting of ["nobody", "paperless"]) test(`without Drive ${sorting} still gets notebook records and never writes Paperless`, async () => {
  const w = await kitWorld({ connectDrive: false, sorting, only: ["water-invoice"] });
  try {
    await w.runUntilQuiet();
    assert.equal(w.notes().length, 1);
    assert.equal(w.nb.rows("collection_items").length, 1);
    assert.equal(w.pl.state.writes.length, 0);
    assert.equal(w.drive.state.calls.length, 0);
  } finally { await w.close(); }
});

test("without Drive managed automatic updates remain behind the fresh restore-copy gate", async () => {
  const w = await kitWorld({ connectDrive: false, only: ["water-invoice"] });
  try {
    writeJson(w.paths.installed, { stage: "done", version: "3.2.0", dir: w.paths.root, project: "test", user: "alex" });
    const calls=[];
    const run=(...args)=>{calls.push(args);throw Error("No Docker/export/update command may run");};
    assert.equal((await nightly(w.context(), {run})).update, undefined);
    const update=await updateNow(w.context(), {run,to:"3.3.3"});
    assert.equal(update.ok, false);
    assert.match(update.why,/no fresh restore copy/);
    assert.equal(calls.length,0);
    assert.match(statusReport(w.paths),/Automatic Paperless updates wait for a fresh restore copy/);
  } finally { await w.close(); }
});
