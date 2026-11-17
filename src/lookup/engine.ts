import type { AppConfig, LookupQuery, LookupResponse, SourceConfig, SourceResult } from "../shared/schema.js";
import { buildVars, runHttp } from "./http.js";
import { normalizePhone } from "./phone.js";
import { SEARCHCH_ATTRIBUTION, SearchchError, buildSearchchUrl, decodeXml, parseSearchchFeed } from "./searchch.js";

/* ---------- Cache im Browser (localStorage) ---------- */

const CACHE_PREFIX = "callerinfo:cache:";

function cacheKey(src: SourceConfig, q: LookupQuery): string {
  // Quellen-Konfiguration fliesst ein → Änderungen der Konfiguration invalidieren den Cache
  return `${CACHE_PREFIX}${src.id}:${hash(JSON.stringify({ ...src, name: "" }))}:${q.phoneE164 ?? q.phoneRaw ?? ""}|${q.email ?? ""}`;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function cacheGet(src: SourceConfig, q: LookupQuery): SourceResult | undefined {
  if (src.cacheMinutes <= 0) return undefined;
  try {
    const raw = localStorage.getItem(cacheKey(src, q));
    if (!raw) return undefined;
    const { expires, result } = JSON.parse(raw) as { expires: number; result: SourceResult };
    if (expires < Date.now()) {
      localStorage.removeItem(cacheKey(src, q));
      return undefined;
    }
    return result;
  } catch {
    return undefined;
  }
}

function cacheSet(src: SourceConfig, q: LookupQuery, result: SourceResult) {
  if (src.cacheMinutes <= 0 || result.status === "error") return;
  try {
    localStorage.setItem(cacheKey(src, q), JSON.stringify({ expires: Date.now() + src.cacheMinutes * 60_000, result }));
  } catch {
    pruneCache(true);
  }
}

/** Abgelaufene Einträge entfernen (bei vollem Speicher alle). */
export function pruneCache(all = false) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k?.startsWith(CACHE_PREFIX)) continue;
      if (all) {
        localStorage.removeItem(k);
        continue;
      }
      const { expires } = JSON.parse(localStorage.getItem(k) ?? "{}") as { expires?: number };
      if (!expires || expires < Date.now()) localStorage.removeItem(k);
    }
  } catch {
    /* localStorage nicht verfügbar */
  }
}

/* ---------- Ausführung ---------- */

function describeError(err: unknown, src: SourceConfig): string {
  const e = err as Error;
  if (e.name === "TimeoutError" || e.name === "AbortError") return `Zeitüberschreitung nach ${src.timeoutMs} ms`;
  // fetch() meldet CORS-, DNS- und Verbindungsfehler alle als TypeError ohne Details
  if (e instanceof TypeError) return "Nicht erreichbar (Netzwerk oder CORS – der Endpunkt muss Anfragen aus dem Browser erlauben)";
  return e.message || "Unbekannter Fehler";
}

async function runSource(src: SourceConfig, query: LookupQuery, user?: { upn?: string; name?: string }): Promise<SourceResult> {
  const base = { sourceId: src.id, sourceName: src.name, matches: [] };
  const attribution = src.kind === "searchch" ? SEARCHCH_ATTRIBUTION : undefined;

  const hit = cacheGet(src, query);
  if (hit) return { ...hit, cached: true, durationMs: 0 };

  const started = performance.now();
  let result: SourceResult;
  try {
    if (src.kind === "searchch") {
      const req = buildSearchchUrl(src, query);
      // Keine CH/LI-Nummer (oder nur E-Mail) → keine Anfrage, kein Kontingentverbrauch
      if (!req) return { ...base, status: "notFound", durationMs: 0, attribution };
      const res = await fetch(req.url, { credentials: "omit", signal: AbortSignal.timeout(src.timeoutMs) });
      const xml = decodeXml(await res.arrayBuffer(), res.headers.get("content-type") ?? "");
      let matches;
      try {
        matches = parseSearchchFeed(xml);
      } catch (err) {
        if (err instanceof SearchchError && !res.ok && !/search\.ch: /.test(err.message)) throw new Error(`search.ch: HTTP ${res.status}`);
        throw err;
      }
      if (!res.ok) throw Object.assign(new Error(`search.ch: HTTP ${res.status}`), { httpStatus: res.status });
      matches = matches.slice(0, src.maxMatches);
      result = { ...base, matches, status: matches.length ? "ok" : "notFound", httpStatus: res.status, durationMs: 0 };
    } else {
      const out = await runHttp(src, query, buildVars(query, user));
      result = { ...base, ...out, durationMs: 0 };
    }
  } catch (err) {
    result = { ...base, status: "error", error: describeError(err, src), httpStatus: (err as { httpStatus?: number }).httpStatus, durationMs: 0 };
  }
  result.durationMs = Math.round(performance.now() - started);
  result.attribution = attribution;
  cacheSet(src, query, result);
  return result;
}

/**
 * Fragt alle aktiven Quellen ab:
 * 1. normale Quellen parallel, 2. Fallback-Quellen nur, wenn keine normale Quelle getroffen hat.
 */
export async function lookup(
  config: AppConfig,
  input: { phone?: string; email?: string },
  user?: { upn?: string; name?: string },
): Promise<LookupResponse> {
  const query: LookupQuery = {
    ...normalizePhone(input.phone?.slice(0, 64), config.settings.defaultCountryCode),
    email: input.email?.includes("@") ? input.email.trim().slice(0, 254) : undefined,
  };
  const sources = config.sources.filter((s) => s.enabled);
  if (!query.phoneRaw && !query.email) return { query, results: [], configured: sources.length };

  const primary = sources.filter((s) => !s.fallbackOnly);
  const fallback = sources.filter((s) => s.fallbackOnly);
  const primaryResults = await Promise.all(primary.map((s) => runSource(s, query, user)));
  const anyHit = primaryResults.some((r) => r.status === "ok");
  const fallbackResults = anyHit
    ? fallback.map((s): SourceResult => ({ sourceId: s.id, sourceName: s.name, status: "notFound", matches: [], durationMs: 0, skipped: true }))
    : await Promise.all(fallback.map((s) => runSource(s, query, user)));

  const byId = new Map([...primaryResults, ...fallbackResults].map((r) => [r.sourceId, r]));
  const results = sources.map((s) => byId.get(s.id)!);
  if (!config.settings.showErrors) for (const r of results) if (r.status === "error") r.error = "Quelle nicht erreichbar";
  return { query, results, configured: sources.length };
}
