// Erzeugt appPackage/build/callerinfo.zip (Teams-App-Paket) aus manifest.template.json und .env
//
// Das ZIP wird bewusst ohne Bibliothek geschrieben: flach (keine Ordner), Deflate,
// CRC/Grössen im Local Header, keine Data Descriptors, kein ZIP64 – das Format,
// das der Teams-Upload zuverlässig akzeptiert.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import zlib from "node:zlib";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const env = (k, d = "") => (process.env[k] || d).trim();

// Basis-URL, unter der dist/ gehostet wird, z.B. https://flawas.github.io/teams-callerinfo
const baseUrl = (env("PUBLIC_URL") || (env("PUBLIC_HOST") ? `https://${env("PUBLIC_HOST").replace(/^https?:\/\//, "")}` : "")).replace(/\/+$/, "");
let host = "";
try {
  const u = new URL(baseUrl);
  if (u.protocol !== "https:") throw new Error();
  host = u.host;
} catch {
  /* unten gemeldet */
}
const clientId = env("CLIENT_ID");
let teamsAppId = env("TEAMS_APP_ID");
const errors = [];

if (!host) errors.push("PUBLIC_URL fehlt oder ist keine https-URL (z.B. https://flawas.github.io/teams-callerinfo)");
if (!GUID.test(clientId)) errors.push("CLIENT_ID fehlt oder ist keine GUID (Application-ID der App-Registrierung, wird von Teams für die Anruf-Berechtigung verlangt)");
if (!teamsAppId) {
  teamsAppId = randomUUID();
  console.warn(`TEAMS_APP_ID nicht gesetzt – neue ID erzeugt: ${teamsAppId}\n→ Bitte in .env eintragen, damit Updates dieselbe App ersetzen.`);
} else if (!GUID.test(teamsAppId)) {
  errors.push("TEAMS_APP_ID ist keine GUID");
}
if (errors.length) {
  console.error("Fehler:\n- " + errors.join("\n- "));
  process.exit(1);
}

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const vars = {
  VERSION: pkg.version,
  TEAMS_APP_ID: teamsAppId,
  CLIENT_ID: clientId,
  HOST: host,
  BASE_URL: baseUrl,
  DEVELOPER_NAME: env("DEVELOPER_NAME", "Caller Info"),
  DEVELOPER_URL: env("DEVELOPER_URL", `${baseUrl}/caller.html`),
};

const template = await readFile("appPackage/manifest.template.json", "utf8");
const manifest = template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
const leftover = manifest.match(/\{\{\w+\}\}/g);
if (leftover) {
  console.error(`Nicht ersetzte Platzhalter im Manifest: ${leftover.join(", ")}`);
  process.exit(1);
}
JSON.parse(manifest); // Syntax prüfen

/* ---------- Minimaler ZIP-Writer ---------- */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function zip(files) {
  const { time, date } = dosDateTime();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // Local file header
    local.writeUInt16LE(20, 4); // version needed (2.0)
    local.writeUInt16LE(0, 6); // flags: keine Data Descriptors
    local.writeUInt16LE(8, 8); // Deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // Central directory header
    central.writeUInt16LE(20, 4); // version made by (MS-DOS, 2.0)
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // End of central directory
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/* ---------- Paket schreiben ---------- */

await mkdir("appPackage/build", { recursive: true });
await writeFile("appPackage/build/manifest.json", manifest);

const zipPath = "appPackage/build/callerinfo.zip";
await writeFile(
  zipPath,
  zip([
    { name: "manifest.json", data: Buffer.from(manifest, "utf8") },
    { name: "color.png", data: await readFile("appPackage/color.png") },
    { name: "outline.png", data: await readFile("appPackage/outline.png") },
  ]),
);

console.log(`✓ ${zipPath} (Version ${vars.VERSION}, ${baseUrl}/caller.html, App-ID ${teamsAppId})`);
console.log("  → Genau DIESE Datei hochladen (nicht entpacken/neu zippen).");
