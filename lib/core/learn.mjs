// The Clerk keeps the person's choice (F19): a sender whose paper the person put into a folder is
// filed there from then on, as part of the folder plan.
//   - The sender's own folder of the same name, where the plan keeps sender folders: the plan sends
//     that sender's papers there anyway; its link (links.json) is kept.
//   - Any other folder: a rule { sender, folder, folder_id } at the top of the plan. It names its
//     folder by id, so a folder the person renames or moves stays that folder.
// Only the sender of that very paper is learned; another sender's papers are never moved by it.
import { readJson, writeJson } from "./files.mjs";
import { findSame } from "./names.mjs";
import { folderChoices } from "./plan.mjs";
import { now } from "./records.mjs";

// The folder right below a sender parent on the way down to a folder: the sender folder it is in.
export function senderFolderOf(c, id) {
  for (let at = id, i = 0; at && i < 64; i++) {
    const f = c.confined.folders.get(at);
    if (!f) return null;
    if ((c.senderParents || []).some((p) => p.id === f.parent)) return f;
    at = f.parent;
  }
  return null;
}

function relPath(c, id) {
  const out = [];
  for (let at = id, i = 0; at && at !== c.rootId && i < 64; i++) { const f = c.confined.folders.get(at); if (!f) return null; out.unshift(f.name); at = f.parent; }
  return out.join("/");
}

export function addRule(c, rule) {
  const plan = readJson(c.ctx.paths.plan, null);
  if (!plan) return;
  const same = (r) => rule.sender && r.sender && findSame([{ name: r.sender }], rule.sender);
  plan.rules = [{ ...rule, learned_at: now() }, ...(plan.rules || []).filter((r) => !same(r))];
  writeJson(c.ctx.paths.plan, plan);
  c.ctx.plan = plan;
  c.plan = plan;
  c.folderChoices = folderChoices(plan);
}

function link(c, senderId, folderId) {
  if (senderId === null || senderId === undefined || c.links[senderId] === folderId) return;
  c.links[senderId] = folderId;
  writeJson(c.ctx.paths.links, c.links);
}

// Keeps a sender's folder: "link" | "rule" | null.
export function learnSender(c, senderName, senderId, folderId) {
  if (!senderName || !folderId) return null;
  const sf = senderFolderOf(c, folderId);
  if (sf && findSame([{ name: sf.name }], senderName)) { link(c, senderId, sf.id); return "link"; }
  const folder = relPath(c, folderId);
  if (!folder) return null;
  const had = (c.plan?.rules || []).find((r) => r.sender && r.folder_id === folderId && findSame([{ name: r.sender }], senderName));
  if (!had) addRule(c, { sender: senderName, folder, folder_id: folderId });
  return "rule";
}

// The learned rule for a paper's sender, if there is one: its folder id.
export function learnedFolder(plan, sender) {
  if (!sender) return null;
  return (plan?.rules || []).find((r) => r.sender && r.folder_id && findSame([{ name: r.sender }], sender))?.folder_id ?? null;
}
