import { beforeAll, describe, expect, it } from "vitest";
import { Parser } from "n3";
import { DY, SCHEMA, STATUS, DY_CLASS, NS } from "@/lib/vocab";

/**
 * TODO.md phase 0.5 "Done when": the local Pod starts and one hand-written
 * resource is read from it.
 *
 * Proves the seam the public path depends on: a resource written by hand is
 * readable with plain `fetch`, no Solid library, no credentials — and parses
 * into the constants lib/vocab.ts exports. Phase 0 verified this holds on both
 * Community Solid Server and Inrupt ESS.
 *
 * Skips unless a Pod is running, so `npm test` stays hermetic. Start one with
 * `npm run pod:dev`.
 */

const BASE = process.env.TEST_POD ?? "http://localhost:3001";
let podUp = false;
let tripUrl = "";

const TRIP = `@prefix xsd:     <${NS.xsd}> .
@prefix schema:  <${NS.schema}> .
@prefix dcterms: <${NS.dcterms}> .
@prefix dy:      <${NS.dy}> .

<#it>
    a schema:TouristTrip, dy:Trip ;
    schema:name      "Japan, spring"@en ;
    dy:schemaVersion 1 ;
    dy:slug          "2026-japan" ;
    dy:status        dy:Published ;
    dy:startDate     "2026-03-28"^^xsd:date .
`;

async function json(url: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `CSS-Account-Token ${token}`;
  const r = await fetch(url, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return r.json() as Promise<Record<string, never>>;
}

beforeAll(async () => {
  try {
    const probe = await fetch(`${BASE}/.account/`);
    podUp = probe.ok;
  } catch {
    podUp = false;
    return;
  }
  if (!podUp) return;

  // Provision a throwaway account + pod, then hand-write one resource into it.
  const acct = await json(`${BASE}/.account/account/`, {});
  const token = acct.authorization as unknown as string;
  const controls = (await json(`${BASE}/.account/`, undefined, token)).controls as unknown as {
    password: { create: string };
    account: { pod: string; clientCredentials: string };
  };
  const name = `verify-${Date.now()}`;
  await json(controls.password.create, { email: `${name}@localhost.test`, password: "throwaway" }, token);
  const pod = (await json(controls.account.pod, { name }, token)) as unknown as { pod: string };

  const cc = (await json(controls.account.clientCredentials, { name, webId: `${pod.pod}profile/card#me` }, token)) as unknown as { id: string; secret: string };
  const { Session } = await import("@inrupt/solid-client-authn-node");
  const session = new Session();
  await session.login({ clientId: cc.id, clientSecret: cc.secret, oidcIssuer: BASE });

  await session.fetch(`${pod.pod}travel/`, {
    method: "PUT",
    headers: { "content-type": "text/turtle", link: `<${NS.ldp}BasicContainer>; rel="type"` },
  });
  await session.fetch(`${pod.pod}travel/.acl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: `@prefix acl: <http://www.w3.org/ns/auth/acl#>.\n@prefix foaf: <${NS.foaf}>.\n<#public> a acl:Authorization; acl:agentClass foaf:Agent; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read.\n<#owner> a acl:Authorization; acl:agent <${pod.pod}profile/card#me>; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read, acl:Write, acl:Control.\n`,
  });
  tripUrl = `${pod.pod}travel/trip.ttl`;
  await session.fetch(tripUrl, {
    method: "PUT",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body: TRIP,
  });
}, 60_000);

describe("the app can read a hand-written resource from the local Pod", () => {
  it("reads it unauthenticated, with no Solid library", async (ctx) => {
    // Report as skipped, not passed. A vacuous pass is worse than no test:
    // it makes the "Done when" gate look green when nothing was verified.
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const res = await fetch(tripUrl, { headers: { accept: "text/turtle" } });
    expect(res.status).toBe(200);

    const quads = new Parser({ baseIRI: tripUrl }).parse(await res.text());
    const value = (predicate: string) =>
      quads.find((q) => q.predicate.value === predicate)?.object.value;

    expect(value(SCHEMA.name)).toBe("Japan, spring");
    expect(value(DY.slug)).toBe("2026-japan");
    expect(value(DY.status)).toBe(STATUS.Published);
    expect(value(DY.schemaVersion)).toBe("1");
    expect(quads.some((q) => q.object.value === DY_CLASS.Trip)).toBe(true);
  });
});
