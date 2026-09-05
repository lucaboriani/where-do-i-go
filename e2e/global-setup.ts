/**
 * Make the environment ready, or stop the run and say exactly what is missing.
 *
 * THIS NEVER SKIPS. A green e2e run that exercised nothing is this project's
 * signature failure (CLAUDE.md, "a green run that verified nothing"), and it is
 * the one that a `if (!podUp) return` in here would reintroduce at the widest
 * possible scope — every spec reported as passed, none of them run. So every
 * branch below either fixes the problem or throws, and Playwright aborts the
 * run with the message.
 *
 * WHEN THIS RUNS, relative to the app. Playwright builds its startup tasks as
 * `plugin setup` first and `globalSetup` after (verified in
 * node_modules/playwright/lib/runner/index.js — createGlobalSetupTasks lists
 * createPluginSetupTasks before config.globalSetups), and `webServer` is a
 * plugin. So THE APP IS ALREADY RUNNING when this file executes, and it cannot
 * be used to seed the Pod before the app first reads it.
 *
 * That is why playwright.config.ts points `webServer.url` at
 * `/client-id.jsonld`: it is the one route that reads no Pod at all. The
 * readiness probe therefore cannot render a page against an unseeded Pod and
 * bake the failure into a `use cache` entry that every later test then reads
 * (decisions.md §22 — Cache Components is on, and `getOwnerProfile` is cached).
 * If that URL is ever changed to `/`, this ordering becomes a live bug.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { E2E, SEED_NAME } from "./environment";

/** Loud, and with the fix in the message: whoever sees this is looking at a
 *  Playwright stack frame, not at this file. */
function fail(what: string, fix: string[]): never {
  throw new Error(
    [`e2e environment is not ready: ${what}`, "", ...fix.map((line) => `  ${line}`), ""].join("\n"),
  );
}

async function status(url: string): Promise<number> {
  try {
    const response = await fetch(url);
    return response.status;
  } catch {
    return 0;
  }
}

async function requirePodServer(): Promise<void> {
  const code = await status(`${E2E.podBase}/.account/`);
  if (code === 0) {
    fail(`nothing is listening at ${E2E.podBase}`, [
      "The login flow is driven against a real Community Solid Server. Start one:",
      "",
      "    npm run pod:dev",
      "",
      "and leave it running, then re-run npm run test:e2e.",
      `Point the tests somewhere else with E2E_POD=<origin> if the server is not on ${E2E.podBase}.`,
    ]);
  }
  if (code !== 200) {
    fail(`${E2E.podBase}/.account/ answered ${code}, not 200`, [
      "Something is listening there, but it does not look like a Community Solid Server 7.x",
      "account API. Check what is on that port.",
    ]);
  }
}

/** Run the repository's own seeder rather than reimplementing it — it is what
 *  `npm run pod:seed` runs, and it reads the normative §7 fixtures out of
 *  docs/data-model.md. A second copy here would seed a copy of the spec. */
function runSeeder(): { ok: boolean; output: string } {
  const tsx = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
  const script = fileURLToPath(new URL("../scripts/seed-dev-pod.ts", import.meta.url));
  const run = spawnSync(process.execPath, [tsx, script], {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, SEED_NAME, SEED_POD: E2E.podBase },
  });
  return { ok: run.status === 0, output: `${run.stdout ?? ""}${run.stderr ?? ""}`.trim() };
}

async function requireSeededPod(): Promise<void> {
  const diary = `${E2E.podRoot}travel/diary.ttl`;
  if ((await status(diary)) === 200) {
    console.log(`[e2e] pod already seeded at ${E2E.podRoot}`);
    return;
  }

  console.log(`[e2e] seeding ${E2E.podRoot} (SEED_NAME=${SEED_NAME})`);
  const seed = runSeeder();
  if (!seed.ok) {
    fail(`seeding ${E2E.podRoot} failed`, [
      "scripts/seed-dev-pod.ts exited non-zero. Its output:",
      "",
      ...seed.output.split("\n"),
      "",
      "The usual cause is a half-created pod from an interrupted run: the pod name is taken",
      "but its contents are missing, and CSS refuses to create it again. Remove the pod's",
      `directory (.pod-data/${SEED_NAME}/) and its account, or run with`,
      "E2E_SEED_NAME=<something-else>.",
    ]);
  }

  // Status AND body: the seeder exiting 0 is not the same as the resource being
  // there and readable unauthenticated, which is what the app actually does.
  const after = await status(diary);
  if (after !== 200) {
    fail(`${diary} answered ${after} after seeding`, [
      "The seeder reported success but the diary is not publicly readable. The public path",
      "reads the Pod with plain unauthenticated fetch, so a 401 here means the ACL the seeder",
      "writes did not take effect.",
      "",
      ...seed.output.split("\n"),
    ]);
  }
}

/** The studio reads the issuer out of the owner's WebID document (§7.5) — there
 *  is deliberately no OIDC_ISSUER env var — so if this is missing there is no
 *  sign-in button to click and the spec would fail somewhere far less obvious. */
async function requireOwnerProfile(): Promise<void> {
  const card = `${E2E.podRoot}profile/card`;
  const response = await fetch(card).catch(() => null);
  if (response === null || response.status !== 200) {
    fail(`${card} answered ${response?.status ?? "no response"}, not 200`, [
      "The owner's WebID document must be publicly readable — the studio's server component",
      "reads it unauthenticated to find the identity provider.",
    ]);
  }
  const body = await response.text();
  if (!body.includes("oidcIssuer")) {
    fail(`${card} carries no solid:oidcIssuer`, [
      "app/(studio)/studio/page.tsx renders 'the studio cannot open' without it, and there is",
      "no sign-in control to drive. The document that was served:",
      "",
      ...body.split("\n"),
    ]);
  }
}

/** The credential the spec types into CSS's login form. Checked through the
 *  account API first, because a failure here is otherwise indistinguishable
 *  from a broken redirect: both end with the browser sitting on a login page. */
async function requireOwnerCredential(): Promise<void> {
  const login = `${E2E.podBase}/.account/login/password/`;
  const response = await fetch(login, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email: E2E.email, password: E2E.password }),
  }).catch(() => null);

  const body: unknown = response === null ? null : await response.json().catch(() => null);
  const authorized =
    response?.status === 200 &&
    typeof body === "object" &&
    body !== null &&
    typeof (body as { authorization?: unknown }).authorization === "string";

  if (!authorized) {
    fail(`${E2E.email} cannot log in to ${E2E.podBase}`, [
      `CSS answered ${response?.status ?? "nothing"} with ${JSON.stringify(body)}.`,
      "",
      "scripts/seed-dev-pod.ts creates this account, but it SWALLOWS a failure from the",
      "password-create call (`.catch(() => {})`), so a pod can exist with no usable login —",
      "typically because the email was already registered to an earlier account.",
      `Remove the account for ${E2E.email}, or run with E2E_SEED_NAME=<something-else>.`,
    ]);
  }
}

export default async function globalSetup(): Promise<void> {
  await requirePodServer();
  await requireSeededPod();
  await requireOwnerProfile();
  await requireOwnerCredential();
  console.log(`[e2e] ready: pod ${E2E.podRoot}, owner ${E2E.ownerWebId}, app ${E2E.siteUrl}`);
}
