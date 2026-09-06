import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { http, HttpResponse } from "msw";
import { DY, NS } from "@/lib/vocab";
// Aliased: `describe` is vitest's here. This is the one-line renderer a
// fallback shows, so the error has to survive it.
import { describe as podDescribe } from "@/lib/pod/result";
import { triples } from "./graph";
import { server, servePod } from "./msw";

/**
 * `readPrivacySettings` — the owner-only resource at §7.6, which §9 says every
 * coordinate write has to consult BEFORE it writes.
 *
 * It is modelled on `readOwnerProfile`, which is the other read in this project
 * that is not part of the public render path. FIVE THINGS MUST DIFFER, and each
 * has its own describe block below because each one is something a later tidy-up
 * would get exactly backwards:
 *
 *   1. The subject is `<#it>`, not the document IRI. `readOwnerProfile` uses the
 *      whole WebID because a WebID *is* a fragment IRI naming a person; this is
 *      our own resource and §6's `<#it>` convention applies to it.
 *   2. `dy:schemaVersion` IS checked. `readOwnerProfile` deliberately skips it
 *      because the WebID document is not ours. This one is.
 *   3. Datatypes are enforced — `xsd:decimal` for the coordinate pair,
 *      `xsd:integer` for the two distances. `readOwnerProfile` reads only IRIs
 *      and enforces no datatype at all.
 *   4. It needs an AUTHENTICATED fetch. `readOwnerProfile` is unauthenticated by
 *      design; this resource is owner-only, so an anonymous caller gets 401 and
 *      that has to arrive as a structured error rather than as an empty value.
 *   5. Every failure is load-bearing. A failed profile read blocks a login; a
 *      failed settings read must block a COORDINATE from being published (§9,
 *      "fail closed"). So there are no defaults anywhere in here: not for the
 *      grid size, not for the home radius, not for a half-written home region.
 */

/* ----------------------------------------------------------------- fixtures */

/**
 * The §7.6 block, read out of docs/data-model.md at runtime. Those blocks are
 * normative (§1, §11), so a hand-copied fixture would test a copy of the spec
 * rather than the spec. Same extraction as test/read.test.ts.
 */
const doc = readFileSync("docs/data-model.md", "utf8");
const blocks = [...doc.matchAll(/```turtle\n([\s\S]*?)```/g)].map((m) => m[1]);

/** Block 6 is §7.6 — diary, trip, entry, index, profile, type index, privacy. */
const PRIVACY_TTL = blocks[6];

const POD = "https://me.solidcommunity.net/";
const URL_ = `${POD}travel/settings/privacy.ttl`;

/**
 * String-replacing a fixture is how a negative test silently passes the
 * *unmodified* fixture: if the anchor drifts, `.replace` is a no-op and the
 * assertion runs against a perfectly good document. Two guards — the anchor must
 * be present, and the edit must change the GRAPH, not merely the bytes. Both
 * throw at module load, so a stale anchor is loud rather than green.
 */
function mutate(from: string, to: string, source = PRIVACY_TTL): string {
  if (!source.includes(from)) {
    throw new Error(`fixture anchor not found in docs/data-model.md §7.6: ${JSON.stringify(from)}`);
  }
  const out = source.replace(from, to);
  const before = triples(source, URL_);
  const after = triples(out, URL_);
  const same =
    before.size === after.size && [...before].every((t) => after.has(t));
  if (same) throw new Error(`mutation left the graph unchanged: ${JSON.stringify(from)}`);
  return out;
}

/** Does the parsed fixture assert this predicate at all? Keeps the "required"
 *  tests from going vacuous if §7.6 ever loses one of the four terms. */
const hasPredicate = (ttl: string, predicate: string) =>
  [...triples(ttl, URL_)].some((t) => t.split(" ")[1] === `N|${predicate}`);

/** Records what URL the read actually requested, then delegates to the real
 *  (MSW-patched) fetch — the same seam as test/owner-profile.test.ts. */
function recordingFetch(calls: string[]): typeof globalThis.fetch {
  return (input, init) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return globalThis.fetch(input, init);
  };
}

/**
 * Loaded through a dynamic `import()` rather than a static named import, and
 * deliberately so while this is the red step of the TDD loop: a static named
 * import of an export that does not exist yet is an ESM *link* error, which
 * kills the whole file with a SyntaxError before a single test runs and reads
 * like a broken test file instead of a missing implementation.
 */
const load = async () => {
  const mod = await import("@/lib/pod/read");
  return { readPrivacySettings: mod.readPrivacySettings, privacySettingsUrl: mod.privacySettingsUrl };
};

