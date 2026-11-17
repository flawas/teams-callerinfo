import { app } from "@microsoft/teams-js";
import type { AppConfig, DisplayField, Match, SourceResult } from "../shared/schema.js";
import { applyTheme, avatar, badge, h, icon, linkButton, link, messageBar, type Child, type IconName } from "./fluent.js";

export { clear, h, spinner } from "./fluent.js";

/* ---------- Teams ---------- */

export let inTeams = false;

/** Initialisiert TeamsJS. Ausserhalb von Teams (lokale Entwicklung) wird null zurückgegeben. */
export async function initTeams(): Promise<app.Context | null> {
  if (window.parent === window && !window.opener) {
    applyTheme(matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default");
    return null;
  }
  try {
    await Promise.race([
      app.initialize(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000)),
    ]);
    inTeams = true;
    const ctx = await app.getContext();
    applyTheme(ctx.app.theme);
    app.registerOnThemeChangeHandler(applyTheme);
    app.notifySuccess();
    return ctx;
  } catch {
    applyTheme("default");
    return null;
  }
}

/* ---------- Konfiguration ---------- */

export async function loadConfig(): Promise<AppConfig> {
  const res = await fetch("config.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`config.json konnte nicht geladen werden (HTTP ${res.status})`);
  return (await res.json()) as AppConfig;
}

export function errorBar(err: unknown): HTMLElement {
  return messageBar("error", h("strong", null, (err as Error)?.message ?? String(err)));
}

/* ---------- Formatierung ---------- */

export function formatPhone(p?: string): string {
  if (!p) return "";
  const m = /^\+41(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(p);
  if (m) return `+41 ${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
  return p;
}

function formatDate(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const hasTime = /T\d{2}:\d{2}/.test(v) && !/T00:00(:00)?(\.0+)?(Z|[+-]00:?00)?$/.test(v);
  return d.toLocaleString("de-CH", hasTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}

const FIELD_ICONS: Partial<Record<DisplayField["type"], IconName>> = {
  email: "mail",
  phone: "call",
  link: "globe",
  date: "calendar",
};

function fieldIcon(f: DisplayField): IconName {
  if (FIELD_ICONS[f.type]) return FIELD_ICONS[f.type]!;
  if (/adresse|address|ort|strasse/i.test(f.label)) return "location";
  if (/branche|kategorie|category|typ|eintrag/i.test(f.label)) return "tag";
  return "book";
}

function fieldValue(f: DisplayField): Node {
  switch (f.type) {
    case "link":
      return link(f.value.replace(/^https?:\/\//, "").replace(/\/$/, ""), f.value, { inline: true });
    case "email":
      return link(f.value, `mailto:${f.value}`, { inline: true, external: false });
    case "phone":
      return link(formatPhone(f.value), `tel:${f.value.replace(/\s/g, "")}`, { inline: true, external: false });
    case "date":
      return document.createTextNode(formatDate(f.value));
    case "badge":
      return badge(f.value, "brand", "tint");
    default:
      return document.createTextNode(f.value);
  }
}

export function renderMatch(m: Match): HTMLElement {
  return h(
    "div",
    { class: "match" },
    h(
      "div",
      { class: "match-head" },
      avatar(m.title),
      h("div", { class: "match-id" }, h("div", { class: "match-title" }, m.title), m.subtitle && h("div", { class: "match-sub" }, m.subtitle)),
    ),
    m.fields.length > 0 &&
      h(
        "dl",
        { class: "fields" },
        m.fields.map((f) =>
          h(
            "div",
            { class: "field-row" },
            h("dt", null, icon(fieldIcon(f)), h("span", { class: "field-label" }, f.label)),
            h("dd", { class: "field-value" }, fieldValue(f)),
          ),
        ),
      ),
    m.url && h("div", { class: "match-actions" }, linkButton(m.urlLabel ?? "Öffnen", m.url, { appearance: "outline", icon: "open", size: "small" })),
  );
}

export function renderSource(r: SourceResult, opts: { showEmpty?: boolean } = {}): HTMLElement | null {
  if (r.status === "notFound" && !opts.showEmpty) return null;
  return h(
    "section",
    { class: `source card source-${r.status}` },
    h(
      "header",
      { class: "source-head" },
      h("span", { class: "source-name" }, icon("database"), r.sourceName),
      h("span", { class: "caption" }, r.cached ? "aus Cache" : `${r.durationMs} ms`),
    ),
    r.status === "ok" && r.matches.map(renderMatch),
    r.status === "notFound" && h("p", { class: "source-msg caption" }, "Kein Treffer."),
    r.status === "error" && h("div", { class: "source-msg" }, messageBar("error", r.error ?? "Fehler")),
    r.attribution && r.status !== "error" && h("footer", { class: "source-foot caption" }, r.attribution),
  );
}

export function emptyState(iconName: IconName, title: string, ...body: Child[]): HTMLElement {
  return h("div", { class: "empty" }, h("div", { class: "empty-icon" }, icon(iconName)), h("div", { class: "empty-title" }, title), ...body);
}

