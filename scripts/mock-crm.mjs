// Mini-Mock-CRM zum lokalen Testen (mit CORS, wie es Browser-Anfragen brauchen).
// Start: npm run mock   →  http://localhost:4000
//   GET  /api/contacts?phone=+41...      → beliebiges JSON (für "mapped")
//   GET  /api/standard?phone=+41...      → Standardformat der App
//   POST /api/search  { phone }          → beliebiges JSON, verlangt Header X-API-Key: geheim
import http from "node:http";

const contacts = [
  {
    id: 4711,
    displayName: "Anna Muster",
    company: { name: "Muster AG", city: "Luzern" },
    phones: [{ type: "mobile", number: "+41791234567" }],
    email: "anna.muster@muster.ch",
    customerSince: "2019-04-01",
    openTickets: 3,
    accountManager: "Flavio",
  },
  {
    id: 4712,
    displayName: "Beat Beispiel",
    company: { name: "Beispiel GmbH", city: "Weggis" },
    phones: [{ type: "office", number: "+41413901234" }],
    email: "beat@beispiel.ch",
    customerSince: "2022-11-15",
    openTickets: 0,
    accountManager: "Sandra",
  },
];

const find = (phone) => contacts.filter((c) => c.phones.some((p) => p.number === phone));

// CORS wie bei einer echten API, die Browser-Anfragen erlaubt
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

/* ---------- tel.search.ch-Mock (erfundene Daten, Format wie die echte API) ----------
   SEARCHCH_API_URL=http://localhost:4000/tel/api/  → Key "testkey" = strukturiert (ISO-8859-1),
   ohne Key = nur Titel/Content (UTF-8), Key "invalid" = 403-Fehler-Feed */
