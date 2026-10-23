// The kit in a pretend world: a pretend Paperless holding the kit's made-up documents as the phone
// app would have sent them, a pretend Google Drive with the kit's made-up folder tree, the Clerk's
// state folder with both connections made and the folder plan confirmed, and the recorded AI
// answers. The fast tests run the real Clerk against it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakePaperless } from "./fakes/paperless.mjs";
import { startFakeDrive, TEST_CLIENT } from "./fakes/drive.mjs";
import { startFakeNotebook } from "./fakes/notebook.mjs";
import { Notebook } from "../lib/core/notebook.mjs";
import { SOURCE } from "../lib/core/note.mjs";
import { answerFor } from "./fakes/answers.mjs";
import { statePaths } from "../lib/core/paths.mjs";
import { saveSettings, loadSettings } from "../lib/core/settings.mjs";
import { writeJson, readJson } from "../lib/core/files.mjs";
import { Drive, Confined } from "../lib/core/drive.mjs";
import { confirmPlan } from "../lib/core/plan.mjs";
import { buildContext } from "../lib/core/context.mjs";
import { runOnce } from "../lib/core/run.mjs";

const KIT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "kit");
export const KIT = JSON.parse(fs.readFileSync(path.join(KIT_DIR, "kit.json"), "utf8"));
export const DOCS = JSON.parse(fs.readFileSync(path.join(KIT_DIR, "documents.json"), "utf8")).documents;
export const ANSWERS = JSON.parse(fs.readFileSync(path.join(KIT_DIR, "answers.json"), "utf8"));
export const text = (slug) => fs.readFileSync(path.join(KIT_DIR, "documents", `${slug}.txt`), "utf8").split("=== page ===\n").join("\n\n");
export const expected = (slug) => JSON.parse(fs.readFileSync(path.join(KIT_DIR, "expected", `${slug}.json`), "utf8"));
export const TODAY = new Date("2026-10-22T12:00:00Z");

// The plan Alex confirmed for the kit tree (what proposePlan plus the recorded AI answer give).
export const KIT_RULES = [
  { type: "Invoice", folder: "Invoices/{sender}" }, { type: "Tax assessment", folder: "Taxes/{year}" }, { type: "Insurance", folder: "Insurance" },
  { type: "Pay slip", folder: "Payslips/{year}" }, { type: "Letter", folder: "Letters" }, { type: "Bank statement", folder: "Bank" }, { type: "Certificate", folder: "Taxes/{year}" },
];

