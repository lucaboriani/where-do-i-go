import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

/**
 * HTTP-level fakes, per TODO.md phase 0.5: fake the Pod at the HTTP layer, not
 * by stubbing Inrupt functions. The read path uses plain fetch, so this is the
 * seam that matters — and `onUnhandledRequest: "error"` means an accidental
 * real network call fails the test instead of quietly succeeding.
 */
export const server = setupServer();

/** Turtle body, or a bare status code for the failure cases. */
export function servePod(routes: Record<string, string | number>) {
  server.use(
    ...Object.entries(routes).map(([url, body]) =>
      http.get(url, () =>
        typeof body === "number"
          ? new HttpResponse(null, { status: body })
          : HttpResponse.text(body, {
              headers: { "content-type": "text/turtle", etag: '"v1"' },
            }),
      ),
    ),
  );
}
