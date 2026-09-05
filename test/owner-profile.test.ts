import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { http, HttpResponse } from "msw";
import { DY, NS, PROFILE } from "@/lib/vocab";
// Aliased: `describe` is vitest's here. This is the one-line renderer a
// fallback shows the reader, so the error has to survive it.
import { describe as podDescribe } from "@/lib/pod/result";
import { graphEquals, triples } from "./graph";
import { server, servePod } from "./msw";

/**
 * `readOwnerProfile` — the studio's thin server component reads the owner's
 * WebID, unauthenticated, to discover `solid:oidcIssuer`. `session.login()`
 * requires it (mandatory in `ILoginInputOptions`) and there is deliberately no
 * `OIDC_ISSUER` env var: docs/data-model.md §7.5 says the WebID document
 * reliably carries it, which is why `PROFILE.oidcIssuer` exists in lib/vocab.ts.
 *
 * It follows `readDiary` in every respect — `fetchTurtle`, a Zod-validated
 * value, a structured `Result` and never a throw — except three deliberate
 * differences, each of which is something a later "cleanup" would get wrong.
 * Those three have their own describe blocks below.
 */

/* ----------------------------------------------------------------- fixtures */

/**
 * The §7.5 block, read out of docs/data-model.md at runtime. Those blocks are
 * normative (§11), so a hand-copied fixture would test a copy of the spec
 * rather than the spec. Same extraction as test/read.test.ts.
 */
const doc = readFileSync("docs/data-model.md", "utf8");
const blocks = [...doc.matchAll(/```turtle\n([\s\S]*?)```/g)].map((m) => m[1]);

/** Block 4 is §7.5's WebID document; block 5 is the type-index registration. */
const PROFILE_TTL = blocks[4];

const WEBID = "https://me.solidcommunity.net/profile/card#me";
/** What must actually be fetched: the WebID with its fragment stripped. */
const DOC = "https://me.solidcommunity.net/profile/card";

/**
 * String-replacing a fixture is how a negative test silently passes the
 * *unmodified* fixture: if the anchor drifts, `.replace` is a no-op and the
 * assertion runs against a perfectly good document. Two guards — the anchor
 * must be present, and the edit must change the *graph*, not merely the bytes.
 * Both throw at module load, so a stale anchor is loud rather than green.
 */
function mutate(source: string, from: string, to: string): string {
  if (!source.includes(from)) {
    throw new Error(`fixture anchor not found in docs/data-model.md §7.5: ${JSON.stringify(from)}`);
  }
  const out = source.replace(from, to);
  if (graphEquals(source, out, DOC).equal) {
    throw new Error(`mutation left the graph unchanged: ${JSON.stringify(from)}`);
  }
  return out;
}

/** Does the parsed fixture assert this predicate at all? Keeps the
 *  "absent on purpose" tests from going vacuous if §7.5 ever gains the term. */
const hasPredicate = (ttl: string, predicate: string) =>
  [...triples(ttl, DOC)].some((t) => t.split(" ")[1] === `N|${predicate}`);

/** Records what URL the read actually requested, then delegates to the real
 *  (MSW-patched) fetch. This is how the fragment-stripping rule is observed at
 *  the seam rather than inferred from whether MSW happened to match. */
