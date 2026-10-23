// The Paperless the Clerk installs, as two files in its folder (/opt/godspeed-clerk/paperless):
// compose.yaml (the programs, their versions and memory limits) and paperless.env (its secrets,
// readable by root only). It is the stack Paperless publishes with Postgres, as installed by hand on
// 22 October 2026 (PRD section 12): one worker each and memory limits, so it never starves
// Godspeed; its web door on 127.0.0.1 only, published by the server's HTTPS address (https.mjs); its
// data in folders beside the files, so a copy of the database before an update is a folder copy
// while it is stopped (host.mjs); Paperless's own AI off, since Godspeed sorts.
import crypto from "node:crypto";
import { POSTGRES, VALKEY } from "./versions.mjs";

export const PROJECT = "godspeed-clerk-paperless";

// Tesseract's names. The Paperless image carries eng, deu, fra, ita and spa; any other is fetched
// when Paperless starts (PAPERLESS_OCR_LANGUAGES).
const CODES = { english: "eng", german: "deu", deutsch: "deu", french: "fra", "français": "fra", spanish: "spa", "español": "spa", italian: "ita", italiano: "ita", dutch: "nld", nederlands: "nld", portuguese: "por", "português": "por", polish: "pol", polski: "pol", danish: "dan", swedish: "swe", norwegian: "nor", finnish: "fin", czech: "ces", turkish: "tur" };
const BUILT_IN = new Set(["eng", "deu", "fra", "ita", "spa"]);

export function ocrFor(language) {
  const code = CODES[String(language || "").trim().toLowerCase()];
  if (!code || code === "eng") return { code: "eng", install: "" };
  return { code: `${code}+eng`, install: BUILT_IN.has(code) ? "" : code };
}

export function newSecrets() {
  return { secretKey: crypto.randomBytes(48).toString("base64url"), dbPass: crypto.randomBytes(24).toString("hex") };
}

export function envText({ secretKey, dbPass }, { day = new Date().toISOString().slice(0, 10) } = {}) {
  return [
    `# Paperless-ngx's secrets, made by The Clerk on ${day}. Readable by root only; nothing else needs them.`,
    `PAPERLESS_SECRET_KEY=${secretKey}`,
    `PAPERLESS_DBPASS=${dbPass}`,
    `POSTGRES_PASSWORD=${dbPass}`,
    "",
  ].join("\n");
}

const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const TZ = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;

export function composeText({ image, port, url, host, ocr, timezone, clerkVersion, day = new Date().toISOString().slice(0, 10) }) {
  if (!HOST.test(String(host))) throw new Error(`"${host}" is not a server name`);
  if (!TZ.test(String(timezone))) throw new Error(`"${timezone}" is not a time zone`);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`${port} is not a port the Clerk uses`);
  if (!/^[a-z0-9./:@_-]+$/i.test(image)) throw new Error(`"${image}" is not an image`);
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(url)) throw new Error(`"${url}" is not an https address`);
  const env = [
    ["PAPERLESS_REDIS", "redis://broker:6379"],
    ["PAPERLESS_DBHOST", "db"],
    ["PAPERLESS_DBENGINE", "postgresql"],
    ["PAPERLESS_URL", url],
    ["PAPERLESS_ALLOWED_HOSTS", `${host},localhost,127.0.0.1`],
    ["PAPERLESS_ALLAUTH_TRUSTED_PROXY_COUNT", "1"],
    ["PAPERLESS_OCR_LANGUAGE", ocr.code],
    ...(ocr.install ? [["PAPERLESS_OCR_LANGUAGES", ocr.install]] : []),
    ["PAPERLESS_TIME_ZONE", timezone],
    ["PAPERLESS_WEBSERVER_WORKERS", "1"],
    ["PAPERLESS_TASK_WORKERS", "1"],
    ["PAPERLESS_THREADS_PER_WORKER", "1"],
    ["PAPERLESS_FILENAME_FORMAT", "{{ created_year }}/{{ correspondent }}/{{ created }} {{ title }}"],
    ["PAPERLESS_FILENAME_FORMAT_REMOVE_NONE", "true"],
    ["PAPERLESS_AI_ENABLED", "false"],
  ];
  return [
    `# Paperless-ngx, installed by The Clerk (godspeed-clerk ${clerkVersion}) on ${day}.`,
    "# The Clerk keeps it running and updates it only to versions it was tested with, writing this",
    "# file again; change nothing here by hand. Its secrets are in paperless.env (root only), its",
    "# data in ./data, its nightly export in ./export.",
    `name: ${PROJECT}`,
    "services:",
    "  broker:",
    `    image: ${VALKEY}`,
    "    restart: unless-stopped",
    "    mem_limit: 128m",
    "    volumes:",
    "      - ./data/redis:/data",
    "  db:",
    `    image: ${POSTGRES}`,
    "    restart: unless-stopped",
    "    mem_limit: 384m",
    "    volumes:",
    "      - ./data/pg:/var/lib/postgresql",
    "    env_file: paperless.env",
    "    environment:",
    "      POSTGRES_DB: paperless",
    "      POSTGRES_USER: paperless",
    "  webserver:",
    `    image: ${image}`,
    "    restart: unless-stopped",
    "    mem_limit: 1600m",
    "    depends_on: [db, broker]",
    "    ports:",
    `      - "127.0.0.1:${port}:8000"`,
    "    volumes:",
    "      - ./data/paperless:/usr/src/paperless/data",
    "      - ./data/media:/usr/src/paperless/media",
    "      - ./export:/usr/src/paperless/export",
    "      - ./consume:/usr/src/paperless/consume",
    "    env_file: paperless.env",
    "    environment:",
    ...env.map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`),
    "",
  ].join("\n");
}