export async function kitWorld({ sorting = "godspeed", only = null, settings = {}, answers = ANSWERS, connectDrive = true, confirm = true, tree = KIT.drive.tree, rules = KIT_RULES, extra = [] } = {}) {
  const k = KIT.paperless;
  const tags = k.tags.map((t, i) => ({ id: i + 1, ...t }));
  const types = k.types.map((name, i) => ({ id: i + 1, name }));
  const correspondents = [...k.correspondents, "Harbor Bank"].map((name, i) => ({ id: i + 1, name }));
  const tagId = (n) => tags.find((t) => t.name === n).id;
  const docs = [], ids = {};
  let n = 1;
  for (const d of [...DOCS, ...extra]) {
    if (only && !only.includes(d.slug) && !extra.includes(d)) continue;
    const id = n++;
    ids[d.slug] = id;
    const scan = `Scan 2026-10-22 16-17-${String(id).padStart(2, "0")}`;
    const base = { id, content: d.content ?? text(d.slug), title: d.upload?.title || scan, original_file_name: `${scan}.pdf`, tags: [tagId("Inbox"), ...(d.upload?.tags || []).map(tagId)],
      created: "2026-10-22", added: `2026-10-22T16:${String(10 + id).padStart(2, "0")}:00+02:00`, owner: d.owner === "sam" ? 3 : 2, size: 4000 + id * 100 };
    if (d.presorted) {
      const p = d.presorted;
      if (!correspondents.find((c) => c.name === p.correspondent)) correspondents.push({ id: correspondents.length + 1, name: p.correspondent });
      Object.assign(base, { title: p.title, correspondent: correspondents.find((c) => c.name === p.correspondent).id, document_type: types.find((t) => t.name === p.document_type).id, tags: p.tags.map(tagId), created: p.created });
    }
    docs.push(base);
  }
  const pl = await startFakePaperless({ users: [{ id: 2, username: "alex", password: "pw", token: "tok-alex" }, { id: 3, username: "sam", password: "pw2", token: "tok-sam" }], tags, types, correspondents, docs });
  const drive = await startFakeDrive({ tree, account: KIT.drive.account });
  const nb = await startFakeNotebook();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-kit-"));
  const paths = statePaths(dir);
  writeJson(paths.paperless, { url: pl.url, user: "alex", token: "tok-alex" });
  saveSettings(paths, { active: true, sorting, about: KIT.profile, country: KIT.country, tag_rules: k.tag_rules, approved_ai: ["test-provider"], settle_minutes: 0, ...settings });
  if (connectDrive) {
    writeJson(paths.drive, { client_id: TEST_CLIENT.id, client_secret: TEST_CLIENT.secret, refresh_token: drive.issue(), account: KIT.drive.account, root: { id: drive.idOf("Paperwork"), name: "Paperwork" } });
    const plan = { format: 1, status: "proposed", root: { id: drive.idOf("Paperwork"), name: "Paperwork" }, rules };
    if (confirm) {
      const confined = await new Confined(new Drive({ creds: readJson(paths.drive), env: drive.env }), { rootId: plan.root.id }).load();
      writeJson(paths.plan, await confirmPlan(confined, plan, loadSettings(paths)));
      drive.state.writes.length = 0; // "To sort" was made at confirmation; the tests count the run's writes
    } else writeJson(paths.plan, plan);
  }
  const prompts = [];
  const used = {};
  let answerList = answers;
  const ask = async ({ system, prompt }) => {
    prompts.push({ system, prompt });
    if (world.aiDown) { const e = new Error("no answer from Godspeed's model connection"); e.name = "ModelUnavailable"; throw e; }
    return { text: answerFor(answerList, used, system, prompt), provider: "test-provider", model: "test-model" };
  };
  // Every message the Clerk sends, as a channel that took it (`channelDown`: no channel takes it).
  const messages = [];
  const tell = async (text) => { if (world.channelDown) return { delivered: false, results: { pretend: "down" } }; messages.push(text); return { delivered: true, results: { pretend: "ok" } }; };
  const world = {
    pl, drive, nb, paths, ids, prompts, messages, aiDown: false, channelDown: false,
    env: { ...drive.env, GODSPEED_CLERK_NOTEBOOK: nb.url },
    setAnswers: (a) => { answerList = a; },
    context: (opts = {}) => buildContext(paths, { env: world.env, ask, today: TODAY, notebook: new Notebook({ base: nb.url, timeoutMs: 3000 }), tell, ...opts }),
    run: (opts = {}) => runOnce(world.context(opts)),
    async runUntilQuiet(opts = {}, max = 12) {
      const out = [];
      for (let i = 0; i < max; i++) {
        const r = await world.run(opts);
        out.push(r);
        if (!r.copied && !r.sorted && !r.check && !r.filed && !r.waiting && !r.noted && !r.items && !r.notes_waiting) break;
      }
      return out;
    },
    record: (slug) => readJson(path.join(paths.records, `${ids[slug]}.json`), null),
    fileOf: (slug) => drive.marked(ids[slug]).filter((f) => !f.trashed),
    pathOf: (slug) => { const f = world.fileOf(slug); return f.length === 1 ? drive.pathOf(f[0].id) : f.map((x) => drive.pathOf(x.id)); },
    doc: (slug) => pl.doc(ids[slug]),
    tagNames: (doc) => doc.tags.map((t) => pl.state.tags.get(t).name).sort(),
    senderName: (doc) => (doc.correspondent ? pl.state.correspondents.get(doc.correspondent).name : null),
    typeName: (doc) => (doc.document_type ? pl.state.types.get(doc.document_type).name : null),
    // The Clerk's notes in the notebook (trashed ones too), and those of one kit document.
    notes: () => nb.rows("notes").filter((n) => n.source_app === SOURCE),
    notesOf: (slug) => world.notes().filter((n) => n.clerk_doc === ids[slug]),
    noteOf: (slug) => { const n = world.notesOf(slug); if (n.length !== 1) throw new Error(`${slug} has ${n.length} notes`); return n[0]; },
    // Everything this world made goes with it, its state folder too.
    close: async () => { await pl.close(); await drive.close(); await nb.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
  return world;
}
