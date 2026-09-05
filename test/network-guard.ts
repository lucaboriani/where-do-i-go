/**
 * The rule `test/setup.ts` applies to a request no MSW handler matched.
 *
 * Split out of setup.ts so it can be exercised by test/network-guard.test.ts,
 * which is the point: the previous guard printed a message instead of failing
 * anything, and stayed that way for as long as nothing tested it.
 */

/**
 * Loopback — the same machine, unreachable from the internet, so letting it
 * out costs the guard nothing.
 *
 * Three spellings, matched whole. `localhost` alone was too narrow:
 *
 *  - Both Pod integration tests read `process.env.TEST_POD ?? "http://localhost:3001"`.
 *    Setting `TEST_POD=http://127.0.0.1:3001` — the ordinary way to force IPv4
 *    when `localhost` resolves to `::1` first — would have turned a legitimate
 *    integration run into a guard failure with a very confusing message.
 *  - `[::1]` is how the WHATWG URL parser spells the IPv6 loopback in
 *    `.hostname`, brackets included. `new URL("http://[::1]:3001/").hostname`
 *    is the string `"[::1]"`, not `"::1"`.
 *
 * Deliberately no broader than that: no suffix match, no 127.0.0.0/8 range, no
 * `.localhost` subdomains, no `0.0.0.0`. Nothing in this repo uses them, and an
 * exemption nobody exercises is untested surface on the one rule whose job is
 * to be strict. `sub.localhost` and `localhost.example.com` are not loopback
 * and stay blocked — test/network-guard.test.ts pins that.
 */
export function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * What to do about it. Whoever trips this will be looking at a stack frame from
 * inside MSW, so the message has to carry the whole diagnosis by itself.
 */
function advice(exampleUrl: string): string {
  return [
    "No MSW handler matched it, and only loopback (localhost, 127.0.0.1, [::1])",
    "is allowed to leave this process. Pick one:",
    "",
    `  - add an MSW handler for it — servePod({ "${exampleUrl}": "<turtle>" }) from`,
    "    test/msw.ts for a Pod resource, or server.use(http.get(...)) for anything else;",
    "  - if the URL is only ever a string and nothing should fetch it, keep it on a",
    "    reserved host (.test, .example, .invalid) so a slip cannot reach a real server;",
    "  - if it genuinely is the local Pod, address it as localhost, 127.0.0.1 or [::1].",
    "",
    "Raised by test/setup.ts, not by MSW. The stack below is MSW's plumbing — the",
    "cause is a fetch in the test that was running.",
  ].join("\n");
}

/** The message the blocked request itself carries back to the caller. */
export function strayRequestMessage(method: string, url: string): string {
  return `Blocked a real network request from the test suite: ${method} ${url}\n\n${advice(url)}`;
}

/** The message the afterEach sweep raises, listing everything the test leaked. */
export function straySweepMessage(strays: readonly string[]): string {
  return [
    `Blocked a real network request from the test suite — ${strays.length} of them,`,
    "made by the test that just finished:",
    "",
    ...strays.map((s) => `  - ${s}`),
    "",
    advice(strays[0]?.split(" ").at(-1) ?? "https://pod.example/thing.ttl"),
  ].join("\n");
}

/**
 * Strays seen since the last drain.
 *
 * Belt to the throw's braces. Throwing from `onUnhandledRequest` does not
 * reject the fetch: msw 2.15 turns a plain Error into a 500 "Unhandled
 * Exception" response, and only its own unexported `InternalError` produces a
 * true network error (node_modules/msw/lib/core/experimental/sources/interceptor-source.js).
 * lib/pod/read.ts converts every non-2xx into a structured error and never
 * throws — by design — so a test could receive that 500, handle it politely and
 * pass. Measured: a test asserting only `!res.ok` passed while the guard was
 * firing. setup.ts drains this in afterEach and fails the test that made the
 * call, whatever the caller did with the response.
 */
const strays: string[] = [];

export function noteStrayRequest(method: string, url: string): void {
  strays.push(`${method} ${url}`);
}

/** Returns and clears. setup.ts calls this in afterEach; the guard's own test
 *  calls it to assert what was recorded, which is also how that test avoids
 *  failing on the strays it makes on purpose. */
export function takeStrayRequests(): string[] {
  return strays.splice(0);
}
