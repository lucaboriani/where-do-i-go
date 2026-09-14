#!/usr/bin/env tsx
/** Seed a local Community Solid Server with the §7 fixtures. Disposable data,
 *  so the unresolved example.org dy: namespace is fine here and would not be
 *  on a live Pod. ./notes.md#seeding-a-local-pod */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Session } from "@inrupt/solid-client-authn-node";
import { NS } from "../lib/vocab";

const BASE = process.env.SEED_POD ?? "http://localhost:3001";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const doc = readFileSync(resolve(ROOT, "docs", "data-model.md"), "utf8");
const [DIARY, TRIP, ENTRY, INDEX] = [...doc.matchAll(/```turtle\n([\s\S]*?)```/g)].map((m) => m[1]);

const api = async (url: string, body?: unknown, token?: string) => {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `CSS-Account-Token ${token}`;
  const r = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
};

// Unique per run: CSS rejects a duplicate pod name, and re-seeding after a
// failed attempt is the common case. Override with SEED_NAME.
const name = process.env.SEED_NAME ?? `dev-${Date.now().toString(36)}`;
const acct = await api(`${BASE}/.account/account/`, {});
const token = acct.authorization as string;
const controls = (await api(`${BASE}/.account/`, undefined, token)).controls;
await api(
  controls.password.create,
  { email: `${name}@localhost.test`, password: "dev" },
  token,
).catch(() => {});
const pod = await api(controls.account.pod, { name }, token);
const POD: string = pod.pod;
const webId = `${POD}profile/card#me`;

const cc = await api(controls.account.clientCredentials, { name, webId }, token);
const session = new Session();
await session.login({ clientId: cc.id, clientSecret: cc.secret, oidcIssuer: BASE });

// Preconditioned, like every other write in this repo. CLAUDE.md's rule covers
// scratch code explicitly, and this script runs in CI on every re-run — a blind
// PUT here would silently overwrite a seeded pod rather than failing.
const put = async (path: string, body: string, type = "text/turtle") => {
  const r = await session.fetch(`${POD}${path}`, {
    method: "PUT",
    headers: { "content-type": type, "if-none-match": "*" },
    body,
  });
  console.log(`  PUT ${path} -> ${r.status}`);
  if (!r.ok) {
    throw new Error(
      `PUT ${path} failed with ${r.status}. ` +
        (r.status === 412
          ? "That pod already has this resource — use a different SEED_NAME."
          : "Seeding aborted; the pod is in an unknown state."),
    );
  }
};

/** Derive one fixture from another, refusing a needle that is not there. A
 *  stale needle is a SILENT no-op that writes the original value under the new
 *  name; one below went stale today.
 *  ./notes.md#deriving-a-second-trip-from-the-fixtures */
const derive = (text: string, edits: [find: string, replace: string][]) =>
  edits.reduce((out, [find, replace]) => {
    if (!out.includes(find)) throw new Error(`seed: the fixture no longer contains ${find}`);
    return out.replaceAll(find, replace);
  }, text);

for (const c of [
  "travel/",
  "travel/trips/",
  "travel/trips/2026-japan/",
  "travel/trips/2026-japan/entries/",
  "travel/trips/2025-patagonia/",
  "travel/trips/2025-patagonia/entries/",
]) {
  const r = await session.fetch(`${POD}${c}`, {
    method: "PUT",
    headers: {
      "content-type": "text/turtle",
      "if-none-match": "*",
      link: `<${NS.ldp}BasicContainer>; rel="type"`,
    },
  });
  if (!r.ok) throw new Error(`creating container ${c} failed with ${r.status}`);
}

// Public read that INHERITS to children — the CSS default grants acl:accessTo
// on the root only, so a deployer assuming it cascades ships an unreadable
// diary (docs/phase-0-spike.md).
await put(
  "travel/.acl",
  `@prefix acl: <http://www.w3.org/ns/auth/acl#>.\n@prefix foaf: <${NS.foaf}>.\n` +
    `<#public> a acl:Authorization; acl:agentClass foaf:Agent; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read.\n` +
    `<#owner> a acl:Authorization; acl:agent <${webId}>; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read, acl:Write, acl:Control.\n`,
);

