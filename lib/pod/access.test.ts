import { describe, expect, it, vi } from "vitest";
import { describe as renderError } from "@/lib/pod/result";
import type { Result } from "@/lib/pod/result";
import {
  applyDocumentPublicRead,
  createContainer,
  getAccess,
  initialiseContainers,
  makePrivate,
  makePublic,
  resolveContainerAcl,
  serverListingContradiction,
} from "@/lib/pod/access";
import type { AccessState } from "@/lib/pod/access";

/**
 * The §5 access-control interface, at the HTTP boundary.
 *
 * WHY THE SEAM IS THE INJECTED FETCH AND NOT MSW HANDLERS. Everything else in
 * this suite fakes the Pod with MSW, because the read path is plain `fetch` and
 * MSW is exactly that seam. Access control is not plain fetch: it is a
 * multi-step negotiation (resource info -> ACR or ACL discovery -> read -> write
 * -> read back), and its request sequence is a property of the library version,
 * not of this project. A handler set convincing enough to drive it would encode
 * @inrupt/solid-client 3.0.0's internals and would go green or red on an upgrade
 * for reasons that have nothing to do with our behaviour.
 *
 * So these tests fake the Pod at the same layer — HTTP — through the `fetch`
 * the interface already takes, and they assert only what is true of ANY correct
 * implementation regardless of how many round trips it makes:
 *
 *   1. a typed value or a structured PodError, never a throw (§11 guardrail 2);
 *   2. no false success — in particular against a server that answers 2xx to
 *      everything and stores nothing, which is precisely what phase 0 warned
 *      about: "a 2xx on an ACL write proves nothing" (docs/phase-0-spike.md);
 *   3. the caller's fetch is the only fetch used.
 *
 * The real access semantics — inheritance to children, the closed container
 * listing, the per-resource draft override — are not assertable against a fake
 * that has no access-control engine in it. They live in
 * test/pod-access.integration.test.ts, against a real Community Solid Server,
 * where the only evidence that counts is a failed read from a logged-out
 * context.
 *
 * MSW is still doing work here: test/setup.ts fails any unhandled real request,
 * so an implementation that reaches for the ambient `fetch` instead of the one
 * it was handed cannot pass by accident.
 */

const POD = "https://pod.test.example/";
const DOC = `${POD}travel/trips/2026-japan/trip.ttl`;
const CONTAINER = `${POD}travel/trips/2026-japan/`;
const WEBID = `${POD}profile/card#me`;

type FetchInput = RequestInfo | URL;

