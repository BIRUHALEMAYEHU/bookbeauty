import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/env";

const STATE_TTL_MS = 10 * 60 * 1000;

/** Signed, time-limited OAuth state so we reject forged callbacks. */
export function createOAuthState(nonce: string) {
  const issuedAt = Date.now().toString();
  const payload = `${nonce}.${issuedAt}`;
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function verifyOAuthState(state: string) {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [nonce, issuedAt, signature] = parts;
  if (!nonce || !issuedAt || !signature) return false;

  const payload = `${nonce}.${issuedAt}`;
  const expected = sign(payload);
  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  } catch {
    return false;
  }

  const age = Date.now() - Number(issuedAt);
  return Number.isFinite(age) && age >= 0 && age <= STATE_TTL_MS;
}

function sign(payload: string) {
  return createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
}
