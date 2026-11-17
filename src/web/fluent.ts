/**
 * Dünne Schicht über Fluent UI Web Components v3 (Fluent 2, Teams-Design-System).
 * https://learn.microsoft.com/microsoftteams/platform/concepts/design/design-teams-app-fundamentals
 */
import "@fluentui/web-components/anchor-button.js";
import "@fluentui/web-components/avatar.js";
import "@fluentui/web-components/badge.js";
import "@fluentui/web-components/button.js";
import "@fluentui/web-components/link.js";
import "@fluentui/web-components/message-bar.js";
import "@fluentui/web-components/spinner.js";
import "@fluentui/web-components/text-input.js";
import { setTheme } from "@fluentui/web-components";
import { teamsDarkTheme, teamsHighContrastTheme, teamsLightTheme } from "@fluentui/tokens";

import add from "@fluentui/svg-icons/icons/add_20_regular.svg";
import arrowDown from "@fluentui/svg-icons/icons/arrow_down_20_regular.svg";
import arrowLeft from "@fluentui/svg-icons/icons/arrow_left_20_regular.svg";
import arrowSync from "@fluentui/svg-icons/icons/arrow_sync_20_regular.svg";
import arrowUp from "@fluentui/svg-icons/icons/arrow_up_20_regular.svg";
import beaker from "@fluentui/svg-icons/icons/beaker_20_regular.svg";
import book from "@fluentui/svg-icons/icons/book_20_regular.svg";
import building from "@fluentui/svg-icons/icons/building_20_regular.svg";
import clock from "@fluentui/svg-icons/icons/clock_20_regular.svg";
import key from "@fluentui/svg-icons/icons/key_20_regular.svg";
import shieldLock from "@fluentui/svg-icons/icons/shield_lock_20_regular.svg";
import calendar from "@fluentui/svg-icons/icons/calendar_ltr_20_regular.svg";
import call from "@fluentui/svg-icons/icons/call_20_regular.svg";
import database from "@fluentui/svg-icons/icons/database_20_regular.svg";
import deleteIcon from "@fluentui/svg-icons/icons/delete_20_regular.svg";
import dismiss from "@fluentui/svg-icons/icons/dismiss_20_regular.svg";
import edit from "@fluentui/svg-icons/icons/edit_20_regular.svg";
import globe from "@fluentui/svg-icons/icons/globe_20_regular.svg";
import location from "@fluentui/svg-icons/icons/location_20_regular.svg";
import mail from "@fluentui/svg-icons/icons/mail_20_regular.svg";
import open from "@fluentui/svg-icons/icons/open_20_regular.svg";
import plug from "@fluentui/svg-icons/icons/plug_connected_20_regular.svg";
import question from "@fluentui/svg-icons/icons/question_circle_20_regular.svg";
import save from "@fluentui/svg-icons/icons/save_20_regular.svg";
import search from "@fluentui/svg-icons/icons/search_20_regular.svg";
import settings from "@fluentui/svg-icons/icons/settings_20_regular.svg";
import tag from "@fluentui/svg-icons/icons/tag_20_regular.svg";

export const ICONS = {
  add, arrowDown, arrowLeft, arrowSync, arrowUp, beaker, book, building, calendar, call, clock, database, key, shieldLock,
  delete: deleteIcon, dismiss, edit, globe, location, mail, open, plug, question, save, search, settings, tag,
} as const;
export type IconName = keyof typeof ICONS;

/* ---------- Theme ---------- */

export type TeamsTheme = "default" | "dark" | "contrast";

export function applyTheme(theme: string | undefined): void {
  const t: TeamsTheme = theme === "dark" || theme === "contrast" ? theme : "default";
  setTheme(t === "dark" ? teamsDarkTheme : t === "contrast" ? teamsHighContrastTheme : teamsLightTheme);
  document.documentElement.dataset.theme = t;
}

/* ---------- DOM-Helfer ---------- */

export type Child = Node | string | number | false | null | undefined | Child[];
type Props = Record<string, unknown>;

export function h<K extends string>(tag: K, props?: Props | null, ...children: Child[]): K extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[K] : HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el as never;
}

export function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element, ...children: Child[]) {
  el.replaceChildren();
  append(el, children);
}

export function icon(name: IconName, slot?: string): HTMLElement {
  const span = h("span", { class: "fi", "aria-hidden": "true", slot });
  span.innerHTML = ICONS[name];
  return span;
}

/* ---------- Komponenten ---------- */

export type ButtonAppearance = "primary" | "outline" | "subtle" | "transparent" | undefined;

export function button(
  label: string,
  opts: { appearance?: ButtonAppearance; icon?: IconName; iconOnly?: boolean; size?: "small" | "medium"; disabled?: boolean; onClick?: (e: Event) => void; title?: string } = {},
): HTMLElement {
  const el = h(
    "fluent-button",
    {
      appearance: opts.appearance,
      size: opts.size,
      "icon-only": opts.iconOnly,
      disabled: opts.disabled,
      title: opts.title ?? (opts.iconOnly ? label : undefined),
      "aria-label": opts.iconOnly ? label : undefined,
      onclick: opts.onClick,
    },
    opts.icon && icon(opts.icon, opts.iconOnly ? undefined : "start"),
    !opts.iconOnly && label,
  );
  return el;
}

export function linkButton(label: string, href: string, opts: { appearance?: ButtonAppearance; icon?: IconName; size?: "small" | "medium" } = {}): HTMLElement {
  return h(
    "fluent-anchor-button",
    { href, target: "_blank", rel: "noopener noreferrer", appearance: opts.appearance, size: opts.size },
    opts.icon && icon(opts.icon, "start"),
    label,
  );
}

export function link(label: Child, href: string, opts: { inline?: boolean; external?: boolean } = {}): HTMLElement {
  return h("fluent-link", { href, inline: opts.inline, target: opts.external === false ? undefined : "_blank", rel: "noopener noreferrer" }, label);
}

export function badge(label: string, color: "brand" | "informative" | "success" | "warning" | "danger" | "subtle" = "brand", appearance: "filled" | "tint" | "outline" | "ghost" = "tint"): HTMLElement {
  return h("fluent-badge", { color, appearance, size: "medium", shape: "rounded" }, label);
}

export function spinner(text = "Lade …", size: "tiny" | "extra-small" | "small" | "medium" = "small"): HTMLElement {
  return h("div", { class: "loading", role: "status" }, h("fluent-spinner", { size }), h("span", null, text));
}

export function messageBar(intent: "info" | "success" | "warning" | "error", ...content: Child[]): HTMLElement {
  return h("fluent-message-bar", { intent, layout: "multiline", shape: "rounded" }, ...content);
}

export function avatar(name: string, shape: "circular" | "square" = "circular"): HTMLElement {
  return h("fluent-avatar", { name, color: "colorful", size: 40, shape });
}

/* ---------- Eingabe ---------- */

export type FluentTextInput = HTMLElement & { value: string; control?: HTMLInputElement };

export function textInput(o: { value: string; onInput: (v: string) => void; placeholder?: string; type?: "text" | "tel" | "email"; label: string }): FluentTextInput {
  const el = h("fluent-text-input", { type: o.type ?? "text", value: o.value, placeholder: o.placeholder, autocomplete: "off", "aria-label": o.label }) as FluentTextInput;
  el.value = o.value;
  el.addEventListener("input", () => o.onInput(el.value));
  return el;
}
