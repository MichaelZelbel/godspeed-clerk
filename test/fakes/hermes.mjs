#!/usr/bin/env node
// A stand-in for the `hermes` command, for the tests: it records what it was asked (and under which
// HERMES_HOME) in GODSPEED_CLERK_FAKE_HERMES_LOG, and says yes. No test ever runs a real Hermes.
import fs from "node:fs";
if (process.env.GODSPEED_CLERK_FAKE_HERMES_LOG) fs.appendFileSync(process.env.GODSPEED_CLERK_FAKE_HERMES_LOG, `${JSON.stringify({ args: process.argv.slice(2), home: process.env.HERMES_HOME || null })}\n`);
process.exit(Number(process.env.GODSPEED_CLERK_FAKE_HERMES_EXIT || 0));
