// The Godspeed notebook, as the Clerk writes to it: the same record requests the notebook's own
// screens make (POST /api/query), on the door that answers only on this machine (127.0.0.1:47831),
// like the Wingman's. The address comes from the environment (GODSPEED_CLERK_NOTEBOOK), never from
// the settings file. When the notebook does not answer, notes and items wait; nothing else does.
export const DEFAULT_NOTEBOOK = "http://127.0.0.1:47831";

export class Notebook {
  constructor({ base = DEFAULT_NOTEBOOK, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
    this.base = String(base).replace(/\/+$/, "");
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }
}
