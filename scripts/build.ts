/**
 * Baut die statische App nach dist/:
 *   dist/caller.html, dist/styles.css, dist/js/caller.js, dist/config.json
 *
 * config.json entsteht aus .env (tel.search.ch, Ländervorwahl) und optional sources.json
 * (weitere HTTP-Quellen) und wird hier gegen das Schema geprüft.
 *
 *   npm run build        → einmal bauen
 *   npm run dev          → bauen, beobachten und unter http://localhost:3978/caller.html ausliefern
 */
import * as esbuild from "esbuild";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { appConfigSchema, type AppConfig } from "../src/shared/schema.js";

const serve = process.argv.includes("--serve");
const env = (k: string, d = "") => (process.env[k] || d).trim();
const bool = (k: string, d: boolean) => (env(k) ? env(k).toLowerCase() === "true" : d);
const num = (k: string, d: number) => (env(k) && Number.isFinite(Number(env(k))) ? Number(env(k)) : d);

async function buildConfig(): Promise<AppConfig> {
  const sources: unknown[] = [];

  // Weitere Quellen (CRM, ERP …) aus sources.json
  if (existsSync("sources.json")) {
    const raw = JSON.parse(await readFile("sources.json", "utf8")) as unknown;
    const list = Array.isArray(raw) ? raw : (raw as { sources?: unknown[] }).sources ?? [];
    list.forEach((s, i) => {
      const o = s as Record<string, unknown>;
      sources.push({ id: o.id || `source-${i + 1}`, ...o });
    });
  }

  // tel.search.ch aus .env
  if (bool("SEARCHCH_ENABLED", false)) {
    sources.push({
      id: "searchch",
      kind: "searchch",
      name: env("SEARCHCH_NAME", "tel.search.ch"),
      url: env("SEARCHCH_API_URL", ""),
      fallbackOnly: bool("SEARCHCH_FALLBACK_ONLY", true),
      cacheMinutes: num("SEARCHCH_CACHE_HOURS", 24) * 60,
      maxMatches: Math.min(20, num("SEARCHCH_MAX_MATCHES", 3)),
      searchch: {
        apiKey: env("SEARCHCH_API_KEY"),
        privat: bool("SEARCHCH_PRIVAT", true),
        firma: bool("SEARCHCH_FIRMA", true),
        lang: env("SEARCHCH_LANG", "de"),
      },
    });
  }

  const parsed = appConfigSchema.safeParse({
    settings: {
      defaultCountryCode: env("DEFAULT_COUNTRY_CODE", "41"),
      showErrors: bool("SHOW_ERRORS", true),
    },
    sources,
  });
  if (!parsed.success) {
    console.error("Konfiguration ungültig:");
    for (const i of parsed.error.issues) console.error(`  - ${i.path.join(".")}: ${i.message}`);
    process.exit(1);
  }
  const config = parsed.data;

  // Prüfungen & Warnungen
  const ids = new Set<string>();
  for (const s of config.sources) {
    if (ids.has(s.id)) throw new Error(`Doppelte Quellen-ID: ${s.id}`);
    ids.add(s.id);
    if (s.kind === "http") {
      if (!/^https:\/\//i.test(s.url) && !/^http:\/\/localhost[:/]/i.test(s.url)) throw new Error(`Quelle "${s.name}": URL muss mit https:// beginnen`);
      if (s.auth.type !== "none" || s.headers.length) {
        console.warn(`⚠️  Quelle "${s.name}": Zugangsdaten/Header stehen in config.json und sind für alle sichtbar, die die App-URL kennen.`);
      }
    }
    if (s.kind === "searchch" && s.searchch.apiKey) {
      console.warn("⚠️  SEARCHCH_API_KEY steht in config.json und ist für alle sichtbar, die die App-URL kennen (siehe README).");
    }
  }
  console.log(`config.json: ${config.sources.length} Quelle(n) – ${config.sources.map((s) => s.name).join(", ") || "keine"}`);
  return config;
}

const options: esbuild.BuildOptions = {
  entryPoints: { "js/caller": "src/web/caller.ts" },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: ["es2022"],
  loader: { ".svg": "text" },
  minify: !serve,
  sourcemap: serve ? "inline" : false,
  logLevel: "info",
};

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
await writeFile("dist/config.json", JSON.stringify(await buildConfig(), null, 2));

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: "dist", port: num("PORT", 3978) });
  console.log(`\n→ http://localhost:${port}/caller.html  (Änderungen an .env/sources.json/public: neu starten)`);
} else {
  await esbuild.build(options);
}
