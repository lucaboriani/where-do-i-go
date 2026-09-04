import { expect, it } from "vitest";

/**
 * NOT part of the suite. Named `.spec.ts` so vitest.config.ts's
 * `test/**\/*.test.ts` does not pick it up; run deliberately, in a child
 * process, by test/network-guard.test.ts via test/fixtures/vitest.config.ts.
 *
 * It exists to be a test that WOULD pass while reaching for the network, so
 * that the sweep in test/setup.ts can be shown to fail it anyway.
 *
 * Throwing from `onUnhandledRequest` does not reject the fetch — msw 2.15 turns
 * a plain Error into a 500 "Unhandled Exception" response. lib/pod/read.ts
 * turns any non-2xx into a structured error and never throws, by design, so a
 * caller shaped like the one below receives the guard's 500, handles it
 * politely, asserts something true about it and goes green. Measured: with the
 * throw alone and no sweep, this passed.
 */
it("swallows the blocked response and asserts nothing about the network", async () => {
  const res = await fetch("https://swallowed.example/thing.ttl");
  const outcome = res.ok ? "ok" : `http ${res.status}`;
  expect(outcome).toBeTypeOf("string");
});
