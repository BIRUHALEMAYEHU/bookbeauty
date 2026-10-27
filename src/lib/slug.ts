/**
 * Words that cannot be a handle or business slug (D18). Kept in code until the
 * `reserved_names` table lands with Layer 1 address tooling.
 */
export const RESERVED_NAMES = new Set([
  "admin",
  "api",
  "account",
  "accounts",
  "book",
  "booking",
  "dashboard",
  "help",
  "login",
  "logout",
  "me",
  "platform",
  "settings",
  "signup",
  "support",
  "www",
]);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Normalises a handle or slug: trim, lowercase, strip a leading @, collapse
 * spaces/underscores to hyphens. Returns null when the result is not usable.
 */
export function normaliseSlug(input: string): string | null {
  const raw = input.trim().replace(/^@+/, "").toLowerCase();
  const collapsed = raw
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (collapsed.length < 2 || collapsed.length > 40) return null;
  if (!SLUG_PATTERN.test(collapsed)) return null;
  if (RESERVED_NAMES.has(collapsed)) return null;
  if (/^\d+$/.test(collapsed)) return null;

  return collapsed;
}

export function isReservedName(value: string): boolean {
  return RESERVED_NAMES.has(value.trim().toLowerCase());
}
