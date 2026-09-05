import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Passwords are stored as scrypt hashes with a per-user salt, in one
// string: scrypt$<N>$<salt hex>$<hash hex>. Verification is
// constant-time. The parameters are Node's defaults for scrypt at a
// cost that keeps a sign-in under a hundred milliseconds on a small box.
const COST = 2 ** 15;
// scrypt needs 128 * N * r bytes; Node's default cap is exactly that at
// this cost, so the cap is raised to leave room.
const MAX_MEMORY = 64 * 1024 * 1024;
const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: COST,
    maxmem: MAX_MEMORY,
  });
  return `scrypt$${COST}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, cost, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !cost || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const n = Number(cost);
  if (!Number.isInteger(n) || n < 2 || n > COST) return false;
  const actual = scryptSync(
    password,
    Buffer.from(saltHex, "hex"),
    expected.length,
    {
      N: n,
      maxmem: MAX_MEMORY,
    },
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function passwordProblem(
  password: string,
): "short" | "long" | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) return "short";
  if (password.length > MAX_PASSWORD_LENGTH) return "long";
  return undefined;
}

// A temporary password a maintainer hands over after a reset: readable
// aloud, no ambiguous characters, enough entropy to be the only thing
// standing between a name and its account for the minutes it lives.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function temporaryPassword(): string {
  const bytes = randomBytes(12);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}
