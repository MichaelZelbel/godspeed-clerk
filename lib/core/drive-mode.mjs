// A fresh installation may run entirely in Paperless. A previous Drive connection, plan or copy
// remains a Drive installation even when credentials disappear or access is temporarily lost.
import fs from "node:fs";
import { Records } from "./records.mjs";
import { readJson } from "./files.mjs";

export function driveConfigured(paths) {
  const connection = readJson(paths.drive, null);
  if (connection?.disconnected_at && !connection.refresh_token) return false;
  return [paths.drive, paths.plan, paths.restoreIndex].some((file) => fs.existsSync(file))
    || !!readJson(paths.state, {}).drive?.lost_since
    || new Records(paths).all().some((r) => r.copy || r.file || r.user_owned);
}