/* -------------------------------------------------------------- happy path */

describe("readPrivacySettings", () => {
  it("returns the four §7.6 values from the normative fixture", async () => {
    const { readPrivacySettings } = await load();
    servePod({ [URL_]: PRIVACY_TTL });

    const r = await readPrivacySettings(URL_);
    expect(r.ok, r.ok ? "" : podDescribe(r.error)).toBe(true);
    if (!r.ok) return;

    expect(r.value.iri).toBe(`${URL_}#it`);
    expect(r.value.schemaVersion).toBe(1);
    expect(r.value.home).toEqual({ lat: 45.4655, long: 9.1866, radiusMeters: 3000 });
    expect(r.value.defaultPrecisionMeters).toBe(500);
    expect(r.value.modified).toBe("2026-09-06T11:20:04+02:00");
  });

  it("the §7.6 fixture really does declare all four terms", () => {
    // The premise guard. Without it, every "required" test below would still
    // pass the day someone dropped a term from the normative block — for the
    // wrong reason, and silently.
    for (const p of [DY.homeLat, DY.homeLong, DY.homeRadiusMeters, DY.defaultPrecisionMeters]) {
      expect(hasPredicate(PRIVACY_TTL, p), p).toBe(true);
    }
  });

  it("contains no blank nodes", () => {
    // §11 guardrail 4, and the reason graph comparison in this project collapses
    // to set equality: triples() throws on a blank-node label.
    expect(() => triples(PRIVACY_TTL, URL_)).not.toThrow();
  });

  it("honours the caller's fetch, and asks for exactly one document", async () => {
    // The studio's authenticated fetch is the only way this resource is
    // readable at all — it is owner-only. A read that reached for the ambient
    // `fetch` would be anonymous, and anonymous is 401 here.
    const { readPrivacySettings } = await load();
    servePod({ [URL_]: PRIVACY_TTL });
    const calls: string[] = [];

    const r = await readPrivacySettings(URL_, { fetch: recordingFetch(calls) });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([URL_]);
  });
});

/* -------------------------------------------------------------------- URLs */

describe("privacySettingsUrl", () => {
  it("resolves under travel/, not at the Pod root", async () => {
    const { privacySettingsUrl } = await load();
    expect(privacySettingsUrl(POD)).toBe(`${POD}travel/settings/privacy.ttl`);
  });

  it("is NOT the type index, which lives at the storage root (§4, §7.5)", async () => {
    // §14 records that revision 2 moved the type index OUT of /travel/settings/
    // because a type index there "would have been discovered by nothing". Same
    // segment name, different container, opposite access requirement. This
    // assertion exists so a future "consolidation" trips a test rather than a
    // deployer.
    const { privacySettingsUrl } = await load();
    expect(privacySettingsUrl(POD)).not.toContain("publicTypeIndex");
    expect(privacySettingsUrl(POD)).not.toBe(`${POD}settings/privacy.ttl`);
  });

  it("tolerates a Pod root with no trailing slash without climbing a level", async () => {
    // `new URL("travel/…", "https://host/pod")` resolves against the PARENT of
    // `pod`, silently addressing someone else's storage on a multi-pod server.
    const { privacySettingsUrl } = await load();
    expect(privacySettingsUrl("https://me.solidcommunity.net/pod")).toBe(
      "https://me.solidcommunity.net/pod/travel/settings/privacy.ttl",
    );
  });
});

/* ------------------------------- difference 1: the subject is <#it>, not <> */

describe("readPrivacySettings subject resolution", () => {
  const ON_THE_DOCUMENT = mutate("<#it>", "<>");

  it("reads <#it>, not the document IRI", async () => {
    // The mirror image of readOwnerProfile, which uses the whole document-plus-
    // fragment IRI on purpose. Here §6 applies: "every subject is a fragment,
    // never a bare document URL, never a blank node".
    const { readPrivacySettings } = await load();
    servePod({ [URL_]: ON_THE_DOCUMENT });

    const r = await readPrivacySettings(URL_);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("shape");
    expect(r.error).toMatchObject({ kind: "shape", url: URL_ });
  });
});

/* ------------------------------- difference 2: dy:schemaVersion IS checked */