// Both trips the §7.1 diary lists now exist, plus a draft it does not: no index
// acts as a publication boundary for trips, so the app must filter on dy:status
// and dev data has to make that reachable. The draft is appended after the LAST
// of them, which is the line carrying the full stop.
await put(
  "travel/diary.ttl",
  derive(DIARY, [
    [
      "<trips/2025-patagonia/trip.ttl#it> .",
      "<trips/2025-patagonia/trip.ttl#it> ,\n                        <trips/2026-secret/trip.ttl#it> .",
    ],
  ]),
);
await put("travel/trips/2026-japan/trip.ttl", TRIP);
// §7.4 names <#e-2026-03-31-nara> in dy:entry but never describes it, so
// lib/pod/read.ts drops it and the seed has no arriving leg to test against.
// Give it the fields to become a real placed entry, sorted after arrival.
await put(
  "travel/trips/2026-japan/entries.ttl",
  `${INDEX.trimEnd()}\n\n<#e-2026-03-31-nara>\n` +
    `    a dy:IndexEntry ;\n` +
    `    dy:entryResource   <entries/2026-03-31-nara.ttl#it> ;\n` +
    `    dcterms:title      "Deer and temples in Nara"@en ;\n` +
    `    dy:slug            "2026-03-31-nara" ;\n` +
    `    dy:occurredAt      "2026-03-31T10:15:00+09:00"^^xsd:dateTime ;\n` +
    `    dy:lat             34.6851 ;\n` +
    `    dy:long            135.8048 ;\n` +
    // Without this the marker is a pin at four decimals, which claims an exact
    // coordinate the fuzzed data does not have (docs/design-brief.md).
    `    dy:precisionMeters 500 ;\n` +
    `    dy:travelModeFrom  dy:Train ;\n` +
    `    dy:sortOrder       2 .\n`,
);
await put("travel/trips/2026-japan/entries/2026-03-29-arrival.ttl", ENTRY);
// The resource the index entry above points at. Without it the entry route
// prerenders a "Not found" page for a slug the timeline links to.
// The file name IS the slug — lib/pod/read.ts's assertEntrySlug rejects a mismatch.
await put(
  "travel/trips/2026-japan/entries/2026-03-31-nara.ttl",
  derive(ENTRY, [
    ['"2026-03-29-arrival"', '"2026-03-31-nara"'],
    ['"First night in Shinjuku"@en', '"Deer and temples in Nara"@en'],
    [
      'dy:occurredAt        "2026-03-29T21:40:00+09:00"',
      'dy:occurredAt        "2026-03-31T10:15:00+09:00"',
    ],
    ["dy:travelModeFrom    dy:Flight", "dy:travelModeFrom    dy:Train"],
    ['"Shinjuku, Tokyo"@en', '"Nara"@en'],
    ['schema:addressLocality "Tokyo"@en', 'schema:addressLocality "Nara"@en'],
    ["35.6938", "34.6851"],
    ["139.7034", "135.8048"],
  ]),
);

