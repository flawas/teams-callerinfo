import { FIELD_TYPES } from "../shared/constants.js";
import { getPath, guessType, humanize } from "../shared/path.js";
import type { DisplayField, LookupQuery, Match, SourceConfig } from "../shared/schema.js";

/*
 * Beliebige JSON-Endpunkte (CRM, ERP, eigene API), direkt aus dem Browser abgefragt.
 * Voraussetzung: Der Endpunkt erlaubt CORS für die Herkunft der App.
 */

export type Vars = Record<string, string>;

const MAX_BODY_CHARS = 2 * 1024 * 1024;

export function buildVars(q: LookupQuery, user?: { upn?: string; name?: string }): Vars {
  return {
    phone: q.phoneE164 ?? q.phoneRaw ?? "",
    phoneE164: q.phoneE164 ?? "",
    phoneDigits: q.phoneDigits ?? "",
    phoneNational: q.phoneNational ?? "",
    phoneRaw: q.phoneRaw ?? "",
    email: q.email ?? "",
    userUpn: user?.upn ?? "",
    userName: user?.name ?? "",
  };
}

/** Ersetzt {name}-Platzhalter. Unbekannte Platzhalter bleiben unverändert. */
export function renderTemplate(tpl: string, vars: Vars, encode: (s: string) => string = (s) => s): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? encode(vars[k] ?? "") : m));
}

const jsonEscape = (s: string) => JSON.stringify(s).slice(1, -1);
const headerSafe = (s: string) => s.replace(/[\r\n]/g, "");

function toDisplay(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(toDisplay).filter(Boolean).join(", ");
  const s = JSON.stringify(v);
  return s.length > 200 ? s.slice(0, 197) + "…" : s;
}

export function safeHttpUrl(u: string): string | undefined {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const TITLE_KEYS = ["displayName", "name", "fullName", "fullname", "title", "company", "companyName", "firma", "Name"];

/* ---------- Mapping ---------- */

function mapRecord(record: unknown, src: SourceConfig, vars: Vars): Match {
  const m = src.mapping;
  let title = m.titlePath ? toDisplay(getPath(record, m.titlePath)) : "";
  let titleKey = m.titlePath;
  if (!title && record && typeof record === "object") {
    const key = TITLE_KEYS.find((k) => toDisplay((record as Record<string, unknown>)[k]));
    if (key) {
      title = toDisplay((record as Record<string, unknown>)[key]);
      titleKey = key;
    }
  }
  const subtitle = m.subtitlePath ? toDisplay(getPath(record, m.subtitlePath)) : "";

  let fields: DisplayField[];
  if (m.fields.length) {
    fields = m.fields.map((f) => ({ label: f.label, value: toDisplay(getPath(record, f.path)), type: f.type })).filter((f) => f.value);
  } else if (record && typeof record === "object" && !Array.isArray(record)) {
    // Ohne Mapping: einfache Felder automatisch anzeigen
    fields = Object.entries(record as Record<string, unknown>)
      .filter(([k, v]) => k !== titleKey && k !== m.subtitlePath && v != null && typeof v !== "object")
      .map(([k, v]) => {
        const value = toDisplay(v);
        return { label: humanize(k), value, type: typeof v === "string" ? guessType(value) : ("text" as const) };
      })
      .filter((f) => f.value)
      .slice(0, 12);
  } else {
    fields = [{ label: "Wert", value: toDisplay(record), type: "text" }];
  }
  fields = fields.map((f) => (f.type === "link" && !safeHttpUrl(f.value) ? { ...f, type: "text" } : f));

  let url: string | undefined;
  if (m.linkTemplate) {
    const filled = m.linkTemplate.replace(/\{\{([\w.[\]]+)\}\}/g, (_, p: string) => encodeURIComponent(toDisplay(getPath(record, p))));
    url = safeHttpUrl(renderTemplate(filled, vars, encodeURIComponent));
  }
  return { title: title || "Treffer", subtitle: subtitle || undefined, fields, url, urlLabel: url ? m.linkLabel || "Öffnen" : undefined };
}

/** Standardformat: { matches: [ { title, subtitle?, url?, urlLabel?, fields?: [{label, value, type?}] } ] } oder direkt das Array */
function parseStandard(json: unknown): Match[] {
  const list = Array.isArray(json) ? json : (json as { matches?: unknown })?.matches;
  if (!Array.isArray(list)) throw new Error('Antwort entspricht nicht dem Standardformat { "matches": [ { "title": … } ] }');
  return list
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && "title" in m)
    .map((m) => {
      const url = typeof m.url === "string" ? safeHttpUrl(m.url) : undefined;
      const rawFields = Array.isArray(m.fields) ? m.fields : [];
      const fields: DisplayField[] = rawFields
        .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
        .map((f) => {
          const type = (FIELD_TYPES as readonly string[]).includes(String(f.type)) ? (f.type as DisplayField["type"]) : "text";
          const value = toDisplay(f.value);
          return { label: toDisplay(f.label), value, type: type === "link" && !safeHttpUrl(value) ? "text" : type };
        })
        .filter((f) => f.value);
      return {
        title: toDisplay(m.title),
        subtitle: m.subtitle != null ? toDisplay(m.subtitle) : undefined,
        url,
        urlLabel: url ? (typeof m.urlLabel === "string" && m.urlLabel) || "Öffnen" : undefined,
        fields,
      };
    });
}