describe("readPrivacySettings and dy:schemaVersion", () => {
  const WRONG = mutate("dy:schemaVersion          1 ;", "dy:schemaVersion          99 ;");
  const ABSENT = mutate("    dy:schemaVersion          1 ;\n", "");

  it("rejects a version it does not understand", async () => {
    // readOwnerProfile reads straight past a 99 because the WebID document is
    // not ours. This resource IS ours, so §11's rule applies in full — and a
    // settings document written by a future version of this app could mean
    // something different by the same four predicates.
    const { readPrivacySettings } = await load();
    servePod({ [URL_]: WRONG });

    const r = await readPrivacySettings(URL_);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("schemaVersion");
    expect(r.error).toMatchObject({ kind: "schemaVersion", url: URL_, found: "99", expected: 1 });
  });

  it("rejects a document that declares no version at all", async () => {
    const { readPrivacySettings } = await load();
    servePod({ [URL_]: ABSENT });

    const r = await readPrivacySettings(URL_);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("schemaVersion");
  });
});

/* --------------------------------- difference 3: datatypes are enforced (§6) */

describe("readPrivacySettings datatypes", () => {
  const cases: { label: string; ttl: string; predicate: string; expected: string }[] = [
    {
      label: "dy:homeLat as xsd:float",
      ttl: mutate("dy:homeLat                45.4655 ;", 'dy:homeLat                "45.4655"^^xsd:float ;'),
      predicate: DY.homeLat,
      expected: `${NS.xsd}decimal`,
    },
    {
      label: "dy:homeLong as a plain string",
      ttl: mutate("dy:homeLong               9.1866 ;", 'dy:homeLong               "9.1866" ;'),
      predicate: DY.homeLong,
      expected: `${NS.xsd}decimal`,
    },
    {
      label: "dy:homeRadiusMeters as xsd:decimal",
      ttl: mutate("dy:homeRadiusMeters       3000 ;", "dy:homeRadiusMeters       3000.0 ;"),
      predicate: DY.homeRadiusMeters,
      expected: `${NS.xsd}integer`,
    },
    {
      label: "dy:defaultPrecisionMeters as a plain string",
      ttl: mutate("dy:defaultPrecisionMeters 500 .", 'dy:defaultPrecisionMeters "500" .'),
      predicate: DY.defaultPrecisionMeters,
      expected: `${NS.xsd}integer`,
    },
  ];

  it.each(cases)("rejects $label", async ({ ttl, predicate, expected }) => {
    // §6: "coordinates are xsd:decimal, never xsd:float; counts and distances
    // are xsd:integer". Enforced on READ because a Pod contains whatever was
    // written to it — and a radius read from `"3000"^^xsd:string` would be the
    // number 3000 with nothing complaining, which is precisely the silent wrong
    // value the structured-error design exists to prevent.
    const { readPrivacySettings } = await load();
    servePod({ [URL_]: ttl });

    const r = await readPrivacySettings(URL_);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("datatype");
    expect(r.error).toMatchObject({ kind: "datatype", url: URL_, predicate, expected });
  });
});

/* -------------------------- difference 5: no defaults anywhere (§9 fail closed) */

