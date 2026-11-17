import type { LookupQuery } from "../shared/schema.js";

/**
 * Normalisiert eine Rufnummer, wie sie von Teams kommt (z.B. "+41791234567",
 * "tel:+41 79 123 45 67", "sip:+41791234567@domain;user=phone", "0791234567", "0041...").
 */
export function normalizePhone(input: string | undefined, countryCode: string): Partial<LookupQuery> {
  if (!input) return {};
  let s = input.trim();
  s = s.replace(/^(tel|sip|sips):/i, "");
  s = s.split(/[;@]/)[0] ?? "";
  s = s.replace(/[\s\-().\/]/g, "");

  let e164: string | undefined;
  if (/^\+\d{6,15}$/.test(s)) e164 = s;
  else if (/^00\d{6,15}$/.test(s)) e164 = "+" + s.slice(2);
  else if (/^0\d{6,14}$/.test(s)) e164 = "+" + countryCode + s.slice(1);
  else if (/^\d{10,15}$/.test(s)) e164 = "+" + s; // vermutlich E.164 ohne "+"

  if (!e164) return { phoneRaw: input.trim(), phoneDigits: s.replace(/\D/g, "") || undefined };

  const digits = e164.slice(1);
  const national = digits.startsWith(countryCode) ? "0" + digits.slice(countryCode.length) : "00" + digits;
  return { phoneRaw: input.trim(), phoneE164: e164, phoneDigits: digits, phoneNational: national };
}

/** Für Logs: Nummer bis auf die letzten zwei Ziffern maskieren. */
export function maskPhone(p?: string): string {
  if (!p) return "-";
  return p.length <= 4 ? "***" : p.slice(0, 3) + "*".repeat(Math.max(0, p.length - 5)) + p.slice(-2);
}
