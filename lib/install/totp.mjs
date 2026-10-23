// The second factor (section 5): time-based one-time codes, RFC 6238 with SHA-1, 30 seconds and
// six digits, the kind every authenticator app makes and Paperless (django-allauth) checks. The
// installer turns the second factor on for the person's account itself: it makes the secret, works
// out the current code to prove it to Paperless, and hands the secret to the person for their
// authenticator app.
import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

// Spaces, dashes, padding and small letters are allowed, the way a person copies a key.
export function base32Decode(text) {
  const s = String(text).toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("that is not a setup key (base32)");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totp(secret, { time = Date.now(), step = 30, digits = 6 } = {}) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / step)));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));

// otpauth://totp/<issuer>:<account>?secret=...: what an authenticator app reads from a QR code or
// a link.
export function otpauthUrl({ secret, account, issuer }) {
  const e = encodeURIComponent;
  return `otpauth://totp/${e(issuer)}:${e(account)}?secret=${secret}&issuer=${e(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
