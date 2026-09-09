import { expect, test } from "@playwright/test";
import { E2E } from "./environment";
import { signInAsOwner } from "./sign-in";

/**
 * The Solid login redirect — the one flow Playwright exists for in this project.
 *
 * WHY A BROWSER IS NECESSARY HERE AND NOWHERE ELSE. Everything else the studio
 * does is already pinned by fast tests: components/studio/studio-shell/studio-shell.test.tsx covers
 * restoring, signed-out, owner, not-owner and the expiry subscription against
 * an injected plain-object session, and test/session.test.ts covers signIn's
 * arguments. What none of them can reach is what an actual identity provider
 * DOES with those arguments — and the failure that matters is silent. Phase 0
 * found that when the provider cannot use the static client ID document, login
 * falls back to DYNAMIC CLIENT REGISTRATION: the flow still completes, nothing
 * throws and no status code is wrong. There is no unit test of a screen on
 * someone else's server.
 *
 * THE FILES ARE NAMED AND NO TOTAL IS GIVEN. This line said "23 component
 * tests" until 2026-09-06, by which point `vitest list` reported 26 — the
 * THIRD place on this branch found carrying that same stale number, after
 * CLAUDE.md (fixed in 3c751c6, which also wrote the rule: name the file, do
 * not reintroduce a total) and playwright.config.ts. A count in prose goes
 * wrong the next time a test is added and nothing anywhere checks it, which
 * is exactly why it went wrong three times. Let `vitest list` count.
 *
 * AND WHY IT IS TESTABLE AT ALL, WHICH PHASE 0 SAID IT WAS NOT. The provider
 * has to fetch `client-id.jsonld` over the network, so a dev machine cannot
 * exercise this against a hosted Pod — localhost is not reachable from
 * login.inrupt.com. Against a Community Solid Server on the same machine it is:
 * both ends are localhost, CSS really does fetch the document, and the consent
 * screen below really does render out of it. That makes the static client ID
 * path verifiable here and, locally, nowhere else.
 *
 * WHAT THE FALLBACK ACTUALLY LOOKS LIKE, MEASURED RATHER THAN QUOTED. Phase 0
 * recorded it as "a bare UUID instead of the app name". Against CSS 7.2 that is
 * not what happens, and the difference matters because it decides which
 * assertion below does the work. Deleting the `clientId` argument from
 * lib/studio/session.ts and running this spec produced a consent screen reading
 *
 *     Name  Where I Go e2e        ID  FruZ8UCqY2QwZdac1kd0b
 *
 * The NAME SURVIVES — @inrupt/solid-client-authn-browser forwards `clientName`
 * into the dynamic registration, so the provider has it either way. What
 * changes is the ID: a 21-character opaque registration handle in place of the
 * document's URL, and not a dashed UUID either. So an assertion on the name
 * proves only that we are on the right consent screen, and an assertion looking
 * for a UUID matches nothing at all. The line that discriminates is the one on
 * the ID, and it is written as an exact match for that reason.
 *
 * WHAT IS DELIBERATELY NOT HERE. No coverage of the editor, the drawer, the
 * map, or any studio state that a component test can reach. A slow duplicate of
 * a fast test is worse than no test.
 */

/** The `<dl>` CSS's consent screen renders the requesting client into. */
const CONSENT_CLIENT = "#client";

/** The `<dd>` holding the client identifier, addressed through its own `<dt>`
 *  rather than by position, so the assertion cannot silently start reading the
 *  name cell if CSS ever reorders the pair. */
const CONSENT_CLIENT_ID = 'dt:text-is("ID") + dd';

