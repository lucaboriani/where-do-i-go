import { afterAll, afterEach, beforeAll } from "vitest";
/**
 * jest-dom's matchers, registered on vitest's `expect`. A side-effect import,
 * and the `/vitest` entry point rather than the bare package: that one calls
 * `expect.extend` against vitest's expect and ships the type augmentation, so
 * `toBeInTheDocument()` typechecks as well as runs.
 *
 * Loaded here rather than in a second setup file so it cannot be added to one
 * config and forgotten in test/fixtures/vitest.config.ts, which mirrors this
 * one. It costs the node-environment tests an import and nothing else; the
 * matchers are only ever reached from a jsdom file. test/studio-shell.test.tsx
 * pins that they are really loaded, positively and negatively — an unloaded
 * matcher and a matcher that always passes are different failures.
 */
import "@testing-library/jest-dom/vitest";
import { server } from "./msw";
import {
  isLoopback,
  noteStrayRequest,
  strayRequestMessage,
  straySweepMessage,
  takeStrayRequests,
} from "./network-guard";

beforeAll(() =>
  server.listen({
    // An accidental real network call must fail the test, not quietly succeed.
    // The exception is loopback: the Pod integration tests talk to a real
    // Community Solid Server on this machine on purpose, and MSW must let them
    // through. See test/network-guard.ts for why the exemption is three
    // spellings rather than just "localhost".
    //
    // This THROWS rather than calling print.error(). print.error() writes to
    // stderr, vitest does not fail on stderr, and msw 2.15 explicitly
    // downgraded the print defaults so they "do not affect the frame
    // resolution" — so the request went out to the live internet and the test
    // passed. Pinned by test/network-guard.test.ts.
    onUnhandledRequest(request) {
      if (isLoopback(new URL(request.url).hostname)) return;
      noteStrayRequest(request.method, request.url);
      throw new Error(strayRequestMessage(request.method, request.url));
    },
  }),
);

afterEach(() => {
  // Drained first: the throw above only makes the request itself fail, and a
  // caller that tolerates a non-2xx response can still swallow it. This makes
  // the stray fail the test that made it, whatever it did with the response.
  const strays = takeStrayRequests();
  server.resetHandlers();
  if (strays.length > 0) throw new Error(straySweepMessage(strays));
});

afterAll(() => server.close());
