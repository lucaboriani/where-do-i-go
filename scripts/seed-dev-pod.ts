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
const r = await fetch(url, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
if (!r.ok) throw new Error(`${url} -> ${r.status}`);
return r.json();
};

// Unique per run: CSS rejects a duplicate pod name, and re-seeding after a
// failed attempt is the common case. Override with SEED_NAME.
const name = process.env.SEED_NAME ?? `dev-${Date.now().toString(36)}`;
const acct = await api(`${BASE}/.account/account/`, {});
const token = acct.authorization as string;
const controls = (await api(`${BASE}/.account/`, undefined, token)).controls;
await api(controls.password.create, { email: `${name}@localhost.test`, password: "dev" }, token).catch(() => {});
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

for (const c of ["travel/", "travel/trips/", "travel/trips/2026-japan/", "travel/trips/2026-japan/entries/"]) {
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

// One trip only: the fixture diary lists a second that does not exist here.
await put(
  "travel/diary.ttl",
  DIARY.replace(/\s*,\s*<trips\/2025-patagonia\/trip\.ttl#it>/, "").replace(
    "<trips/2026-japan/trip.ttl#it> .",
    "<trips/2026-japan/trip.ttl#it> ,\n                        <trips/2026-secret/trip.ttl#it> .",
  ),
);
await put("travel/trips/2026-japan/trip.ttl", TRIP);
await put("travel/trips/2026-japan/entries.ttl", INDEX);
await put("travel/trips/2026-japan/entries/2026-03-29-arrival.ttl", ENTRY);

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
  TRIP.replace('dy:slug            "2026-japan"', 'dy:slug            "2026-secret"')
    .replace("dy:status          dy:Published", "dy:status          dy:Draft")
    .replace('schema:name        "Japan, spring"@en', 'schema:name        "Unpublished plans"@en'),
);
console.log(`\n  Seeded. Add to .env.local:\n    POD_ROOT=${POD}\n    OWNER_WEBID=${webId}\n`);

// @inrupt/solid-client-authn-node keeps a refresh timer alive; without this
// the script hangs after finishing.
process.exit(0);