describe("readPrivacySettings never invents a value", () => {
  const NO_DEFAULT_PRECISION = mutate(
    " ;\n    dy:defaultPrecisionMeters 500 .",
    " .",
  );

  const NO_HOME_AT_ALL = mutate(
    "    dy:homeLat                45.4655 ;\n    dy:homeLong               9.1866 ;\n    dy:homeRadiusMeters       3000 ;\n",
    "",
  );

  const PARTIAL: { label: string; ttl: string; missing: string }[] = [
    {
      label: "no dy:homeRadiusMeters",
      ttl: mutate("    dy:homeRadiusMeters       3000 ;\n", ""),
      missing: "radiusMeters",
    },
    {
      label: "no dy:homeLong",
      ttl: mutate("    dy:homeLong               9.1866 ;\n", ""),
      missing: "long",
    },
    {
      label: "no dy:homeLat",
      ttl: mutate("    dy:homeLat                45.4655 ;\n", ""),
      missing: "lat",
    },
  ];

  it("requires dy:defaultPrecisionMeters — there is no built-in grid size", async () => {
    // §7.6: "there is no built-in fallback, because a fallback is a number this
    // project chose for someone else's front door".
    const { readPrivacySettings } = await load();
    servePod({ [URL_]: NO_DEFAULT_PRECISION });

    const r = await readPrivacySettings(URL_);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("shape");
    if (r.error.kind !== "shape") return;
    // Name the field, or the error is a boolean with extra steps.
    expect(r.error.issues.join(" ")).toContain("defaultPrecisionMeters");
  });

  it.each(PARTIAL)("rejects a half-written home region: $label", async ({ ttl, missing }) => {
    // THE FAILURE THIS EXISTS TO PREVENT. A reader that treats an absent
    // dy:homeRadiusMeters as zero has no home region and publishes coordinates
    // from the owner's doorstep — while returning `ok`. All three or none.
    const { readPrivacySettings } = await load();
    servePod({ [URL_]: ttl });

    const r = await readPrivacySettings(URL_);
    expect(r.ok, r.ok ? `accepted a home region missing ${missing}` : "").toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("shape");
    if (r.error.kind !== "shape") return;
    expect(r.error.issues.join(" ")).toContain(missing);
  });

  it("accepts no home region at all — the allow-case that keeps the rule useful", async () => {
    // A rule that rejects everything is useless. "I have no home to protect" is
    // a legitimate configuration, and it is NOT the same as "I could not read
    // the settings": here fuzzing still applies to every coordinate, it just
    // never drops one.
    const { readPrivacySettings } = await load();
    servePod({ [URL_]: NO_HOME_AT_ALL });

    const r = await readPrivacySettings(URL_);
    expect(r.ok, r.ok ? "" : podDescribe(r.error)).toBe(true);
    if (!r.ok) return;
    expect(r.value.home).toBeUndefined();
    expect(r.value.defaultPrecisionMeters).toBe(500);
  });

  it("rejects a zero or negative grid size", async () => {
    // A grid of 0 m snaps a coordinate to itself: fuzzing that does nothing,
    // while `dy:precisionMeters 0` tells every reader the point is exact.
    const { readPrivacySettings } = await load();
    for (const bad of ["0", "-500"]) {
      servePod({ [URL_]: mutate("dy:defaultPrecisionMeters 500 .", `dy:defaultPrecisionMeters ${bad} .`) });
      const r = await readPrivacySettings(URL_);
      expect(r.ok, `accepted dy:defaultPrecisionMeters ${bad}`).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe("shape");
    }
  });

  it("rejects a zero or negative home radius", async () => {
    // Same shape as the missing-radius case above, and the same consequence:
    // a circle of zero area protects nothing while looking configured.
    const { readPrivacySettings } = await load();
    for (const bad of ["0", "-3000"]) {
      servePod({ [URL_]: mutate("dy:homeRadiusMeters       3000 ;", `dy:homeRadiusMeters       ${bad} ;`) });
      const r = await readPrivacySettings(URL_);
      expect(r.ok, `accepted dy:homeRadiusMeters ${bad}`).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe("shape");
    }
  });

  it("rejects a coordinate outside the possible range", async () => {
    const { readPrivacySettings } = await load();
    servePod({ [URL_]: mutate("dy:homeLat                45.4655 ;", "dy:homeLat                91.0 ;") });

    const r = await readPrivacySettings(URL_);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("shape");
  });
});

/* ------------------------ difference 4: owner-only, so absence and 401 matter */

describe("readPrivacySettings failures are values, not throws", () => {
  it("reports a Pod that has never had one as a structured 404", async () => {
    // THE COMMON CASE, not the rare one. initialiseContainers creates
    // /travel/settings/ and deliberately writes no document into it (§5), so
    // this is what every brand-new deployment returns until the owner sets a
    // home region. §9: no readable settings, no published coordinate.
    const { readPrivacySettings } = await load();
    servePod({ [URL_]: 404 });

    const r = await readPrivacySettings(URL_);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toEqual({ kind: "http", url: URL_, status: 404 });
  });

  it("reports an anonymous read as a structured 401, never as empty settings", async () => {
    // This resource is owner-only. A caller without a session gets 401, and the
    // one thing that must not happen is for that to arrive as "no home region".
    const { readPrivacySettings } = await load();
    servePod({ [URL_]: 401 });

    const r = await readPrivacySettings(URL_);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toEqual({ kind: "http", url: URL_, status: 401 });
  });

  it("reports a non-Turtle body as a parse error", async () => {
    const { readPrivacySettings } = await load();
    servePod({ [URL_]: "<!doctype html><title>log in</title>" });

    const r = await readPrivacySettings(URL_);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("parse");
  });

  it("reports an unreachable host as a structured network error", async () => {
    const { readPrivacySettings } = await load();
    server.use(http.get(URL_, () => HttpResponse.error()));

    const call = readPrivacySettings(URL_);
    // The invariant: a VALUE, never a throw (§11).
    await expect(call).resolves.toBeDefined();
    const r = await call;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("network");
  });

  it("renders every failure through describe(), which is what a caller shows", async () => {
    const { readPrivacySettings } = await load();
    servePod({ [URL_]: 404 });

    const r = await readPrivacySettings(URL_);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(podDescribe(r.error)).toContain(URL_);
    expect(podDescribe(r.error).length).toBeGreaterThan(0);
  });
});
