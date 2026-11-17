import { FrameContexts, meeting, type app } from "@microsoft/teams-js";
import type { AppConfig, LookupResponse } from "../shared/schema.js";
import { lookup as runLookup, pruneCache } from "../lookup/engine.js";
import { clear, emptyState, errorBar, formatPhone, h, initTeams, loadConfig, renderSource, spinner } from "./common.js";
import { button, icon, messageBar, textInput } from "./fluent.js";

const root = document.getElementById("app")!;

interface Party {
  phone?: string;
  email?: string;
}

let config: AppConfig;
let user: { upn?: string; name?: string } | undefined;
let callDetails: unknown;
let current: Party = {};
let fromCall = false;

function emailToString(e: unknown): string | undefined {
  if (!e) return undefined;
  if (typeof e === "string") return e;
  const val = (e as { val?: string }).val;
  if (val) return val;
  const s = String(e);
  return s.includes("@") ? s : undefined;
}

function partyFrom(info: unknown, legacy: unknown): Party {
  const i = (info ?? {}) as { phoneNumber?: string; email?: unknown };
  const p: Party = { phone: i.phoneNumber || undefined, email: emailToString(i.email) };
  if (!p.phone && !p.email && typeof legacy === "string" && legacy) {
    if (legacy.includes("@")) p.email = legacy;
    else p.phone = legacy;
  }
  return p;
}

/** Ermittelt die Gegenstelle des aktuellen 1:1-Anrufs. */
async function detectCaller(ctx: app.Context): Promise<Party | null> {
  if (ctx.page.frameContext !== FrameContexts.sidePanel) return null;
  const res = await meeting.getMeetingDetailsVerbose();
  callDetails = res;
  const d = res.details as unknown as Record<string, unknown>;
  const caller = partyFrom(d.originalCallerInfo, d.originalCaller);

  // Ausgehender Anruf: "originalCaller" ist man selbst → angerufene Gegenstelle verwenden, falls geliefert
  const self = (ctx.user?.userPrincipalName ?? "").toLowerCase();
  if (caller.email && self && caller.email.toLowerCase() === self) {
    const dialed = partyFrom(d.dialedEntityInfo, d.dialedEntity);
    if (dialed.phone || dialed.email) return dialed;
  }
  return caller.phone || caller.email ? caller : null;
}

async function lookup(party: Party) {
  current = party;
  const results = document.getElementById("results")!;
  clear(results, spinner("Suche Infos zum Anrufer …"));
  renderHeader(party);

  try {
    const res = await runLookup(config, party, user);
    if (res.configured === 0) {
      clear(results, emptyState("plug", "Keine Datenquelle aktiv", h("p", { class: "caption" }, "In der Konfiguration (.env bzw. sources.json) ist keine Quelle aktiviert.")));
      return;
    }
    renderHeader(party, res);
    const blocks = res.results.map((r) => renderSource(r)).filter((x): x is HTMLElement => !!x);
    clear(
      results,
      blocks.length
        ? blocks
        : emptyState("search", "Kein Eintrag gefunden", h("p", { class: "caption" }, `Durchsucht: ${res.results.filter((r) => !r.skipped).map((r) => r.sourceName).join(", ")}`)),
    );
  } catch (err) {
    clear(results, errorBar(err));
  }
}

function renderHeader(party: Party, res?: LookupResponse) {
  const head = document.getElementById("caller")!;
  const display = res?.query.phoneE164 ?? party.phone;
  clear(
    head,
    h("div", { class: "caller-icon" }, icon(display ? "call" : "mail")),
    h(
      "div",
      { class: "caller-id" },
      h("div", { class: "caller-number" }, display ? formatPhone(display) : party.email ?? "Unbekannt"),
      h("div", { class: "caption" }, display && party.email ? party.email : fromCall ? "Aktueller Anruf" : "Manuelle Suche"),
    ),
    button("Aktualisieren", { appearance: "subtle", icon: "arrowSync", iconOnly: true, onClick: () => lookup(current) }),
  );
}

function manualSearch(open: boolean): HTMLElement {
  let value = "";
  const go = () => {
    const v = value.trim();
    if (!v) return;
    fromCall = false;
    void lookup(v.includes("@") ? { email: v } : { phone: v });
  };
  const input = textInput({ value: "", placeholder: "+41 41 123 45 67 oder E-Mail", onInput: (v) => (value = v), type: "tel", label: "Nummer oder E-Mail" });
  input.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Enter" && go());
  input.prepend(icon("search", "start"));
  return h("details", { class: "manual", open }, h("summary", null, "Andere Nummer suchen"), h("div", { class: "row" }, input, button("Suchen", { appearance: "primary", onClick: go })));
}

async function main() {
  const ctx = await initTeams();
  clear(root, h("div", { id: "caller", class: "caller" }), h("div", { id: "results" }, spinner()));
  pruneCache();

  try {
    config = await loadConfig();
  } catch (err) {
    clear(root, errorBar(err));
    return;
  }
  user = ctx?.user ? { upn: ctx.user.userPrincipalName, name: ctx.user.displayName } : undefined;

  let party: Party | null = null;
  let detectError: string | undefined;
  if (ctx) {
    try {
      party = await detectCaller(ctx);
    } catch (err) {
      detectError = (err as Error).message;
    }
  }

  const inCall = ctx?.page.frameContext === FrameContexts.sidePanel;
  root.append(manualSearch(!party));

  // Zur Fehlersuche: Was Teams zum Anruf geliefert hat (nur wenn die Erkennung nicht geklappt hat)
  if (inCall && !party && (callDetails || detectError)) {
    root.append(
      h(
        "details",
        { class: "debug" },
        h("summary", null, "Anrufdaten von Teams"),
        detectError && messageBar("warning", detectError),
        callDetails !== undefined && h("pre", null, JSON.stringify(callDetails, null, 2)),
      ),
    );
  }

  if (party) {
    fromCall = true;
    await lookup(party);
  } else {
    clear(document.getElementById("caller")!);
    clear(
      document.getElementById("results")!,
      emptyState(
        "call",
        inCall ? "Gegenstelle nicht erkannt" : "Kein aktiver Anruf",
        h("p", { class: "caption" }, inCall ? "Du kannst die Nummer unten manuell suchen." : "Während eines 1:1-Anrufs zeigt diese App die Infos zum Gegenüber automatisch an."),
      ),
    );
  }
}

void main();
