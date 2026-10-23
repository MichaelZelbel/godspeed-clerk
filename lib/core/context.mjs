// Everything one run needs, read fresh from the state folder each time. The tests hand in their
// own AI (`ask`), clock, day and crash point; the command line hands in the real ones.
import { loadSettings } from "./settings.mjs";
import { readJson } from "./files.mjs";
import { Paperless } from "./paperless.mjs";
import { Drive } from "./drive.mjs";
import { readDriveConnection } from "./oauth.mjs";
import { makeAsker } from "./model.mjs";
import { findMissionControl } from "./paths.mjs";
import { Records, makeLog, makeOutbox } from "./records.mjs";
import { Notebook, DEFAULT_NOTEBOOK } from "./notebook.mjs";

// Under `node --test` the Clerk never reaches the person's real notebook or sends them a real
// message: a test that wants a notebook or a channel names its own (GODSPEED_CLERK_NOTEBOOK, a
// fake Telegram address in test mode, or `notebook` and `tell` handed in).
const testing = (env) => !!(env.NODE_TEST_CONTEXT || process.env.NODE_TEST_CONTEXT);

export function notebookFor(env) {
  if (env.GODSPEED_CLERK_NOTEBOOK) return new Notebook({ base: env.GODSPEED_CLERK_NOTEBOOK });
  return testing(env) ? null : new Notebook({ base: DEFAULT_NOTEBOOK });
}

function tellerFor({ settings, paths, env, log }) {
  if (testing(env) && !env.GODSPEED_CLERK_TELEGRAM_API) return async () => ({ delivered: false, results: { all: "no real messages from a test" } });
  return async (text) => (await import("../channels/index.mjs")).tell(text, { settings, paths, env, log });
}

// GODSPEED_CLERK_CRASH_AT=<after-copy|mid-upload|after-sort|after-file> kills the process at that
// point, the way a power cut would: no handler runs, nothing is tidied. The full test uses it to
// prove every step is picked up where it stopped (F18). Without the variable it does nothing.
export function envCrash(env = process.env) {
  const at = env.GODSPEED_CLERK_CRASH_AT;
  return (point) => { if (at && at === point) process.kill(process.pid, "SIGKILL"); };
}

export function buildContext(paths, { env = process.env, ask, today, crash, clock, steps, chunkSize, notebook, tell } = {}) {
  const settings = loadSettings(paths);
  const conn = readJson(paths.paperless, null);
  const driveConn = readDriveConnection(paths);
  const crashAt = crash || envCrash(env);
  let asker = ask;
  const log = makeLog(paths);
  return {
    paths, settings, env,
    plan: readJson(paths.plan, null),
    driveConn,
    paperless: conn?.url && conn?.token ? new Paperless({ url: conn.url, token: conn.token }) : null,
    drive: () => new Drive({ creds: driveConn, env, crash: crashAt, chunkSize }),
    get ask() {
      if (!asker) asker = makeAsker({ settings, workspace: settings.workspace || findMissionControl({ env }), env });
      return asker;
    },
    records: new Records(paths),
    log,
    notebook: notebook !== undefined ? notebook : notebookFor(env),
    tell: tell || tellerFor({ settings, paths, env, log }),
    outbox: makeOutbox(paths),
    crash: crashAt,
    today: today || new Date(),
    clock: clock || Date.now,
    steps: steps || ["copy", "sort", "file"],
  };
}
