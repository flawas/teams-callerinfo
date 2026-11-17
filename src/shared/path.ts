import type { FieldType } from "./constants.js";

/** Liest einen Wert über einen Pfad wie "data.items[0].name" oder "data.items.0.name". */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Rät den Anzeigetyp anhand eines Beispielwerts. */
export function guessType(sample: string): FieldType {
  if (/^https?:\/\//.test(sample)) return "link";
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sample)) return "email";
  if (/^\+?\d[\d\s]{7,}$/.test(sample)) return "phone";
  if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(sample)) return "date";
  return "text";
}

export function humanize(key: string): string {
  const last = key.split(".").pop() ?? key;
  const s = last.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