function recordingFetch(calls: string[]): typeof globalThis.fetch {
  return (input, init) => {
    calls.push(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    return globalThis.fetch(input, init);
  };
}

/**
 * Loaded through a dynamic `import()` rather than a static named import, and
 * deliberately so while this is the red step of the TDD loop: a static named
 * import of an export that does not exist yet is an ESM *link* error, which
 * kills the whole file with a SyntaxError before a single test runs and reads
 * like a broken test file instead of a missing implementation. Reached through
 * the namespace, every test below runs and fails on its own terms. The same
 * dynamic-import shape is already used in test/read.test.ts.
 */
const load = async () => (await import("@/lib/pod/read")).readOwnerProfile;

/* -------------------------------------------------------------- happy path */

describe("readOwnerProfile", () => {
  it("reads oidcIssuer, storage and seeAlso from the normative §7.5 document", async () => {
    const readOwnerProfile = await load();
    servePod({ [DOC]: PROFILE_TTL });

    const r = await readOwnerProfile(WEBID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.oidcIssuer).toBe("https://login.inrupt.com");
    // </> and </extendedProfile> are relative: they must resolve against the
    // document, which is what makes baseIRI mandatory in fetchTurtle.
    expect(r.value.storage).toBe("https://me.solidcommunity.net/");
    expect(r.value.seeAlso).toBe("https://me.solidcommunity.net/extendedProfile");
  });

  it("fetches the WebID with its fragment stripped", async () => {
    const readOwnerProfile = await load();
    servePod({ [DOC]: PROFILE_TTL });
    const calls: string[] = [];

    const r = await readOwnerProfile(WEBID, { fetch: recordingFetch(calls) });
    expect(r.ok).toBe(true);
    // The caller-supplied fetch must be honoured — same seam as every other
    // read, so the studio can pass its own.
    expect(calls).toEqual([DOC]);
    expect(calls[0]).not.toContain("#");
  });

  it("contains no blank nodes", () => {
    // §11 guardrail 4, and the reason graph comparison here collapses to set
    // equality: triples() throws on a blank-node label.
    expect(() => triples(PROFILE_TTL, DOC)).not.toThrow();
  });
});

/* ------------------------------------- difference 1: the subject is the WebID */

describe("readOwnerProfile subject resolution", () => {
  /** A profile that ALSO carries an <#it> subject with a different issuer.
   *  An implementation that reached for itOf(url) out of habit reads the decoy
   *  and hands session.login() the wrong identity provider. */
  const WITH_IT_DECOY = mutate(
    PROFILE_TTL,
    "rdfs:seeAlso     </extendedProfile> .",
    `rdfs:seeAlso     </extendedProfile> .

<#it>
    a                foaf:Agent ;
    solid:oidcIssuer <https://decoy.invalid/it> ;
    pim:storage      <https://decoy.invalid/it-storage/> .`,
  );

  /** The fragment is not always "me": CSS and ESS both let it be anything.
   *  Here the real subject is <#owner> and <#me> is the decoy, so hardcoding
   *  "#me" fails exactly as hardcoding "#it" does. */
  const OWNER_FRAGMENT = mutate(
    PROFILE_TTL,
    "<#me>",
    `<#me>
    a                foaf:Agent ;
    solid:oidcIssuer <https://decoy.invalid/me> ;
    pim:storage      <https://decoy.invalid/me-storage/> .

<#owner>`,
  );

  it("uses the WebID fragment, not <#it>", async () => {
    const readOwnerProfile = await load();
    servePod({ [DOC]: WITH_IT_DECOY });

    const r = await readOwnerProfile(WEBID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.oidcIssuer).toBe("https://login.inrupt.com");
    expect(r.value.storage).toBe("https://me.solidcommunity.net/");
  });

  it("uses the WebID fragment even when it is not #me", async () => {
    const readOwnerProfile = await load();
    servePod({ [DOC]: OWNER_FRAGMENT });

    const r = await readOwnerProfile(`${DOC}#owner`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.oidcIssuer).toBe("https://login.inrupt.com");
    expect(r.value.storage).toBe("https://me.solidcommunity.net/");
  });

  it("reports a shape error when the WebID names no subject in its own document", async () => {
    const readOwnerProfile = await load();
    servePod({ [DOC]: PROFILE_TTL });

    const r = await readOwnerProfile(`${DOC}#nobody`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("shape");
    expect(r.error).toMatchObject({ kind: "shape", url: DOC });
  });
});

/* ------------------------------------ difference 2: no dy:schemaVersion check */

describe("readOwnerProfile and dy:schemaVersion", () => {
  // The dy: prefix goes on BEFORE the mutation, so both sides of the graph
  // comparison inside mutate() are parseable Turtle.
  const WRONG_VERSION = mutate(
    `@prefix dy: <${NS.dy}> .\n${PROFILE_TTL}`,
    "pim:storage      </> ;",
    "pim:storage      </> ;\n    dy:schemaVersion 99 ;",
  );

  it("the §7.5 document really does declare no dy:schemaVersion", () => {
    // Without this, "reads a document with no version" would quietly become
    // vacuous the day someone adds one to the normative fixture.
    expect(hasPredicate(PROFILE_TTL, DY.schemaVersion)).toBe(false);
    expect(hasPredicate(PROFILE_TTL, PROFILE.oidcIssuer)).toBe(true);
  });

  it("reads a document that declares no dy:schemaVersion at all", async () => {
    // CLAUDE.md's "check it on every top-level read" is about OUR resources.
    // The WebID document is not ours — on ESS the identity provider serves it —
    // so a version check here would break every real Pod.
    const readOwnerProfile = await load();
    servePod({ [DOC]: PROFILE_TTL });

    const r = await readOwnerProfile(WEBID);
    expect(r.ok).toBe(true);
  });

  it("ignores a dy:schemaVersion it would otherwise reject", async () => {
    // The sharp version of the rule above: 99 is a value every other top-level
    // read refuses. Here it must be read straight past.
    const readOwnerProfile = await load();
    servePod({ [DOC]: WRONG_VERSION });

    const r = await readOwnerProfile(WEBID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.oidcIssuer).toBe("https://login.inrupt.com");
  });
});

/* ------------------------------------------- difference 3: no rdf:type gate */

describe("readOwnerProfile and rdf:type", () => {
  const NO_TYPE = mutate(PROFILE_TTL, "    a              foaf:Agent ;\n", "");

  it("reads a profile that omits foaf:Agent", async () => {
    // §7.5 types <#me> as foaf:Agent but nothing depends on it, and plenty of
    // real profiles omit it.
    const readOwnerProfile = await load();
    servePod({ [DOC]: NO_TYPE });

    const r = await readOwnerProfile(WEBID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.oidcIssuer).toBe("https://login.inrupt.com");
  });
});

/* ------------------------------------------------------- the ESS-shaped Pod */

describe("readOwnerProfile on an identity host separate from storage", () => {
  const ESS_WEBID = "https://id.inrupt-like.test/luca/card#me";
  const ESS_DOC = "https://id.inrupt-like.test/luca/card";
  const ESS_STORAGE = "https://storage.inrupt-like.test/2f9c1a/";

  const ESS_TTL = mutate(PROFILE_TTL, "pim:storage      </> ;", `pim:storage      <${ESS_STORAGE}> ;`);

  it("takes storage from pim:storage, not from the WebID origin", async () => {
    // §7.5: "on ESS identity and storage are different hosts entirely". An
    // implementation that derived the Pod root from the WebID's origin passes
    // every other test in this file and fails here.
    const readOwnerProfile = await load();
    servePod({ [ESS_DOC]: ESS_TTL });

    const r = await readOwnerProfile(ESS_WEBID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.storage).toBe(ESS_STORAGE);
    expect(new URL(r.value.storage!).origin).not.toBe(new URL(ESS_WEBID).origin);
  });
});

/* -------------------------------------------------------- structured errors */

describe("readOwnerProfile failures are values, not throws", () => {
  const NO_ISSUER = mutate(PROFILE_TTL, "    solid:oidcIssuer <https://login.inrupt.com> ;\n", "");
  const NO_SEE_ALSO = mutate(
    PROFILE_TTL,
    "pim:storage      </> ;\n    rdfs:seeAlso     </extendedProfile> .",
    "pim:storage      </> .",
  );

  it("reports a shape error when solid:oidcIssuer is absent", async () => {
    // Login cannot proceed without it, so absence is a failure rather than an
    // undefined field the caller discovers at redirect time.
    const readOwnerProfile = await load();
    servePod({ [DOC]: NO_ISSUER });

    const r = await readOwnerProfile(WEBID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("shape");
    if (r.error.kind !== "shape") return;
    expect(r.error.url).toBe(DOC);
    // The error must say WHICH field, or it is a boolean with extra steps.
    expect(r.error.issues.join(" ")).toContain("oidcIssuer");
  });

  it("treats rdfs:seeAlso as optional", async () => {
    const readOwnerProfile = await load();
    servePod({ [DOC]: NO_SEE_ALSO });

    const r = await readOwnerProfile(WEBID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.seeAlso).toBeUndefined();
    expect(r.value.oidcIssuer).toBe("https://login.inrupt.com");
  });

  it("reports a missing document as a structured http error", async () => {
    const readOwnerProfile = await load();
    servePod({ [DOC]: 404 });

    const r = await readOwnerProfile(WEBID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // url is the DOCUMENT, fragment stripped — the thing actually requested.
    expect(r.error).toEqual({ kind: "http", url: DOC, status: 404 });
  });

  it("reports a non-Turtle body as a parse error", async () => {
    const readOwnerProfile = await load();
    servePod({ [DOC]: "<!doctype html><title>login</title>" });

    const r = await readOwnerProfile(WEBID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("parse");
    if (r.error.kind !== "parse") return;
    expect(r.error.url).toBe(DOC);
    expect(typeof r.error.message).toBe("string");
    expect(r.error.message.length).toBeGreaterThan(0);
  });

  it("reports an unreachable host as a structured network error", async () => {
    const readOwnerProfile = await load();
    server.use(http.get(DOC, () => HttpResponse.error()));

    const r = await readOwnerProfile(WEBID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("network");
    if (r.error.kind !== "network") return;
    expect(r.error.url).toBe(DOC);
    expect(typeof r.error.message).toBe("string");
  });
});

/* ------------------------------------------- the malformed WebID (the guard) */

/**
 * The sixth error path. `readOwnerProfile` derives the document URL by stripping
 * the fragment with `new URL(webId)`, and `new URL` THROWS on input it cannot
 * parse. A read that promises never to throw (§11: "a typed object or a
 * structured error") cannot let that escape, so the constructor is wrapped and
 * the failure comes back as a value.
 *
 * ┌─ READ THIS BEFORE "FIXING" THE `url` FIELD BELOW ─────────────────────────┐
 * │ Every other error out of this function carries the DOCUMENT url — the     │
 * │ WebID with its fragment stripped — and the tests above pin that. THIS ONE │
 * │ PATH CARRIES THE RAW `webId` INSTEAD, and that is deliberate: the whole   │
 * │ reason we are here is that no document URL can be derived from a string   │
 * │ that will not parse. There is nothing else to report. Making this branch  │
 * │ "consistent" with the other five would mean inventing a document URL for  │
 * │ a WebID that has none, or reporting an empty string, and either loses the │
 * │ one piece of information the caller needs: what they actually passed in.  │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
describe("readOwnerProfile and a malformed WebID", () => {
  /** A WebID arrives from configuration, so every one of these is a plausible
   *  typo in an env var or a hand-edited profile, not a hypothetical. */
  const MALFORMED: { label: string; webId: string }[] = [
    { label: "an empty string", webId: "" },
    { label: "whitespace only", webId: "   " },
    { label: "a relative reference", webId: "/profile/card#me" },
    { label: "a protocol-relative reference", webId: "//me.solidcommunity.net/profile/card#me" },
    { label: "a host with no scheme", webId: "me.solidcommunity.net/profile/card#me" },
    { label: "a scheme with no host", webId: "https://" },
    { label: "a space inside the authority", webId: "https://me example.test/card#me" },
  ];

  it("every entry in the table really is one new URL() rejects", () => {
    // The premise guard, in the same spirit as mutate()'s anchor check above.
    // Without it, an entry that WHATWG parsing later starts accepting (or that
    // was mis-typed here) would still "fail the read" — via the network, from a
    // completely different branch — and the table would look like it was
    // exercising the guard when it had stopped doing so.
    for (const { label, webId } of MALFORMED) {
      expect(() => new URL(webId), label).toThrow();
    }
  });

  it.each(MALFORMED)("returns a structured shape error for $label", async ({ webId }) => {
    const readOwnerProfile = await load();

    const call = readOwnerProfile(webId);
    // The invariant this branch exists to keep: a VALUE, never a throw. An
    // unguarded `new URL` inside an async function surfaces as a rejection, so
    // this is the assertion that goes red if the try/catch is removed.
    await expect(call).resolves.toBeDefined();
    const r = await call;

    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The whole object, not just "it failed": exactly these keys, exactly one
    // issue, and `url` is the raw webId — see the box above.
    expect(r.error).toEqual({
      kind: "shape",
      url: webId,
      issues: [expect.any(String)],
    });
    if (r.error.kind !== "shape") return;

    // ...and the issue has to NAME the problem. An error that says only "no"
    // is a boolean with extra steps — this project shipped a bare status
    // without its body once already.
    const [issue] = r.error.issues;
    expect(issue).toMatch(/\bwebId\b/);
    expect(issue).toMatch(/absolute (IRI|URI|URL)/i);
    // Echo back what was rejected, so a bad env var is diagnosable from the
    // message alone. Skipped for "" only because every string contains "".
    if (webId !== "") expect(issue).toContain(webId);

    // describe() must render it too: it is what a fallback shows the reader.
    expect(podDescribe(r.error)).toContain("does not match the data model");
  });

  it("attempts no request at all for a malformed WebID", async () => {
    const readOwnerProfile = await load();
    const calls: string[] = [];

    const r = await readOwnerProfile("/profile/card#me", { fetch: recordingFetch(calls) });

    expect(r.ok).toBe(false);
    // Nothing was fetched: the guard returns before the network. If it ever
    // did fetch, MSW's onUnhandledRequest would fail the test anyway — this
    // asserts it directly rather than relying on that side effect.
    expect(calls).toEqual([]);
  });

  /* --- the allow side: the guard must not reject WebIDs that are merely odd --- */

  it("accepts a well-formed WebID that is merely unusual, and normalises it", async () => {
    // A rule that rejects everything is useless, so the allow-case is pinned
    // too. Mixed-case host and an explicit port are both legal; `new URL`
    // lower-cases the host, and the read must proceed on the normalised form
    // rather than treating the oddity as malformed.
    const readOwnerProfile = await load();
    const ODD_DOC = "https://me.solidcommunity.net:8443/profile/card";
    servePod({ [ODD_DOC]: PROFILE_TTL });
    const calls: string[] = [];

    const r = await readOwnerProfile("https://Me.SolidCommunity.NET:8443/profile/card#me", {
      fetch: recordingFetch(calls),
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.oidcIssuer).toBe("https://login.inrupt.com");
    expect(calls).toEqual([ODD_DOC]);
  });

  it("a parseable WebID that names nothing still reports the DOCUMENT url", async () => {
    // The contrast that makes the exception legible. This WebID is well-formed
    // (it just has no fragment, so it describes no subject in its own
    // document): the guard lets it through, a document URL therefore exists,
    // and the shape error carries THAT — not the raw input. Only the
    // unparseable branch above differs, and only because it has no choice.
    const readOwnerProfile = await load();
    servePod({ [DOC]: PROFILE_TTL });

    const r = await readOwnerProfile(DOC);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("shape");
    if (r.error.kind !== "shape") return;
    expect(r.error.url).toBe(DOC);
    expect(r.error.issues.join(" ")).toContain(DOC);
    expect(r.error.issues.join(" ")).not.toMatch(/absolute (IRI|URI|URL)/i);
  });
});
