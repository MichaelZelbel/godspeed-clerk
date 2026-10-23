// F1: the Paperless the Clerk installs, as files: the pinned version, memory limits, the address
// only on this machine, text reading in the person's language and English, secrets apart.
import test from "node:test";
import assert from "node:assert/strict";
import { TESTED, newest, imageFor, isTested, compareVersions } from "../lib/install/versions.mjs";
import { composeText, envText, ocrFor, PROJECT, newSecrets } from "../lib/install/stack.mjs";
import { starterFor, starterTags, STARTERS } from "../lib/install/starter.mjs";

const base = { image: imageFor("3.3.3"), port: 8010, url: "https://srv1.example.test:48444", host: "srv1.example.test", ocr: ocrFor("German"), timezone: "Europe/Berlin", clerkVersion: "0.4.0", day: "2026-10-23" };

test("versions: only tested ones, pinned to an image digest, the newest first in line", () => {
  assert.ok(TESTED.length >= 1);
  for (const t of TESTED) assert.match(t.image, /^ghcr\.io\/paperless-ngx\/paperless-ngx:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
  assert.equal(newest().version, "3.3.3");
  assert.equal(isTested("3.3.3"), true);
  assert.equal(isTested("3.3.4"), false);
  assert.equal(imageFor("3.9.9"), "ghcr.io/paperless-ngx/paperless-ngx:3.9.9", "a version only a restore copy names: by its tag");
  assert.equal(compareVersions("3.2.1", "3.3.3"), -1);
  assert.equal(compareVersions("3.10.0", "3.9.9"), 1);
  assert.equal(compareVersions("v3.3.3", "3.3.3"), 0);
});

test("compose: the pinned image, memory limits, one worker, the port only on this machine", () => {
  const y = composeText(base);
  assert.match(y, new RegExp(`^name: ${PROJECT}$`, "m"));
  assert.match(y, /image: ghcr\.io\/paperless-ngx\/paperless-ngx:3\.3\.3@sha256:dba0242c1df1843643df4eb50ce5639f3a7900f414879088fd5bed8eaf2d456d/);
  assert.match(y, /mem_limit: 1600m/);
  assert.match(y, /mem_limit: 384m/);
  assert.match(y, /mem_limit: 128m/);
  assert.match(y, /- "127\.0\.0\.1:8010:8000"/);
  assert.match(y, /PAPERLESS_TASK_WORKERS: "1"/);
  assert.match(y, /PAPERLESS_URL: "https:\/\/srv1\.example\.test:48444"/);
  assert.match(y, /PAPERLESS_ALLOWED_HOSTS: "srv1\.example\.test,localhost,127\.0\.0\.1"/);
  assert.match(y, /PAPERLESS_ALLAUTH_TRUSTED_PROXY_COUNT: "1"/);
  assert.match(y, /PAPERLESS_OCR_LANGUAGE: "deu\+eng"/);
  assert.match(y, /PAPERLESS_AI_ENABLED: "false"/);
  assert.match(y, /- \.\/data\/pg:\/var\/lib\/postgresql/);
  assert.ok(!/\t/.test(y), "no tabs in YAML");
  assert.ok(!/SECRET_KEY=|DBPASS=|POSTGRES_PASSWORD:/.test(y), "no secret in the compose file");
  assert.ok(!/[–—]/.test(y));
});

test("compose: a name or a time zone that could break the file is refused", () => {
  assert.throws(() => composeText({ ...base, host: "evil\"\n  x: y" }), /name/);
  assert.throws(() => composeText({ ...base, timezone: "Europe/Berlin\"\n" }), /time zone/);
  assert.throws(() => composeText({ ...base, port: 99999 }), /port/);
});

test("the secrets file: a fresh key and database password each install", () => {
  const a = newSecrets(), b = newSecrets();
  assert.notEqual(a.secretKey, b.secretKey);
  const e = envText(a);
  assert.match(e, new RegExp(`^PAPERLESS_SECRET_KEY=${a.secretKey}$`, "m"));
  assert.match(e, new RegExp(`^PAPERLESS_DBPASS=${a.dbPass}$`, "m"));
  assert.match(e, new RegExp(`^POSTGRES_PASSWORD=${a.dbPass}$`, "m"));
  assert.ok(a.secretKey.length >= 50 && /^[A-Za-z0-9_-]+$/.test(a.secretKey));
});

test("text reading: the person's language and English; a language the image lacks is fetched at start", () => {
  assert.deepEqual(ocrFor("English"), { code: "eng", install: "" });
  assert.deepEqual(ocrFor("German"), { code: "deu+eng", install: "" });
  assert.deepEqual(ocrFor("Deutsch"), { code: "deu+eng", install: "" });
  assert.deepEqual(ocrFor("Dutch"), { code: "nld+eng", install: "nld" });
  assert.deepEqual(ocrFor("Klingon"), { code: "eng", install: "" }, "unknown: English");
  assert.match(composeText({ ...base, ocr: ocrFor("Dutch") }), /PAPERLESS_OCR_LANGUAGES: "nld"/);
});

test("starter set in the person's language: nine types, the inbox tag, the Clerk's own tags, three tax years", () => {
  const en = starterFor("English"), de = starterFor("German");
  assert.equal(en.types.length, 9);
  assert.equal(de.types.length, 9);
  assert.ok(de.types.includes("Rechnung") && de.types.includes("Bescheid"));
  assert.equal(de.to_sort, "Zu sortieren");
  assert.deepEqual(de.tags, { check: "Prüfen", tax_prefix: "Steuer", not_in_notebook: "Nicht ins Notizbuch", important: "Wichtig" });
  const tags = starterTags(de, 2026);
  assert.deepEqual(tags.filter((t) => t.is_inbox_tag).map((t) => t.name), ["Posteingang"]);
  for (const n of ["Steuer 2023", "Steuer 2024", "Steuer 2025", "Gesundheit", "Wichtig", "Prüfen", "Nicht ins Notizbuch"]) assert.ok(tags.some((t) => t.name === n), n);
  assert.equal(starterFor("Klingon").language, "English", "unknown: English");
  for (const [lang, s] of Object.entries(STARTERS)) {
    assert.equal(new Set(s.types).size, 9, lang);
    assert.ok(!/[–—]/.test(JSON.stringify(s)), lang);
  }
});
