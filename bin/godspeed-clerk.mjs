#!/usr/bin/env node
// godspeed-clerk: the Clerk, an add-on for Godspeed Mission Control. It sorts the documents in the
// person's Paperless-ngx and files each one, named and sorted, into the right folder of their own
// cloud drive.
//
// Every command lives in lib/commands/ (one file each, found by the registry there); this file
// only starts it. `godspeed-clerk help` lists them.
import { main } from "../lib/commands/index.mjs";

let code = 1;
try {
  code = await main(process.argv.slice(2));
} catch (e) {
  console.error(`godspeed-clerk: ${e?.message || e}`);
  code = 1;
}
// The worker ends only when it is stopped; every other command ends here, even when a network
// connection would keep Node waiting a few more seconds.
process.exit(code);