test.describe("the Solid login redirect", () => {
  test("sends the browser to the owner's identity provider with the client ID the app publishes", async ({
    page,
    request,
  }) => {
    /**
     * The document the identity provider will fetch, asserted STATUS AND BODY.
     * A 200 alone is what once let a zero-byte 404 ship in this repository; and
     * a client ID document that resolves but says the wrong thing is precisely
     * the dynamic-registration fallback, so the body is the whole point.
     */
    const published = await request.get("/client-id.jsonld");
    expect(published.status(), await published.text()).toBe(200);
    const document: Record<string, unknown> = await published.json();

    /**
     * Against the environment's own constants, NOT only against each other.
     *
     * The comparison further down — what the browser sent versus what this
     * document says — is the drift check, and on its own it is satisfiable by
     * changing both ends the same wrong way (both to `/client-id.json`, say).
     * These three pin the pair to an absolute value derived independently of
     * the app, so a matching pair of mistakes still fails.
     */
    expect(document.client_id).toBe(E2E.clientId);
    expect(document.redirect_uris).toEqual([E2E.redirectUri]);
    expect(document.client_name).toBe(E2E.siteName);

    await page.goto("/studio");

    /**
     * The signed-out branch of the shell. Its presence is already the first
     * assertion of the run: reaching it means the server component read the
     * owner's WebID document off the Pod and found `solid:oidcIssuer` (§7.5 —
     * there is no OIDC_ISSUER env var), because without an issuer
     * app/(studio)/studio/page.tsx renders "the studio cannot open" and there
     * is no button at all.
     */
    const signIn = page.getByRole("button", { name: "Sign in" });
    await expect(signIn).toBeVisible();

    /**
     * Caught as a request rather than read off `page.url()`: the provider
     * immediately redirects the authorization endpoint on to its login page, so
     * by the time the page settles the query string is gone.
     */
    const authorization = page.waitForRequest(
      (candidate) => new URL(candidate.url()).pathname === "/.oidc/auth",
    );
    await signIn.click();
    const authorizationUrl = new URL((await authorization).url());
    const params = authorizationUrl.searchParams;

    /** The endpoint was discovered from the issuer in the owner's profile, so
     *  this also pins that the issuer came out of the Pod and not from a guess. */
    expect(authorizationUrl.origin).toBe(E2E.podBase);

    /**
     * THE TWO VALUES THE WHOLE FLOW TURNS ON. They are built in two different
     * files from two different copies of the origin —
     * app/(public)/client-id.jsonld/route.ts interpolates `config.siteUrl`, and
     * lib/studio/session.ts interpolates a `siteUrl` prop threaded down through
     * the server component and two client components — so they genuinely can
     * drift. When they do, nothing errors: the provider cannot match the
     * document and registers a throwaway client instead.
     */
    expect(params.get("client_id")).toBe(document.client_id);
    expect(params.get("redirect_uri")).toBe((document.redirect_uris as string[])[0]);

    /** Solid-OIDC, with PKCE and a public client. Not decoration: `webid` in
     *  the scope is what makes the token carry a WebID at all, and losing S256
     *  would be a security regression no other test would notice. */
    expect(params.get("response_type")).toBe("code");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("scope")?.split(" ")).toEqual(
      expect.arrayContaining(["openid", "webid", "offline_access"]),
    );
  });

  test("logs the owner in through the real provider and comes back to the owner studio", async ({
    page,
  }) => {
    /**
     * THE STEPS MOVED TO e2e/sign-in.ts; THE ASSERTIONS DID NOT.
     *
     * e2e/media-pipeline.spec.ts needs a signed-in owner studio, and a second
     * copy of this flow would be a second thing to keep in step with CSS. What
     * the helper does NOT do is assert: it types the credential, passes the
     * consent screen and waits for a settled signed-in state, and every claim
     * this spec makes about the round trip is still made here — the consent
     * screen through the `onConsent` hook, because that screen is gone the
     * instant "Authorize" is pressed, and the rest below.
     */
    const returned = await signInAsOwner(page, {
      async onConsent(consenting) {
        const client = consenting.locator(CONSENT_CLIENT);

        /**
         * A smoke check, and no more than that. See the header: the name is
         * forwarded into a dynamic registration too, so it is identical on both
         * paths. It is here because it says we are looking at THIS application's
         * consent screen, not because it discriminates.
         */
        await expect(client).toContainText(E2E.siteName);

        /**
         * THE HIGHEST-VALUE ASSERTION AVAILABLE HERE, and the one phase 0 could
         * not make from a dev machine.
         *
         * `toHaveText`, not `toContainText`: an exact match on the whole cell.
         * On the static path this is the URL of the document the provider
         * fetched; on the dynamic-registration fallback it is a short opaque
         * handle the provider minted, which contains the URL nowhere. That
         * single cell is therefore the whole difference between "the identity
         * provider used the client ID document this app publishes" and "the
         * identity provider could not, and quietly registered a throwaway
         * client instead" — a login that still works, which is exactly why
         * nothing else catches it.
         */
        await expect(client.locator(CONSENT_CLIENT_ID)).toHaveText(E2E.clientId);
      },
    });

    /** An authorization code really came back to the URL the client ID document
     *  advertises — the round trip closed, rather than the provider bouncing us
     *  somewhere else. */
    expect(returned.searchParams.get("code")).toBeTruthy();
    expect(returned.searchParams.get("iss")).toBe(`${E2E.podBase}/`);

    /**
     * And the shell resolved to the OWNER branch.
     *
     * Two failures are being excluded at once here.
     *
     * `Signed in as …` rather than merely "some signed-in state" is the owner
     * branch specifically; the not-owner branch reads "You are signed in as X;
     * this diary belongs to Y". That distinction is exactly what breaks when
     * OWNER_WEBID loses its `#me` — the fragment-eaten-as-a-comment trap in
     * .env.example — because `sameWebId` compares fragments and the owner is
     * locked out of their own diary with no error anywhere. The explicit
     * absence of the not-owner wording below is what makes that failure loud
     * here instead of merely different.
     *
     * It is asserted HERE and not inside the helper on purpose. The helper
     * waits for `Sign out`, which renders on the owner and not-owner branches
     * alike, so nothing it does pre-empts this discrimination.
     *
     * And reaching a settled signed-in state at all is the StrictMode path from
     * docs/phase-0-spike.md question 2: under a development React build the
     * effect runs twice, phase 0 measured the FIRST handleIncomingRedirect
     * returning `isLoggedIn: false` and the second `true`, and `restoreSession`
     * memoises synchronously so both invocations read the same answer. Delete
     * that memo and this ends on the sign-in button — which is why the last
     * line asserts the button is gone rather than assuming it.
     */
    await expect(page.getByText(`Signed in as ${E2E.ownerWebId}.`)).toBeVisible();
    await expect(page.getByText("this diary belongs to")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  });
});
