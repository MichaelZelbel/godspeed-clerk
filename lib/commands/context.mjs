// context: what the person's assistant sees before each turn (the Hermes plugin runs it). It never
// fails loudly: a broken Clerk must never break the assistant. questions: every open question.
import { contextBlock, questionsList } from "../core/assistant.mjs";

export const commands = [
  {
    meta: { name: "context", summary: "What the assistant sees before each turn: the questions asked in the chat.", usage: "context" },
    async run(ctx) {
      try {
        const out = await contextBlock(ctx.paths, ctx.settings);
        if (out) ctx.print(out);
      } catch { /* the assistant must never break on this */ }
      return 0;
    },
  },
  {
    meta: { name: "questions", summary: "Every open question about a paper, asked in the chat or not yet.", usage: "questions" },
    async run(ctx) { ctx.print(await questionsList(ctx.paths, ctx.settings)); return 0; },
  },
];