function extractMatches(json: unknown, src: SourceConfig, vars: Vars): Match[] {
  if (src.responseFormat === "standard") return parseStandard(json).slice(0, src.maxMatches);
  const node = getPath(json, src.mapping.resultPath);
  if (node == null || node === "") return [];
  const records = Array.isArray(node) ? node : [node];
  return records
    .filter((r) => r != null && !(typeof r === "object" && !Array.isArray(r) && Object.keys(r).length === 0))
    .slice(0, src.maxMatches)
    .map((r) => mapRecord(r, src, vars));
}

/* ---------- Ausführung ---------- */

export interface HttpOutcome {
  status: "ok" | "notFound";
  matches: Match[];
  httpStatus: number;
}

export async function runHttp(src: SourceConfig, query: LookupQuery, vars: Vars): Promise<HttpOutcome> {
  const url = renderTemplate(src.url, vars, encodeURIComponent);
  const headers = new Headers({ Accept: "application/json" });
  for (const h of src.headers) headers.set(h.name, headerSafe(renderTemplate(h.value, vars)));

  const a = src.auth;
  if (a.type === "apiKey") headers.set(a.headerName, headerSafe(a.value));
  if (a.type === "bearer") headers.set("Authorization", `Bearer ${headerSafe(a.token)}`);
  if (a.type === "basic") headers.set("Authorization", "Basic " + btoa(unescape(encodeURIComponent(`${a.username}:${a.password}`))));

  let body: string | undefined;
  if (src.method === "POST") {
    body = renderTemplate(src.body || '{ "phone": "{phoneE164}", "email": "{email}" }', vars, jsonEscape);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, {
    method: src.method,
    headers,
    body,
    redirect: "follow",
    credentials: "omit",
    signal: AbortSignal.timeout(src.timeoutMs),
  });
  const text = res.status === 204 ? "" : await res.text();
  if (text.length > MAX_BODY_CHARS) throw new Error("Antwort zu gross");

  if (res.status === 404 || res.status === 204 || (res.ok && !text.trim())) return { status: "notFound", matches: [], httpStatus: res.status };
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} ${res.statusText}`.trim()), { httpStatus: res.status });

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Antwort ist kein JSON (Content-Type: ${res.headers.get("content-type") || "unbekannt"})`);
  }
  const matches = extractMatches(json, src, vars);
  return { status: matches.length ? "ok" : "notFound", matches, httpStatus: res.status };
}
