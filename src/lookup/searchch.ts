import { SEARCHCH_ATTRIBUTION } from "../shared/constants.js";
import type { DisplayField, LookupQuery, Match, SourceConfig } from "../shared/schema.js";

/**
 * tel.search.ch-API (Atom-Feed), direkt aus dem Browser abgefragt (die API erlaubt CORS).
 * Doku: https://search.ch/tel/api/help · Bedingungen: https://search.ch/tel/api/terms
 * - max. 20 Resultate pro Abfrage, 1000 Abfragen/Monat pro Key
 * - Quellenangabe "Swisscom Directories AG" ist Pflicht
 */

export const SEARCHCH_URL = "https://search.ch/tel/api/";
export const MAX_RESULTS = 20;
export { SEARCHCH_ATTRIBUTION };

const NS_TEL = "http://tel.search.ch/api/spec/result/1.0/";
const NS_ATOM = "http://www.w3.org/2005/Atom";
/** Schweiz und Liechtenstein sind im Verzeichnis */
const SUPPORTED_PREFIXES = ["+41", "+423"];

export class SearchchError extends Error {}

/** Baut die Anfrage-URL – oder null, wenn die Nummer nicht im CH/LI-Verzeichnis sein kann. */
export function buildSearchchUrl(src: SourceConfig, q: LookupQuery): { url: string; displayUrl: string } | null {
  const phone = q.phoneE164;
  if (!phone || !SUPPORTED_PREFIXES.some((p) => phone.startsWith(p))) return null;
  const s = src.searchch;
  const base = src.url || SEARCHCH_URL;
  const params = new URLSearchParams({ was: phone, maxnum: String(Math.min(src.maxMatches, MAX_RESULTS)), lang: s.lang });
  if (!s.privat) params.set("privat", "0");
  if (!s.firma) params.set("firma", "0");
  const displayUrl = `${base}?${params}`;
  if (s.apiKey) params.set("key", s.apiKey);
  return { url: `${base}?${params}`, displayUrl: s.apiKey ? `${displayUrl}&key=***` : displayUrl };
}

/** Dekodiert die Antwort anhand von Content-Type bzw. XML-Deklaration (live UTF-8, ältere Beispiele ISO-8859-1). */
export function decodeXml(bytes: ArrayBuffer, contentType: string): string {
  const buf = new Uint8Array(bytes);
  let charset = /charset=([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const head = new TextDecoder("latin1").decode(buf.slice(0, 200));
    charset = /encoding=["']([\w-]+)["']/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

function tel(el: Element, name: string): string {
  return el.getElementsByTagNameNS(NS_TEL, name)[0]?.textContent?.trim() ?? "";
}
function telAll(el: Element, name: string): Element[] {
  return Array.from(el.getElementsByTagNameNS(NS_TEL, name));
}
function atom(el: Element, name: string): Element[] {
  return Array.from(el.getElementsByTagNameNS(NS_ATOM, name));
}

function safeUrl(u: string): string | undefined {
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Wandelt den Atom-Feed in Treffer um. Wirft SearchchError bei API-Fehlern. */
export function parseSearchchFeed(xml: string): Match[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new SearchchError("Antwort von search.ch ist kein gültiges XML");
  const feed = doc.documentElement;
  if (!feed || feed.localName !== "feed") throw new SearchchError("Antwort von search.ch enthält keinen Feed");

  const errorMessage = tel(feed, "errorMessage");
  const errorCode = tel(feed, "errorCode");
  if (errorMessage || errorCode) {
    throw new SearchchError(`search.ch: ${errorMessage || tel(feed, "errorReason") || "Fehler " + errorCode}`);
  }
  // Hinweis: Ein openSearch:Query role="correction" schlägt eine ANDERE Nummer vor → bewusst ignoriert.
  return atom(feed, "entry").map(mapEntry);
}

function mapEntry(e: Element): Match {
  const detail = atom(e, "link").find((l) => l.getAttribute("rel") === "alternate" && l.getAttribute("type") === "text/html");
  const url = detail ? safeUrl(detail.getAttribute("href") ?? "") : undefined;
  const atomTitle = atom(e, "title")[0]?.textContent?.trim() ?? "";

  const type = tel(e, "type").toLowerCase();
  const name = tel(e, "name");
  const firstname = tel(e, "firstname");
  const hasStructured = !!(name || tel(e, "phone"));

  const fields: DisplayField[] = [];
  let title = atomTitle;
  let subtitle: string | undefined;

  if (hasStructured) {
    // Mit API-Key: strukturierte Felder
    title = type === "person" ? [firstname, name].filter(Boolean).join(" ") || title : tel(e, "org") || name || title;
    subtitle = [tel(e, "subname"), tel(e, "occupation")].filter(Boolean).join(" · ") || undefined;

    const street = [tel(e, "street"), tel(e, "streetno")].filter(Boolean).join(" ");
    const place = [tel(e, "zip"), tel(e, "city")].filter(Boolean).join(" ");
    const canton = tel(e, "canton");
    const address = [street, tel(e, "pobox"), tel(e, "hamlet"), place + (canton ? ` ${canton}` : "")].filter((s) => s.trim()).join(", ");
    if (address) fields.push({ label: "Adresse", value: address, type: "text" });
    if (type) fields.push({ label: "Eintrag", value: type === "person" ? "Privat" : "Firma", type: "badge" });

    const categories = telAll(e, "category").map((c) => c.textContent?.trim() ?? "").filter(Boolean);
    if (categories.length) fields.push({ label: "Branche", value: categories.join(", "), type: "text" });

    const phone = tel(e, "phone");
    if (phone) fields.push({ label: "Telefon", value: phone, type: "phone" });

    const extraLabels: Record<string, [string, DisplayField["type"]]> = {
      mobile: ["Mobile", "phone"],
      fax: ["Fax", "text"],
      email: ["E-Mail", "email"],
      website: ["Website", "link"],
    };
    for (const x of telAll(e, "extra")) {
      const t = x.getAttribute("type") ?? "";
      let value = x.textContent?.trim() ?? "";
      if (!value) continue;
      const [label, ftype] = extraLabels[t] ?? [t ? t.charAt(0).toUpperCase() + t.slice(1) : "Weitere", "text"];
      if (ftype === "link") {
        const u = safeUrl(value);
        if (!u) continue;
        value = u;
      }
      fields.push({ label, value, type: ftype });
    }
  } else {
    // Ohne API-Key: nur Titel + Freitext. Erste Zeile = Name, Zeilen mit Nummer weglassen.
    const lines = (atom(e, "content")[0]?.textContent ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(1)
      .filter((l) => !/^\*?\+?\d[\d\s]{6,}/.test(l));
    // Aufbau: [Beschreibung …] Strasse, PLZ Ort
    const zipIdx = lines.findIndex((l) => /^\d{4}\s/.test(l));
    const addrStart = zipIdx > 0 ? zipIdx - 1 : 0;
    const info = zipIdx >= 0 ? lines.slice(0, addrStart) : [];
    const address = zipIdx >= 0 ? lines.slice(addrStart, zipIdx + 1) : lines;
    subtitle = info.join(" · ") || undefined;
    if (address.length) fields.push({ label: "Adresse", value: address.join(", "), type: "text" });
  }

  return { title: title || "Eintrag", subtitle, fields, url, urlLabel: url ? "Auf search.ch öffnen" : undefined };
}
