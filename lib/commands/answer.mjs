// answer and place: what the person's assistant runs when they answer the Clerk in the chat (F19).
//   answer "<their words>" [--about <paper>]       "1", "the second one", "yes", "the Travel folder"
//   place --sender "<name>" --into "<folder>"        "Deutsche Bahn papers go into the Deutsche Bahn folder"
//   place --kind "<kind>" --into "<folder>"          "hotel bookings go into Travel"
//   place --paper "<words>" --into "<folder>"        "the hotel booking goes into Travel"
// Each takes the run lock, so it never files a paper while a run does. When a run holds it longer
// than LOCK_WAIT, the answer is saved and the next run applies it; the person hears again only
// when the answer needs them (a folder to choose, a yes).
import { acquireWithin } from "../core/lock.mjs";
import { buildContext } from "../core/context.mjs";
import { answerWith, placeWith, queueAnswer } from "../core/answers.mjs";

const LOCK_WAIT = 45000;

async function withLock(ctx, type, args, act) {
  const ms = Number(ctx.env.GODSPEED_CLERK_LOCK_WAIT_MS) || LOCK_WAIT;
  if (!ctx.settings.active) {
    queueAnswer(ctx.paths, { type, args });
    ctx.print("The Clerk is paused, so nothing was filed. The answer is saved and applied when it is resumed (godspeed-clerk resume).");
    return 0;
  }
  const lock = await acquireWithin(ctx.paths, ms);
  if (!lock) {
    queueAnswer(ctx.paths, { type, args });
    ctx.print("Saved: the Clerk is in the middle of a run and applies this answer within a few minutes. If it needs the person again, it asks them in the chat.");
    return 0;
  }
  try {
    const r = await act(buildContext(ctx.paths, { env: ctx.env }));
    ctx.print(r.text);
    return 0;
  } catch (e) {
    if (e.name === "DriveAccessLost") { ctx.fail("Google Drive no longer accepts the Clerk's connection, so nothing was filed; connect it again: godspeed-clerk drive connect"); return 1; }
    ctx.fail(`Nothing was filed: ${e.message}`);
    return 1;
  } finally { lock.release(); }
}

export const commands = [
  {
    meta: { name: "answer", summary: "Answer the Clerk's question about a paper: a number, yes or no, or a folder in words.", usage: "answer \"<their words>\" [--about <paper>]", flags: { value: ["about"] } },
    run(ctx) {
      const words = ctx.rest.join(" ").trim();
      if (!words) { ctx.fail("Give the person's answer, for example: godspeed-clerk answer \"1\" --about 12"); return 1; }
      const args = { words, ...(ctx.flags.about ? { about: Number(ctx.flags.about) } : {}) };
      return withLock(ctx, "answer", args, (c) => answerWith(c, args));
    },
  },
  {
    meta: { name: "place", summary: "Say where a sender's papers, a kind of paper or one paper go.", usage: "place --sender|--kind|--paper \"<...>\" --into \"<folder>\" [--make]", flags: { value: ["sender", "kind", "paper", "about", "into"], bool: ["make"] } },
    run(ctx) {
      const f = ctx.flags;
      if (!f.into) { ctx.fail("Say the folder: --into \"<its name or path>\""); return 1; }
      const args = { into: f.into, make: !!f.make, ...(f.sender ? { sender: f.sender } : {}), ...(f.kind ? { kind: f.kind } : {}), ...(f.paper ? { paper: f.paper } : {}), ...(f.about ? { about: Number(f.about) } : {}) };
      return withLock(ctx, "place", args, (c) => placeWith(c, args));
    },
  },
];
