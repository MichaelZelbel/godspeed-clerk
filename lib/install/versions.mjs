// The Paperless versions the Clerk was tested with (the full test with the kit, and the fresh
// machines of test/machine). The Clerk installs and updates only to these (F3), each pinned to the
// image's own digest, so "3.3.3" is always the same program. A new Paperless release reaches people
// only with a Clerk release that lists it here, after both tests ran on it.
//
// A restore copy may come from a version no longer listed (an earlier Clerk installed it):
// Paperless imports an export only into the version that wrote it (F9), so a rebuild installs that
// version by its tag first and updates to the newest tested one right after.

export const REPO = "ghcr.io/paperless-ngx/paperless-ngx";

export const TESTED = Object.freeze([
  { version: "3.3.3", image: `${REPO}:3.3.3@sha256:dba0242c1df1843643df4eb50ce5639f3a7900f414879088fd5bed8eaf2d456d` },
]);

// Versions the tests install on purpose to update from (F3's forced failed update needs an update
// that changes the database: 3.2.1 to 3.3.3 adds three migrations). Never offered to anyone.
export const EARLIER = Object.freeze([
  { version: "3.2.1", image: `${REPO}:3.2.1@sha256:5fa76604a81df6945086e0837b14b56543d137e8ce4f311cc5d9ebe907e74e79` },
]);

export const POSTGRES = "docker.io/library/postgres:18";
export const VALKEY = "docker.io/valkey/valkey:9-alpine";

const clean = (v) => String(v || "").trim().replace(/^v/i, "");

export function compareVersions(a, b) {
  const x = clean(a).split(".").map(Number), y = clean(b).split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export const newest = () => [...TESTED].sort((a, b) => compareVersions(b.version, a.version))[0];
export const isTested = (v) => TESTED.some((t) => t.version === clean(v));

export function imageFor(version) {
  const v = clean(version);
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`"${version}" is not a Paperless version`);
  return [...TESTED, ...EARLIER].find((t) => t.version === v)?.image || `${REPO}:${v}`;
}

// The version an image line names: "...:3.3.3@sha256:..." -> "3.3.3".
export const versionOfImage = (image) => (String(image).match(/:(\d+\.\d+\.\d+)(?:@|$)/) || [])[1] || null;
