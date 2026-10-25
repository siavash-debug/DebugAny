import { hash, verify } from "@node-rs/argon2";

const ARGON2_OPTS = {
  // OWASP-recommended Argon2id baseline: m=19456 KiB, t=2, p=1.
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}
