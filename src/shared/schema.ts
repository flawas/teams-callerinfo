import { z } from "zod";
import { FIELD_TYPES } from "./constants.js";

export { FIELD_TYPES, SEARCHCH_ATTRIBUTION, type FieldType } from "./constants.js";

/*
 * Konfiguration der Datenquellen. Wird beim Build aus .env und sources.json erzeugt,
 * validiert und als config.json mit der App ausgeliefert. Alle Abfragen laufen im Teams-Client.
 */

export const headerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Header-Name fehlt")
    .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, "Ungültiger Header-Name"),
  value: z.string(),
});

export const authSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("apiKey"), headerName: z.string().trim().min(1), value: z.string() }),
  z.object({ type: z.literal("bearer"), token: z.string() }),
  z.object({ type: z.literal("basic"), username: z.string(), password: z.string() }),
]);

export const fieldMapSchema = z.object({
  label: z.string().trim().min(1, "Feld-Bezeichnung fehlt"),
  path: z.string().trim().min(1, "Feld-Pfad fehlt"),
  type: z.enum(FIELD_TYPES).default("text"),
});

export const mappingSchema = z.object({
  /** Pfad zum Datensatz bzw. zur Trefferliste in der Antwort, leer = Wurzel. */
  resultPath: z.string().trim().default(""),
  titlePath: z.string().trim().default(""),
  subtitlePath: z.string().trim().default(""),
  fields: z.array(fieldMapSchema).max(30).default([]),
  /** z.B. https://crm.example.ch/kontakte/{{id}} */
  linkTemplate: z.string().trim().default(""),
  linkLabel: z.string().trim().default("Öffnen"),
});

export const searchchSchema = z.object({
  /** Optional; ohne Key liefert search.ch nur Name, Adresstext und Link. */
  apiKey: z.string().default(""),
  privat: z.boolean().default(true),
  firma: z.boolean().default(true),
  lang: z.enum(["de", "fr", "it", "en"]).default("de"),
});

export const sourceSchema = z.object({
  id: z.string().min(1),
  /** http = beliebiger JSON-Endpunkt, searchch = tel.search.ch (Telefonbuch) */
  kind: z.enum(["http", "searchch"]).default("http"),
  name: z.string().trim().min(1, "Name fehlt").max(80),
  enabled: z.boolean().default(true),
  /** Nur abfragen, wenn keine andere (nicht-Fallback-)Quelle einen Treffer hat. */
  fallbackOnly: z.boolean().default(false),
  /** Ergebnisse pro Nummer im Browser zwischenspeichern (0 = aus). */
  cacheMinutes: z.number().int().min(0).max(43200).default(0),
  searchch: searchchSchema.default({ apiKey: "", privat: true, firma: true, lang: "de" }),
  method: z.enum(["GET", "POST"]).default("GET"),
  /** URL-Vorlage, z.B. https://crm.example.ch/api/lookup?phone={phoneE164} */
  url: z.string().trim().default(""),
  headers: z.array(headerSchema).max(20).default([]),
  /** Body-Vorlage (nur POST), typischerweise JSON. */
  body: z.string().default(""),
  auth: authSchema.default({ type: "none" }),
  timeoutMs: z.number().int().min(500).max(30000).default(5000),
  /** standard = Endpunkt liefert das App-Format, mapped = beliebiges JSON + Feld-Mapping */
  responseFormat: z.enum(["standard", "mapped"]).default("mapped"),
  mapping: mappingSchema.default({ resultPath: "", titlePath: "", subtitlePath: "", fields: [], linkTemplate: "", linkLabel: "Öffnen" }),
  maxMatches: z.number().int().min(1).max(20).default(5),
});

export const settingsSchema = z.object({
  /** Ländervorwahl für nationale Nummern (ohne +), z.B. 41 */
  defaultCountryCode: z.string().regex(/^\d{1,3}$/, "Ländervorwahl: 1–3 Ziffern").default("41"),
  /** Technische Fehlermeldungen der Quellen im Panel anzeigen */
  showErrors: z.boolean().default(true),
});

export const appConfigSchema = z.object({
  settings: settingsSchema.default({ defaultCountryCode: "41", showErrors: true }),
  sources: z.array(sourceSchema).default([]),
});

export type HeaderConfig = z.infer<typeof headerSchema>;
export type AuthConfig = z.infer<typeof authSchema>;
export type FieldMap = z.infer<typeof fieldMapSchema>;
export type Mapping = z.infer<typeof mappingSchema>;
export type SearchchConfig = z.infer<typeof searchchSchema>;
export type SourceConfig = z.infer<typeof sourceSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;

/* ---------- Ergebnisse ---------- */

export interface DisplayField {
  label: string;
  value: string;
  type: (typeof FIELD_TYPES)[number];
}

export interface Match {
  title: string;
  subtitle?: string;
  fields: DisplayField[];
  url?: string;
  urlLabel?: string;
}

export interface SourceResult {
  sourceId: string;
  sourceName: string;
  status: "ok" | "notFound" | "error";
  matches: Match[];
  error?: string;
  httpStatus?: number;
  durationMs: number;
  /** Pflicht-Quellenangabe, die im Panel angezeigt wird */
  attribution?: string;
  cached?: boolean;
  /** Fallback-Quelle wurde nicht abgefragt, weil eine andere Quelle getroffen hat */
  skipped?: boolean;
}

export interface LookupQuery {
  phoneRaw?: string;
  phoneE164?: string;
  phoneNational?: string;
  phoneDigits?: string;
  email?: string;
}

export interface LookupResponse {
  query: LookupQuery;
  results: SourceResult[];
  configured: number;
}
