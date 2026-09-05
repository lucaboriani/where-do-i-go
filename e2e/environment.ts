/**
 * The one description of the environment `npm run test:e2e` runs against.
 *
 * Imported by BOTH playwright.config.ts (which starts the app with these values
 * in its env) and the spec (which asserts against them). That is the point: a
 * spec holding its own copy of "http://localhost:3000" would keep passing while
 * the config ran the app somewhere else, and the assertion would be a constant
 * compared with itself.
 *
 * Everything here is local and disposable. The `dy:` namespace blocker in
 * CLAUDE.md is about writes to a LIVE Pod; a Community Solid Server on
 * localhost is throwaway data, which is why phase 0.5 seeds it freely.
 */

/** The local Community Solid Server. `npm run pod:dev` puts it here. */
const podBase = (process.env.E2E_POD ?? "http://localhost:3001").replace(/\/+$/, "");

/**
 * The pod name, and therefore the account email too.
 *
 * scripts/seed-dev-pod.ts names the pod `SEED_NAME` (falling back to a
 * timestamp) and creates a password account at `${SEED_NAME}@localhost.test`
 * with the password "dev". Both are derived from this one constant rather than
 * written out twice, so a rename cannot leave the credential pointing at a
 * different account than the pod.
 */
export const SEED_NAME = process.env.E2E_SEED_NAME ?? "e2e";

const port = Number(process.env.E2E_PORT ?? 3000);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`E2E_PORT must be a positive integer, got: ${process.env.E2E_PORT}`);
}

/**
 * WITHOUT a trailing slash, matching lib/config.ts's `siteUrl` getter — every
 * consumer joins a path onto it, and `https://…//client-id.jsonld` is a
 * different URL from `https://…/client-id.jsonld`. A doubled slash there is not
 * cosmetic: the identity provider cannot match the client ID document and
 * silently falls back to dynamic client registration.
 */
const siteUrl = `http://localhost:${port}`;

export const E2E = {
  podBase,
  port,
  siteUrl,

  /** Storage root, trailing slash, matching lib/config.ts's `podRoot`. */
  podRoot: `${podBase}/${SEED_NAME}/`,

  /**
   * The owner, fragment included.
   *
   * NEVER PUT THIS IN A .env FILE UNQUOTED. Next's env loader treats an
   * unquoted `#` as the start of a comment, so `OWNER_WEBID=http://…/card#me`
   * loads as `http://…/card` — the profile DOCUMENT rather than the person.
   * Nothing errors; the studio either reports a shape error with no hint of a
   * fragment, or comes up and locks the owner out of their own diary, because
   * `sameWebId` compares fragments. See .env.example. It is handed to the dev
   * server through `webServer.env` as a real process variable precisely so no
   * dotenv parser ever sees it.
   */
  ownerWebId: `${podBase}/${SEED_NAME}/profile/card#me`,

  /** The seeded password account. Real credentials CSS's login form accepts. */
  email: `${SEED_NAME}@localhost.test`,
  password: "dev",

  /**
   * Deliberately not the value in anyone's .env.local. The consent screen
   * assertion is that CSS fetched the client ID document and rendered the name
   * out of it, so the name has to be one that could only have come from there.
   */
  siteName: "Where I Go e2e",

  /** The two URLs the login round trip turns on. Built here from `siteUrl` the
   *  same way lib/studio/session.ts and app/(public)/client-id.jsonld/route.ts
   *  build them, so the spec can check all three agree. */
  clientId: `${siteUrl}/client-id.jsonld`,
  redirectUri: `${siteUrl}/studio`,
} as const;

/** The env the app under test is started with. One object, so the spec and the
 *  readiness check cannot disagree with the server about which Pod is in play. */
export const appEnv: Record<string, string> = {
  POD_ROOT: E2E.podRoot,
  OWNER_WEBID: E2E.ownerWebId,
  SITE_URL: E2E.siteUrl,
  SITE_NAME: E2E.siteName,
};
