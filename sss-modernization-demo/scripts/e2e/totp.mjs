// STORY-003: the code an authenticator app shows, computed the way RFC 6238 says (HMAC-SHA1 over the 30-second step, 6
// digits) on node:crypto alone, so the checks do not depend on the library the server uses to verify it.
import { createHmac } from 'node:crypto';

export const STEP_SECONDS = 30;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** The bytes of an RFC 4648 base32 key, which is how an authenticator app is given one. */
export function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of text.replace(/[\s=]/g, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error(`"${char}" is not a base32 character`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The 6-digit code the app shows for the step that contains `atMs`. */
export function totpAt(secret, atMs = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / STEP_SECONDS)));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[19] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

/** The code `steps` steps from now: 0 is on the screen, 1 is the next one, -1 the last. */
export const totpSteps = (secret, steps = 0) => totpAt(secret, Date.now() + steps * STEP_SECONDS * 1000);