const urlOf = (input: FetchInput) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const methodOf = (input: FetchInput, init?: RequestInit) =>
  (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();

type FakeFetch = (input: FetchInput, init?: RequestInit) => Promise<Response>;

/** A Pod that refuses everything: the deployer whose credentials lack Control. */
const refusing = () =>
  vi.fn<FakeFetch>(async () => new Response(null, { status: 403, statusText: "Forbidden" }));

/**
 * The dangerous one. Answers 2xx to every request, stores nothing, and exposes
 * no access control at all. Phase 0's finding in fake form: an implementation
 * that treats a 2xx on the write as proof reports success here, and the diary
 * ships either unreadable or with a draft public.
 */
const yesMan = () =>
  vi.fn<FakeFetch>(async (input, init) => {
    const method = methodOf(input, init);
    return new Response(method === "HEAD" ? null : "", {
      status: method === "PUT" || method === "POST" ? 201 : 200,
      headers: { "content-type": "text/turtle", etag: '"unchanging"' },
    });
  });

/** The Pod is unreachable — the caller's fetch rejects. */
const unreachable = () =>
  vi.fn<FakeFetch>(async () => {
    throw new TypeError("fetch failed");
  });

/** Every method of the §5 interface, so each contract is asserted for all four
 *  rather than for whichever one happened to get a test. */
const CALLS: [name: string, call: (fetch: typeof globalThis.fetch) => Promise<Result<unknown>>][] = [
  ["makePublic", (fetch) => makePublic(DOC, { fetch })],
  ["makePrivate", (fetch) => makePrivate(DOC, { fetch })],
  ["getAccess", (fetch) => getAccess(DOC, { fetch })],
  ["initialiseContainers", (fetch) => initialiseContainers({ fetch, podRoot: POD, webId: WEBID })],
  // createContainer is the fifth exported operation and it writes: it creates a
  // container AND sets its access as one step, so every contract the other four
  // are held to applies to it too. Left out of this list it was exported with no
  // test at all.
  ["createContainer", (fetch) => createContainer(CONTAINER, { fetch, webId: WEBID })],
];

async function settle<T>(promise: Promise<T>): Promise<{ returned?: T; threw?: unknown }> {
  try {
    return { returned: await promise };
  } catch (threw) {
    return { threw };
  }
}

describe("the §5 interface returns results, never throws", () => {
  it.each(CALLS)("%s reports an unreachable Pod as a structured error", async (_name, call) => {
    const fetch = unreachable();
    const settled = await settle(call(fetch));

    // A throw is not a structured error. The studio has to render something.
    expect(settled.threw).toBeUndefined();
    const r = settled.returned;
    expect(r?.ok).toBe(false);
    if (!r || r.ok) return;

    expect(r.error.kind).toBe("network");
    expect(r.error.url.startsWith(POD)).toBe(true);
    // The cause survives into the message: "could not reach the Pod" with no
    // reason is what makes this class of failure unreportable by a deployer.
    expect(renderError(r.error)).toContain("fetch failed");
  });

  it.each(CALLS)("%s reports refusal as an http error carrying the status", async (_name, call) => {
    const fetch = refusing();
    const settled = await settle(call(fetch));

    expect(settled.threw).toBeUndefined();
    const r = settled.returned;
    expect(r?.ok).toBe(false);
    if (!r || r.ok) return;

    // Same error vocabulary as the read path (lib/pod/result.ts): a caller
    // distinguishing "forbidden" from "absent" reads error.status, and on ESS an
    // anonymous 401 does not distinguish private from missing (phase 0).
    expect(r.error.kind).toBe("http");
    if (r.error.kind !== "http") return;
    expect(r.error.status).toBe(403);
    expect(r.error.url.startsWith(POD)).toBe(true);
  });
});

describe("a 2xx is not evidence that access was applied", () => {
  /**
   * §5: initialiseContainers must "verify the resulting access rather than
   * assuming the writes took effect", and phase 0 is the reason the sentence is
   * there. This server says yes to everything and remembers nothing, so the
   * truthful answer for all four methods is "no, and here is why" — never ok.
   */
  it.each(CALLS)("%s does not report success against a server that stores nothing", async (_name, call) => {
    const fetch = yesMan();
    const settled = await settle(call(fetch));

    expect(settled.threw).toBeUndefined();
    const r = settled.returned;
    expect(r?.ok).toBe(false);
    if (!r || r.ok) return;

    // Whatever kind it is, it must be a member of the PodError union — i.e.
    // renderable by lib/pod/result.ts's describe(), which has no default case.
    // An ad-hoc { message } object is not a structured error.
    expect(typeof renderError(r.error)).toBe("string");
    expect(renderError(r.error).length).toBeGreaterThan(0);
    expect(r.error.url.startsWith(POD)).toBe(true);

    /**
     * AND THE KIND, which is the part this test was missing.
     *
     * "expect(r.ok).toBe(false)" passes on any failure whatsoever — including
     * the ones that mean something else entirely. A `network` here would mean
     * the module never reached the fake at all; an `http` would mean it read a
     * status it should never have seen, since this server answers 2xx to
     * everything. The only truthful kind against a server that says yes and
     * stores nothing is `accessUnverified`: the write was accepted and the
     * result could not be confirmed. lib/pod/result.ts documents it as exactly
     * that — "the request may well have returned 2xx".
     */
    expect(r.error.kind).toBe("accessUnverified");
    if (r.error.kind !== "accessUnverified") return;

    // The SHAPE, not just the kind. `accessUnverified` carries what was asked
    // for and what came back; a studio that renders "could not verify" with
    // neither is telling the owner nothing they can act on.
    expect(r.error.expected.length).toBeGreaterThan(0);
    expect(r.error.found.length).toBeGreaterThan(0);
    expect(r.error.expected).not.toBe(r.error.found);
    expect(renderError(r.error)).toContain(r.error.expected);
    expect(renderError(r.error)).toContain(r.error.found);
  });

  it("getAccess reports 'could not determine', not a confident 'not public'", async () => {
    // The lie this guards against: a studio that shows a trip as private
    // because the access could not be read. Absence of evidence about access is
    // not evidence of absence of access, and the owner acts on what is shown.
    const r = await getAccess(DOC, { fetch: yesMan() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.url).toBe(DOC);
    // Named, because "not ok" is also what a 404 or a parse failure looks like
    // and only one of those means "I could not tell".
    expect(r.error.kind).toBe("accessUnverified");
  });
});

describe("createContainer refuses a URL that is not a container", () => {
  /**
   * A container is a URL ending in "/" — LDP's own convention, and what
   * @inrupt/solid-client's isContainer checks. Two wrong answers are available
   * here and both are worse than a refusal:
   *
   *   - appending the slash silently, which creates a container at a URL the
   *     caller did not name while every reference the caller holds points at a
   *     document that does not exist;
   *   - creating a DOCUMENT and then setting container access on it, which is
   *     the `acl:default` shape applied to a thing that has no children.
   */
  it("returns a structured error and makes no request at all", async () => {
    const fetch = refusing();
    const settled = await settle(createContainer(DOC, { fetch, webId: WEBID }));

    expect(settled.threw).toBeUndefined();
    const r = settled.returned;
    expect(r?.ok).toBe(false);
    if (!r || r.ok) return;
    expect(r.error.kind).toBe("accessUnverified");
    // The URL the caller passed, unmodified — not a normalised one. If this
    // ever reads `${DOC}/` the silent normalisation has happened.
    expect(r.error.url).toBe(DOC);

    // The guard is BEFORE the network, so nothing was created anywhere. An
    // implementation that PUT first and validated afterwards would leave a
    // stray resource behind on every mistyped call.
    expect(fetch.mock.calls.length).toBe(0);
  });

  it("accepts the same path with the trailing slash", async () => {
    // The allow-case. Without it, "rejects a non-container URL" is also
    // satisfied by a createContainer that rejects everything.
    const fetch = refusing();
    const r = await createContainer(`${DOC}/`, { fetch, webId: WEBID });

    // Still an error — this fake refuses everything — but it got past the guard
    // and onto the network, which is the thing being distinguished.
    expect(fetch.mock.calls.length).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("http");
  });
});

describe("resolveContainerAcl, the container write's first step", () => {
  /**
   * The step IS the refusal: a container's shape is a WAC ACL document, so it
   * is written only on positive evidence that the target is one. This fake
   * advertises no ACL — an ACP server (§19), or no access control at all, and
   * neither is evidence.
   */
  it("refuses a server with no readable WAC ACL, naming both sides", async () => {
    const r = await resolveContainerAcl(yesMan(), CONTAINER);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("accessUnverified");
    if (r.error.kind !== "accessUnverified") return;
    expect(r.error.url).toBe(CONTAINER);
    // Both halves of the refusal, because "could not verify" with neither is
    // nothing a deployer can act on. The found side has to name the ACP case:
    // that is the one a reader will otherwise diagnose as a bug.
    expect(r.error.expected).toContain("WAC authorisations");
    expect(r.error.found).toContain("ACP control resource");
  });

  /**
   * Per-step, and invisible in the sequence: `createContainer` PUTs the
   * container before this runs, so a mutation seen there proves nothing. A
   * resolve that wrote would be writing before it knew what it was writing to.
   */
  it("sends no mutation while deciding — it only reads", async () => {
    const fetch = yesMan();
    await resolveContainerAcl(fetch, CONTAINER);

    const methods = fetch.mock.calls.map(([input, init]) => methodOf(input, init));
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.filter((m) => m !== "GET" && m !== "HEAD")).toEqual([]);
  });
});

describe("applyDocumentPublicRead, the document write's apply half", () => {
  /**
   * Documents go through universalAccess, which phase 0 exercised on both WAC
   * and ACP unchanged (§19). What is asserted per-step is that the refusal
   * carries what was ASKED FOR rather than a constant — makePrivate's half
   * must not report "expected public read=true".
   */
  it.each([[true], [false]])("refuses a server that reports no resulting access, read=%s", async (read) => {
    const r = await applyDocumentPublicRead(DOC, yesMan(), read);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("accessUnverified");
    if (r.error.kind !== "accessUnverified") return;
    expect(r.error.url).toBe(DOC);
    expect(r.error.expected).toContain(`public read=${read}`);
  });

  /**
   * WHERE the refusal comes from, which the sequence cannot show: identical
   * errors mean the apply half refused and the WAC-Allow cross-check below it
   * never ran. An apply half that went quietly tolerant, leaving the
   * cross-check to catch it, would report a different error here.
   */
  it("is where makePublic's refusal against that server is decided", async () => {
    const half = await applyDocumentPublicRead(DOC, yesMan(), true);
    const whole = await makePublic(DOC, { fetch: yesMan() });

    expect(half.ok).toBe(false);
    expect(whole.ok).toBe(false);
    if (half.ok || whole.ok) return;
    expect(whole.error).toEqual(half.error);
  });
});

describe("serverListingContradiction, the strong half of a container's evidence", () => {
  /**
   * WAC-Allow is the server's own evaluation and the only check on the
   * container path that is not "what we stored". Pure, so it needs no Pod at
   * all: the three modes are asserted one at a time, because a listing granted
   * append is as enumerable as one granted read.
   */
  it.each([
    ["read", { read: true, append: false, write: false }],
    ["append", { read: false, append: true, write: false }],
    ["write", { read: false, append: false, write: true }],
  ])("names a public %s on the container itself", (_mode, server) => {
    const error = serverListingContradiction(CONTAINER, server);

    expect(error).toBeDefined();
    expect(error?.kind).toBe("accessUnverified");
    if (error?.kind !== "accessUnverified") return;
    expect(error.url).toBe(CONTAINER);
    // All three modes in the found string, not just the offending one: a
    // deployer reading "public access" with no modes cannot tell what to fix.
    for (const mode of ["read=", "append=", "write="]) expect(error.found).toContain(mode);
  });

  /**
   * `undefined` is a DIFFERENT FACT from "nothing", and this is the line
   * between them: a server that said nothing has not said no. Reporting it as
   * a contradiction would make every ACP Pod look like a leak.
   */
  it("is silent when the server grants nothing, and when it says nothing at all", () => {
    expect(serverListingContradiction(CONTAINER, { read: false, append: false, write: false })).toBeUndefined();
    expect(serverListingContradiction(CONTAINER, undefined)).toBeUndefined();
  });
});

/**
 * A COMPILE-TIME assertion, checked by `npm run typecheck` rather than at run
 * time — there is no ok-path against these fakes, so the runtime half of this
 * invariant lives in test/pod-access.integration.test.ts against a real server.
 *
 * `inheritsVerifiedBy` can never be "server". The reason is not stylistic: no
 * HTTP header answers "what would an anonymous request to a CHILD of this
 * container get?" — WAC-Allow describes the resource it came with and nothing
 * below it. So `inherits` is only ever the rules we wrote read back, and the
 * type has to say so, or a future edit will quietly relabel weak evidence as
 * the server's own word and the studio will render it as a guarantee.
 *
 * If someone widens the union to include "server", `Excludes<...>` resolves to
 * `false` and this line stops compiling.
 */
type Excludes<Union, Member> = Member extends Union ? false : true;
const inheritsIsNeverServerEvidence: Excludes<AccessState["inheritsVerifiedBy"], "server"> = true;
void inheritsIsNeverServerEvidence;

// And the sibling field CAN be "server", so the assertion above is about this
// distinction rather than about the string being unused in the codebase.
const publicAccessCanBeServerEvidence: Excludes<AccessState["verifiedBy"], "server"> = false;
void publicAccessCanBeServerEvidence;

describe("the caller's fetch is the only fetch", () => {
  /**
   * Architecture invariant 4: writes go browser -> Pod with the visitor's own
   * session, held only in their browser. A module that falls back to the
   * ambient fetch makes an unauthenticated request that looks, on ESS, exactly
   * like a missing resource (401, phase 0) — a silent downgrade to anonymous.
   *
   * test/setup.ts turns any such request into a failure, and this asserts the
   * positive: the injected fetch is actually the one used.
   */
  it.each(CALLS)("%s uses the fetch it was handed", async (_name, call) => {
    const fetch = refusing();
    await settle(call(fetch));

    expect(fetch.mock.calls.length).toBeGreaterThan(0);
    for (const [input] of fetch.mock.calls) {
      expect(urlOf(input).startsWith(POD)).toBe(true);
    }
  });
});
