import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { E2E } from "./environment";

/**
 * Drive a real Solid OIDC login against the local Community Solid Server.
 *
 * NOT `*.spec.ts`, and that is load-bearing: playwright.config.ts sets
 * `testDir: "./e2e"`, so anything matching Playwright's default testMatch
 * (`**\/*.@(spec|test).?(c|m)[jt]s?(x)`) in this directory is collected as a
 * suite. A helper named `sign-in.spec.ts` would be loaded as a spec file with
 * no tests in it. Vitest cannot see it either — vitest.config.ts includes only
 * `test/**` and `lib/**`, which test/vitest-collection.test.ts pins.
 *
 * WHAT IT DELIBERATELY DOES NOT DO IS ASSERT. This is the mechanics of the
 * round trip — type the credential, pass the consent screen, come back — and
 * nothing more. e2e/solid-login.spec.ts owns every claim about that flow: that
 * the authorization request carries the published client_id, that the consent
 * screen names the client ID DOCUMENT rather than a dynamically registered
 * handle, that the shell settles on the OWNER branch and not the not-owner one.
 * Extracting the steps must not move those assertions, because the flow is the
 * only real OIDC round trip in this repository and a helper that quietly
 * absorbed its assertions would leave it green while checking less.
 *
 * The one thing it does wait for is a settled signed-in state, because a caller
 * that returns before the shell has resolved would race the studio's own
 * effects. `Sign out` is BRANCH-NEUTRAL — it renders for owner and not-owner
 * alike — so waiting on it does not pre-empt the discrimination that
 * solid-login.spec.ts exists to make.
 */
export async function signInAsOwner(
  page: Page,
  options: {
    /**
     * Called while the consent screen is on screen, before "Authorize" is
     * clicked. The consent screen's contents are the highest-value assertion in
     * the whole flow and they are unreachable once the button is pressed, so
     * the spec that owns them gets a hook rather than a copy of the steps.
     */
    onConsent?: (page: Page) => Promise<void>;
  } = {},
): Promise<URL> {
  await page.goto("/studio");
  await page.getByRole("button", { name: "Sign in" }).click();

  /**
   * `expect(page).toHaveURL` rather than `page.waitForURL`, for the failure
   * message: waitForURL reports "waiting for navigation until load" and leaves
   * you guessing, while this prints the URL the browser is actually sitting on.
   * With a wrong client_id, CSS answers the authorization request with its own
   * "Server error" page, and being told that is the difference between a
   * diagnosis and a timeout.
   */
  await expect(page).toHaveURL(/\/\.account\/login\/password\//);
  await page.getByLabel("Email").fill(E2E.email);
  await page.getByLabel("Password").fill(E2E.password);
  await page.getByRole("button", { name: "Log in" }).click();

  /**
   * The consent screen, and it is NOT conditional.
   * @inrupt/solid-client-authn-browser sends `prompt=consent` on every login
   * (dist/index.mjs: `prompt: oidcLoginOptions.prompt ?? "consent"`), so the
   * provider re-prompts however many times this has run before. Waiting for it
   * unconditionally means that if it is ever skipped the caller FAILS, rather
   * than an `if (visible)` quietly stepping over it.
   */
  await expect(page).toHaveURL(/\/\.account\/oidc\/consent\//);
  await options.onConsent?.(page);

  /** Left unchecked so the run does not accumulate remembered grants on a
   *  shared dev server — and so the consent screen above stays reachable for
   *  the next spec in the file order. */
  await page.getByLabel("Remember this client").uncheck();

  /**
   * The navigation to `redirect_uri` itself, captured before the click:
   * `handleIncomingRedirect` rewrites the address bar once it has consumed the
   * code, so by the time the page settles the query string is gone.
   */
  const back = page.waitForRequest(
    (candidate) =>
      candidate.isNavigationRequest() && candidate.url().startsWith(`${E2E.redirectUri}?`),
  );
  await page.getByRole("button", { name: "Authorize" }).click();
  const returned = new URL((await back).url());

  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  return returned;
}
