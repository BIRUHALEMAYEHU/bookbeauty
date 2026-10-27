const ETHIOPIA_COUNTRY_CODE = "251";

/**
 * Normalises a phone number to E.164 ("+251911234567"), or returns null if it
 * is not a valid number. Phone numbers are the key for matching returning
 * guests (D92), so "0911 23 45 67" and "+251911234567" must become the same value.
 *
 * Ethiopian mobile numbers are 9 digits after the country code and start with
 * 9 (Ethio Telecom) or 7 (Safaricom). Numbers starting with "+" from other
 * countries are accepted if they look like valid E.164.
 */
export function normalisePhone(input: string): string | null {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[\s\-().]/g, "").replace(/^\+/, "");

  if (!/^\d+$/.test(digits)) return null;

  let national: string | null = null;
  if (digits.startsWith(ETHIOPIA_COUNTRY_CODE) && digits.length === 12) {
    national = digits.slice(3);
  } else if (!hasPlus && digits.startsWith("0") && digits.length === 10) {
    national = digits.slice(1);
  } else if (!hasPlus && digits.length === 9) {
    national = digits;
  }

  if (national !== null) {
    return /^[79]\d{8}$/.test(national) ? `+${ETHIOPIA_COUNTRY_CODE}${national}` : null;
  }

  if (hasPlus && /^[1-9]\d{7,14}$/.test(digits)) {
    return `+${digits}`;
  }

  return null;
}