// The second published trip, a hemisphere from the first: two markers a few
// degrees apart exercise nothing the globe on `/` does — no fit worth watching
// and no fly-to. ./notes.md#deriving-a-second-trip-from-the-fixtures
await put(
  "travel/trips/2025-patagonia/trip.ttl",
  derive(TRIP, [
    ['dy:slug            "2026-japan"', 'dy:slug            "2025-patagonia"'],
    ['schema:name        "Japan, spring"@en', 'schema:name        "Patagonia, autumn"@en'],
    [
      'schema:description "Three weeks from Tokyo to Kyushu, mostly by train."@en',
      'schema:description "Two weeks in Argentine Patagonia, mostly on foot."@en',
    ],
    ['dy:startDate       "2026-03-28"^^xsd:date', 'dy:startDate       "2025-03-08"^^xsd:date'],
    ['dy:endDate         "2026-04-17"^^xsd:date', 'dy:endDate         "2025-03-22"^^xsd:date'],
    [
      'dcterms:created    "2026-03-01T09:12:00+01:00"',
      'dcterms:created    "2025-02-02T10:04:00+01:00"',
    ],
    [
      'dcterms:modified   "2026-04-20T18:02:11+02:00"',
      'dcterms:modified   "2025-03-24T20:15:00+01:00"',
    ],
    [
      'dy:tag             "japan", "trains", "food"',
      'dy:tag             "patagonia", "hiking", "glaciers"',
    ],
  ]),
);
// Centre and bbox are what the globe reads (§7.4); both come from the two
// entries below rather than from anywhere else, so the marker lands on the
// trip it claims.
await put(
  "travel/trips/2025-patagonia/entries.ttl",
  `${derive(INDEX, [
    [
      'dcterms:modified "2026-04-20T18:02:11+02:00"',
      'dcterms:modified "2025-03-15T09:10:00-03:00"',
    ],
    ["dy:entryCount    14", "dy:entryCount    2"],
    ["dy:bboxWest      129.8721", "dy:bboxWest      -73.1377"],
    ["dy:bboxSouth     31.5904", "dy:bboxSouth     -50.4967"],
    ["dy:bboxEast      139.8107", "dy:bboxEast      -72.8860"],
    ["dy:bboxNorth     35.7148", "dy:bboxNorth     -49.3315"],
    ["dy:centerLat     33.6526", "dy:centerLat     -49.9141"],
    ["dy:centerLong    134.8414", "dy:centerLong    -73.0119"],
    [", <#e-2026-03-31-nara>", ", <#e-2025-03-14-perito-moreno>"],
    ["2026-03-29-arrival", "2025-03-09-el-chalten"],
    ['"First night in Shinjuku"@en', '"Under Fitz Roy"@en'],
    ['"2026-03-29T21:40:00+09:00"', '"2025-03-09T18:20:00-03:00"'],
    ["35.6938", "-49.3315"],
    ["139.7034", "-72.8860"],
  ]).trimEnd()}\n\n<#e-2025-03-14-perito-moreno>\n` +
    `    a dy:IndexEntry ;\n` +
    `    dy:entryResource   <entries/2025-03-14-perito-moreno.ttl#it> ;\n` +
    `    dcterms:title      "Ice calving at Perito Moreno"@en ;\n` +
    `    dy:slug            "2025-03-14-perito-moreno" ;\n` +
    `    dy:occurredAt      "2025-03-14T11:05:00-03:00"^^xsd:dateTime ;\n` +
    `    dy:lat             -50.4967 ;\n` +
    `    dy:long            -73.1377 ;\n` +
    `    dy:precisionMeters 500 ;\n` +
    `    dy:travelModeFrom  dy:Bus ;\n` +
    `    dy:sortOrder       2 .\n`,
);
// The file name IS the slug — lib/pod/read.ts's assertEntrySlug rejects a
// mismatch. The second entry derives from the first so the Patagonian half of
// the fixture is written once.
const elChalten = derive(ENTRY, [
  ['"2026-03-29-arrival"', '"2025-03-09-el-chalten"'],
  ['"First night in Shinjuku"@en', '"Under Fitz Roy"@en'],
  [
    "Landed at 17:20 and took the Narita Express in, which\nwas a mistake at rush hour. Ate standing up at a counter with six seats.",
    "Walked in from the road with the granite still lit, which\nwas worth the five hours. Ate lentil stew standing up, out of the wind.",
  ],
  [
    'schema:datePublished "2026-03-30T08:15:00+09:00"',
    'schema:datePublished "2025-03-10T09:05:00-03:00"',
  ],
  [
    'dcterms:created      "2026-03-29T22:03:44+09:00"',
    'dcterms:created      "2025-03-09T19:44:02-03:00"',
  ],
  [
    'dcterms:modified     "2026-03-30T08:15:00+09:00"',
    'dcterms:modified     "2025-03-10T09:05:00-03:00"',
  ],
  [
    'dy:occurredAt        "2026-03-29T21:40:00+09:00"',
    'dy:occurredAt        "2025-03-09T18:20:00-03:00"',
  ],
  ['dy:tag               "food", "trains"', 'dy:tag               "hiking", "patagonia"'],
  ['schema:name    "Shinjuku, Tokyo"@en', 'schema:name    "El Chaltén"@en'],
  ['schema:addressLocality "Tokyo"@en', 'schema:addressLocality "El Chaltén"@en'],
  ['schema:addressCountry  "JP"', 'schema:addressCountry  "AR"'],
  [
    'schema:caption        "Counter seating, no menu."@en',
    'schema:caption        "Fitz Roy, first light."@en',
  ],
  [
    'schema:dateCreated    "2026-03-29T21:38:02+09:00"',
    'schema:dateCreated    "2025-03-09T18:18:40-03:00"',
  ],
  ["35.6938", "-49.3315"],
  ["139.7034", "-72.8860"],
]);
await put("travel/trips/2025-patagonia/entries/2025-03-09-el-chalten.ttl", elChalten);
await put(
  "travel/trips/2025-patagonia/entries/2025-03-14-perito-moreno.ttl",
  derive(elChalten, [
    ['"2025-03-09-el-chalten"', '"2025-03-14-perito-moreno"'],
    ['"Under Fitz Roy"@en', '"Ice calving at Perito Moreno"@en'],
    [
      "Walked in from the road with the granite still lit, which\nwas worth the five hours. Ate lentil stew standing up, out of the wind.",
      "Stood on the walkways for two hours waiting for the ice to go, and\nit went twice: a crack like a rifle, then the swell crossing the channel.",
    ],
    [
      'schema:datePublished "2025-03-10T09:05:00-03:00"',
      'schema:datePublished "2025-03-15T08:40:00-03:00"',
    ],
    [
      'dcterms:created      "2025-03-09T19:44:02-03:00"',
      'dcterms:created      "2025-03-14T12:31:18-03:00"',
    ],
    [
      'dcterms:modified     "2025-03-10T09:05:00-03:00"',
      'dcterms:modified     "2025-03-15T08:40:00-03:00"',
    ],
    [
      'dy:occurredAt        "2025-03-09T18:20:00-03:00"',
      'dy:occurredAt        "2025-03-14T11:05:00-03:00"',
    ],
    ["dy:travelModeFrom    dy:Flight", "dy:travelModeFrom    dy:Bus"],
    ['dy:tag               "hiking", "patagonia"', 'dy:tag               "glaciers", "patagonia"'],
    ['schema:name    "El Chaltén"@en', 'schema:name    "Perito Moreno glacier"@en'],
    ['schema:addressLocality "El Chaltén"@en', 'schema:addressLocality "El Calafate"@en'],
    [
      'schema:caption        "Fitz Roy, first light."@en',
      'schema:caption        "The face, from the lower walkway."@en',
    ],
    [
      'schema:dateCreated    "2025-03-09T18:18:40-03:00"',
      'schema:dateCreated    "2025-03-14T11:02:55-03:00"',
    ],
    ["-49.3315", "-50.4967"],
    ["-72.8860", "-73.1377"],
  ]),
);

// A draft trip, so the publication boundary can actually be exercised in dev.
// diary.ttl lists it exactly as it lists the published one — there is no index
// acting as a boundary for trips, so the app must filter on dy:status.
await session.fetch(`${POD}travel/trips/2026-secret/`, {
  method: "PUT",
  headers: {
    "content-type": "text/turtle",
    "if-none-match": "*",
    link: `<${NS.ldp}BasicContainer>; rel="type"`,
  },
});
await put(
  "travel/trips/2026-secret/trip.ttl",
  derive(TRIP, [
    ['dy:slug            "2026-japan"', 'dy:slug            "2026-secret"'],
    ["dy:status          dy:Published", "dy:status          dy:Draft"],
    ['schema:name        "Japan, spring"@en', 'schema:name        "Unpublished plans"@en'],
  ]),
);
console.log(`\n  Seeded. Add to .env.local:\n    POD_ROOT=${POD}\n    OWNER_WEBID=${webId}\n`);

// @inrupt/solid-client-authn-node keeps a refresh timer alive; without this
// the script hangs after finishing.
process.exit(0);
