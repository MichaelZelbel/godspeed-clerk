// The second factor's codes (F1, section 5): RFC 6238 with SHA-1, 30 seconds, 6 digits, the way
// authenticator apps and Paperless (django-allauth) count them.
import test from "node:test";
import assert from "node:assert/strict";
import { base32Decode, base32Encode, totp, newSecret, otpauthUrl } from "../lib/install/totp.mjs";

const RFC = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"

test("base32 round trip, and the RFC 6238 secret", () => {
  assert.equal(base32Decode(RFC).toString("ascii"), "12345678901234567890");
  assert.equal(base32Encode(Buffer.from("12345678901234567890")), RFC);
  assert.equal(base32Decode("gezd gnbv-gy3t qojq gezd gnbv gy3t qojq").toString("ascii"), "12345678901234567890", "spaces, dashes and small letters as people type them");
});

test("codes match RFC 6238 (SHA-1), cut to 6 digits", () => {
  const at = (s) => totp(RFC, { time: s * 1000 });
  assert.equal(at(59), "287082");
  assert.equal(at(1111111109), "081804");
  assert.equal(at(1234567890), "005924");
  assert.equal(at(2000000000), "279037");
});

test("a new secret is 32 base32 letters (160 bits), different each time", () => {
  const a = newSecret(), b = newSecret();
  assert.match(a, /^[A-Z2-7]{32}$/);
  assert.notEqual(a, b);
  assert.equal(base32Decode(a).length, 20);
});

test("the link an authenticator app reads", () => {
  const u = otpauthUrl({ secret: RFC, account: "alex", issuer: "Paperless (srv1.example.test)" });
  assert.equal(u, "otpauth://totp/Paperless%20(srv1.example.test):alex?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Paperless%20(srv1.example.test)&algorithm=SHA1&digits=6&period=30");
});