const NS = `xmlns="http://www.w3.org/2005/Atom" xmlns:openSearch="http://a9.com/-/spec/opensearchrss/1.0/" xmlns:tel="http://tel.search.ch/api/spec/result/1.0/"`;
const telEntries = {
  "+41413901299": [
    {
      id: "0a1b2c3d4e5f6a7b", type: "Organisation", name: "Schreinerei Kaufmann GmbH", occupation: "Innenausbau & Möbel nach Mass",
      street: "Dorfstrasse", streetno: "8", zip: "6402", city: "Merlischachen", canton: "SZ",
      categories: ["Schreinereien"], phone: "+41413901299",
      extra: { email: "info@kaufmann.example", website: "www.kaufmann.example" },
    },
  ],
  "+41413901234": [
    {
      id: "a1b2c3d4e5f60718", type: "Organisation", name: "Bäckerei Zürcher AG", occupation: "Bäckerei, Konditorei & Café",
      street: "Seestrasse", streetno: "12", zip: "6353", city: "Weggis", canton: "LU",
      categories: ["Bäckereien", "Konditoreien"], phone: "+41413901234",
      extra: { fax: "+41413901235", email: "info@baeckerei-zuercher.example", website: "www.baeckerei-zuercher.example" },
    },
  ],
  "+41791112233": [
    { id: "f0e1d2c3b4a59687", type: "Person", name: "Muster", firstname: "Regula", occupation: "Architektin",
      street: "Hertensteinstrasse", streetno: "5", zip: "6006", city: "Luzern", canton: "LU", phone: "+41791112233" },
  ],
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function searchch(url, res) {
  const key = url.searchParams.get("key");
  const was = url.searchParams.get("was") ?? "";
  if (key === "invalid") {
    const xml = `<?xml version="1.0" encoding="utf-8" ?>\n<feed xml:lang="de" ${NS}><id>https://tel.search.ch/api/error-403</id><title type="text">tel.search.ch API Error</title><tel:errorCode>403</tel:errorCode><tel:errorReason>Forbidden</tel:errorReason><tel:errorMessage>The submitted API-Key is invalid or blocked</tel:errorMessage></feed>`;
    res.writeHead(403, { "Content-Type": "text/xml; charset=utf-8", ...CORS });
    return res.end(xml);
  }
  const list = telEntries[was] ?? [];
  const entries = list.map((e) => {
    const title = e.type === "Person" ? `${e.name}, ${e.firstname}` : e.name;
    const content = [title, e.occupation, `${e.street} ${e.streetno}`, `${e.zip} ${e.city} ${e.canton}`, "*0" + e.phone.slice(3)].filter(Boolean).join("\n    ");
    const tel = key
      ? [
          `<tel:pos>1</tel:pos>`, `<tel:id>${e.id}</tel:id>`, `<tel:type>${e.type}</tel:type>`, `<tel:name>${esc(e.name)}</tel:name>`,
          e.firstname && `<tel:firstname>${esc(e.firstname)}</tel:firstname>`, `<tel:occupation>${esc(e.occupation ?? "")}</tel:occupation>`,
          `<tel:street>${esc(e.street)}</tel:street>`, `<tel:streetno>${e.streetno}</tel:streetno>`, `<tel:zip>${e.zip}</tel:zip>`,
          `<tel:city>${esc(e.city)}</tel:city>`, `<tel:canton>${e.canton}</tel:canton>`,
          ...(e.categories ?? []).map((c) => `<tel:category>${esc(c)}</tel:category>`),
          `<tel:phone>${e.phone}</tel:phone>`,
          ...Object.entries(e.extra ?? {}).map(([t, v]) => `<tel:extra type="${t}">${esc(v)}</tel:extra>`),
        ].filter(Boolean).join("\n    ")
      : "";
    return `<entry>
    <id>urn:uuid:${e.id}</id>
    <title type="text">${esc(title)}</title>
    <content type="text">${esc(content)}</content>
    <author><name>tel.search.ch</name></author>
    <link href="https://search.ch/tel/detail/${e.id}" title="Details" rel="alternate" type="text/html" />
    <link href="https://search.ch/tel/vcard/x.vcf?key=${e.id}" type="text/x-vcard" title="VCard Download" rel="alternate" />
    <link href="https://search.ch/tel/edit/?id=${e.id}" rel="edit" type="text/html" />
    ${tel}
  </entry>`;
  });
  const correction = list.length ? "" : `<openSearch:Query role="correction" searchTerms="0419301234" totalResults="2"></openSearch:Query>`;
  const encoding = key ? "ISO-8859-1" : "utf-8";
  const xml = `<?xml version="1.0" encoding="${encoding}" ?>
<feed xml:lang="de" ${NS}>
  <title type="text">tel.search.ch API Search Results</title>
  <openSearch:totalResults>${list.length}</openSearch:totalResults>
  <openSearch:Query role="request" searchTerms="${esc(was)}" startPage="1"></openSearch:Query>
  ${correction}
  ${entries.join("\n  ")}
</feed>`;
  // Mit Key wie im offiziellen Beispiel ISO-8859-1 (ohne charset im Header), sonst UTF-8 wie live
  res.writeHead(200, { "Content-Type": key ? "text/xml" : "text/xml; charset=utf-8", ...CORS });
  res.end(Buffer.from(xml, key ? "latin1" : "utf8"));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    console.log(req.method, url.pathname + url.search);
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (req.method === "GET" && url.pathname === "/api/contacts") {
      const hits = find(url.searchParams.get("phone"));
      return hits.length ? send(res, 200, { data: { items: hits, total: hits.length } }) : send(res, 404, { error: "not found" });
    }
    if (req.method === "GET" && url.pathname === "/api/standard") {
      return send(res, 200, {
        matches: find(url.searchParams.get("phone")).map((c) => ({
          title: c.displayName,
          subtitle: `${c.company.name} · ${c.company.city}`,
          url: `https://crm.example.ch/kontakte/${c.id}`,
          urlLabel: "Im CRM öffnen",
          fields: [
            { label: "E-Mail", value: c.email, type: "email" },
            { label: "Offene Tickets", value: c.openTickets, type: "badge" },
            { label: "Kunde seit", value: c.customerSince, type: "date" },
          ],
        })),
      });
    }
    if (req.method === "POST" && url.pathname === "/api/search") {
      if (req.headers["x-api-key"] !== "geheim") return send(res, 401, { error: "unauthorized" });
      let body = "";
      for await (const chunk of req) body += chunk;
      const { phone } = JSON.parse(body || "{}");
      return send(res, 200, { results: find(phone) });
    }
    if (url.pathname === "/tel/api/") return searchch(url, res);
    if (url.pathname === "/slow") {
      setTimeout(() => send(res, 200, {}), 10000);
      return;
    }
    send(res, 404, { error: "unknown route" });
  })
  .listen(4000, () => console.log("Mock-CRM auf http://localhost:4000"));
