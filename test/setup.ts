import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw";

beforeAll(() =>
  server.listen({
    // An accidental real network call must fail the test, not quietly succeed.
    // The exception is localhost: the Pod integration test talks to a real
    // Community Solid Server on purpose, and MSW must let it through.
    onUnhandledRequest(request, print) {
      if (new URL(request.url).hostname === "localhost") return;
      print.error();
    },
  }),
);
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
