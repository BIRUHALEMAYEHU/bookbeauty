import { createHash, randomBytes } from "node:crypto";

/** A random token for a link or cookie. 32 bytes, hex encoded. */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** Tokens are stored only as this hash, so a database leak exposes no usable links. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
