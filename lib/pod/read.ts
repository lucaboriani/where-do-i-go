/**
 * Unauthenticated Pod reads. Imported by BOTH the public site and the studio.
 *
 * Every function returns a typed object or a structured error — never a thrown
 * exception and never raw triples (docs/data-model.md §11). Callers render a
 * fallback for the failure instead of losing the whole page.
 */
import * as z from "zod";
import {
  DCTERMS, DY, DY_CLASS, PROFILE, SCHEMA, SCHEMA_VERSION, STATUS, TRAVEL_MODE,
} from "@/lib/vocab";
import {
  date, decimal, fetchTurtle, integer, itOf, offsetDateTime, viewOf,
  type ReadOptions, type View,
} from "./rdf";
import { describe, err, ok, type PodError, type Result } from "./result";
import {
  Diary, Entry, IndexEntry, OwnerProfile, Place, PrivacySettings, Trip, TripIndex,
  type LangText,
} from "./schema";
import type { Quad } from "n3";

/* ------------------------------------------------------------------ helpers */

/** Unwrap a Result or bail. Keeps extraction readable without exceptions. */
class Bail extends Error {
  constructor(readonly podError: PodError) {
    super(describe(podError));
  }
}
const take = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Bail(r.error);
  return r.value;
};

function guard<T>(fn: () => T): Result<T> {
  try {
    return ok(fn());
  } catch (e) {
    if (e instanceof Bail) return err(e.podError);
    throw e;
  }
}

function langText(view: View, predicate: string): LangText | undefined {
  const lit = view.typed(predicate);
  if (!lit) return undefined;
  return { value: lit.value, language: lit.language || undefined };
}

function statusOf(view: View, url: string): "draft" | "published" {
  const iri = view.one(DY.status);
  if (iri === STATUS.Published) return "published";
  if (iri === STATUS.Draft) return "draft";
  throw new Bail({
    kind: "shape",
    url,
    issues: [`dy:status is ${iri ?? "(absent)"}, expected dy:Published or dy:Draft`],
  });
}

function travelModeOf(view: View): string | undefined {
  const iri = view.one(DY.travelModeFrom);
  if (!iri) return undefined;
  const known = Object.entries(TRAVEL_MODE).find(([, v]) => v === iri);
  // An unknown mode is not fatal: the route renderer skips legs it cannot
  // resolve (§7.3), so a newer app's vocabulary degrades instead of breaking.
  return known?.[0];
}

/** dy:schemaVersion, checked on every top-level read including entries (§11). */
function schemaVersionOf(view: View, url: string): number {
  const lit = view.typed(DY.schemaVersion);
  const n = take(integer(view, DY.schemaVersion, url));
  if (n === undefined || n !== SCHEMA_VERSION) {
    throw new Bail({ kind: "schemaVersion", url, found: lit?.value, expected: SCHEMA_VERSION });
  }
  return n;
}

function validate<S extends z.ZodType>(schema: S, raw: unknown, url: string): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Bail({
      kind: "shape",
      url,
      issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    });
  }
  return parsed.data;
}

function placeOf(quads: Quad[], placeIri: string | undefined, url: string) {
  if (!placeIri) return undefined;
  const v = viewOf(quads, placeIri);
  if (!v.exists) return undefined;
  const geoIri = v.one(SCHEMA.geo);
  const addressIri = v.one(SCHEMA.address);
  const g = geoIri ? viewOf(quads, geoIri) : undefined;
  const a = addressIri ? viewOf(quads, addressIri) : undefined;

  const lat = g ? take(decimal(g, SCHEMA.latitude, url)) : undefined;
  const long = g ? take(decimal(g, SCHEMA.longitude, url)) : undefined;
  const precision = g ? take(integer(g, DY.precisionMeters, url)) : undefined;

  return validate(
    Place,
    {
      name: langText(v, SCHEMA.name),
      locality: a?.typed(SCHEMA.addressLocality)?.value,
      country: a?.one(SCHEMA.addressCountry),
      geo:
        lat !== undefined && long !== undefined
          ? { lat, long, precisionMeters: precision }
          : undefined,
    },
    url,
  );
}

/* -------------------------------------------------------------------- slugs */

/** The container segment IS the slug — that is what makes /trips/[slug]
 *  resolvable without a lookup (§4). Asserted on read; a mismatch makes a trip
 *  unreachable from the web even though it is intact in the Pod. */
export function assertSlug(url: string, slug: string): Result<string> {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  const segment = segments[segments.length - 2];
  return segment === slug ? ok(slug) : err({ kind: "slugMismatch", url, slug, segment: segment ?? "" });
}

/**
 * Entries are files, not containers, so their slug must match the FILENAME
 * rather than the containing directory. Asserted for the same reason as the
 * trip invariant: a mismatch reaches the index, the sitemap and the feed, and
 * every link built from it is dead while the resource looks intact in the Pod.
 */
export function assertEntrySlug(url: string, slug: string): Result<string> {
  const file = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  const segment = file.replace(/\.ttl$/, "");
  return segment === slug ? ok(slug) : err({ kind: "slugMismatch", url, slug, segment });
}

/** Slugs come from route params, so they are attacker-controlled. Unencoded, a
 *  slug containing `#` or `?` silently addresses a different resource:
 *  new URL("travel/trips/a#b/trip.ttl", root) fetches the container
 *  travel/trips/a. Encoding costs nothing and closes it. */
export const tripUrl = (podRoot: string, slug: string) =>
  new URL(`travel/trips/${encodeURIComponent(slug)}/trip.ttl`, podRoot).toString();
export const tripIndexUrl = (podRoot: string, slug: string) =>
  new URL(`travel/trips/${encodeURIComponent(slug)}/entries.ttl`, podRoot).toString();
export const diaryUrl = (podRoot: string) => new URL("travel/diary.ttl", podRoot).toString();

/**
 * The owner-only privacy settings (§7.6).
 *
 * NOT `{storage}settings/publicTypeIndex.ttl`. Same segment name, different
 * container, opposite access requirement — the type index lives at the Pod root
 * and must be publicly readable (§7.5), this one lives under `travel/` and must
 * never be. Revision 2 of the data model already moved the type index out of
 * `/travel/settings/` once; §4 says do not merge them.
 *
 * THIS ONE NORMALISES THE ROOT AND THE OTHERS ABOVE DO NOT, deliberately.
 * `new URL("travel/…", "https://host/pod")` — a root with no trailing slash —
 * resolves against the PARENT of `pod`, so on a multi-pod server (CSS hosts
 * every account under one origin) it addresses a stranger's storage. For
 * `diaryUrl` that is a 404. For this resource it is a read of, and eventually a
 * write to, someone else's home coordinates. `config.podRoot` appends the slash
 * so nothing in the app reaches here without one; this is the belt to that
 * braces, at the one URL where being wrong is not merely a missing page.
 */
export const privacySettingsUrl = (podRoot: string) =>
  new URL("travel/settings/privacy.ttl", podRoot.endsWith("/") ? podRoot : `${podRoot}/`).toString();

/* --------------------------------------------------------------------- read */

export async function readTrip(url: string, opts?: ReadOptions): Promise<Result<Trip>> {
  const fetched = await fetchTurtle(url, opts);
  if (!fetched.ok) return fetched;
  const { quads } = fetched.value;

  return guard(() => {
    const v = viewOf(quads, itOf(url));
    if (!v.exists) throw new Bail({ kind: "shape", url, issues: ["no <#it> subject"] });
    if (!v.types().includes(DY_CLASS.Trip)) {
      throw new Bail({ kind: "shape", url, issues: [`<#it> is not a ${DY_CLASS.Trip}`] });
    }
    const slug = v.typed(DY.slug)?.value ?? "";
    take(assertSlug(url, slug));

    return validate(
      Trip,
      {
        iri: itOf(url),
        slug,
        status: statusOf(v, url),
        schemaVersion: schemaVersionOf(v, url),
        name: langText(v, SCHEMA.name),
        description: langText(v, SCHEMA.description),
        startDate: take(date(v, DY.startDate, url)),
        endDate: take(date(v, DY.endDate, url)),
        index: v.one(DY.index),
        coverImage: v.one(DY.coverImage),
        track: v.one(DY.track),
        tags: v.all(DY.tag),
        origin: placeOf(quads, v.one(SCHEMA.tripOrigin), url),
        created: take(offsetDateTime(v, DCTERMS.created, url)),
        modified: take(offsetDateTime(v, DCTERMS.modified, url)),
      },
      url,
    );
  });
}

export async function readEntry(url: string, opts?: ReadOptions): Promise<Result<Entry>> {
  const fetched = await fetchTurtle(url, opts);
  if (!fetched.ok) return fetched;
  const { quads } = fetched.value;

  return guard(() => {
    const v = viewOf(quads, itOf(url));
    if (!v.exists) throw new Bail({ kind: "shape", url, issues: ["no <#it> subject"] });

    const photos = v
      .all(SCHEMA.image)
      .map((iri) => viewOf(quads, iri))
      .filter((p) => p.exists)
      .map((p) => ({
        contentUrl: p.one(SCHEMA.contentUrl),
        thumbnailUrl: p.one(SCHEMA.thumbnailUrl),
        caption: langText(p, SCHEMA.caption),
        width: take(integer(p, SCHEMA.width, url)),
        height: take(integer(p, SCHEMA.height, url)),
        sortOrder: take(integer(p, DY.sortOrder, url)),
        // Plain literals, both of them: a media type is a code and base64 is
        // not prose, so neither carries a language tag and `langText` would be
        // the wrong reader for either.
        encodingFormat: p.typed(SCHEMA.encodingFormat)?.value,
        dateCreated: take(offsetDateTime(p, SCHEMA.dateCreated, url)),
        blurDataUrl: p.typed(DY.blurDataUrl)?.value,
      }))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    if (!v.types().includes(DY_CLASS.Entry)) {
      throw new Bail({ kind: "shape", url, issues: [`<#it> is not a ${DY_CLASS.Entry}`] });
    }
    const slug = v.typed(DY.slug)?.value ?? "";
    take(assertEntrySlug(url, slug));

    return validate(
      Entry,
      {
        iri: itOf(url),
        slug,
        status: statusOf(v, url),
        schemaVersion: schemaVersionOf(v, url),
        headline: langText(v, SCHEMA.headline),
        articleBody: langText(v, SCHEMA.articleBody),
        trip: v.one(DY.trip),
        occurredAt: take(offsetDateTime(v, DY.occurredAt, url)),
        datePublished: take(offsetDateTime(v, SCHEMA.datePublished, url)),
        travelModeFrom: travelModeOf(v),
        place: placeOf(quads, v.one(SCHEMA.contentLocation), url),
        photos,
        tags: v.all(DY.tag),
        // Read even though nothing renders them: an edit that rewrites this
        // resource without carrying them forward destroys them (§7.3, and the
        // note on Entry in schema.ts). readTrip has always read `created`.
        created: take(offsetDateTime(v, DCTERMS.created, url)),
        creator: v.one(DCTERMS.creator),
        modified: take(offsetDateTime(v, DCTERMS.modified, url)),
      },
      url,
    );
  });
}

/**
 * §7.4 parsed out of quads — the index's `<#it>` and one `<#e-slug>` row per
 * entry. Named rather than an anonymous arrow inside `readTripIndexWithEtag`,
 * so that it can be cited, tested directly and reported by name; it was 55
 * lines of "Arrow function" until 2026-09-08.
 */
function tripIndexOf(quads: Quad[], url: string): TripIndex {
  const v = viewOf(quads, itOf(url));
  if (!v.exists) throw new Bail({ kind: "shape", url, issues: ["no <#it> subject"] });

  if (!v.types().includes(DY_CLASS.TripIndex)) {
    throw new Bail({ kind: "shape", url, issues: [`<#it> is not a ${DY_CLASS.TripIndex}`] });
  }

  const entries = v
    .all(DY.entry)
    .map((iri) => viewOf(quads, iri))
    .filter((e) => e.exists)
    .map((e) =>
      validate(
        IndexEntry,
        {
          iri: e.subject,
          entryResource: e.one(DY.entryResource),
          title: langText(e, DCTERMS.title),
          slug: e.typed(DY.slug)?.value,
          occurredAt: take(offsetDateTime(e, DY.occurredAt, url)),
          lat: take(decimal(e, DY.lat, url)),
          long: take(decimal(e, DY.long, url)),
          precisionMeters: take(integer(e, DY.precisionMeters, url)),
          thumbnail: e.one(DY.thumbnail),
          travelModeFrom: travelModeOf(e),
          // No default: §6 forbids relying on parse order, and a silent 0
          // does exactly that. Absent becomes a shape error via the schema.
          sortOrder: take(integer(e, DY.sortOrder, url)),
        },
        url,
      ),
    )
    // Parse order carries no meaning; dy:sortOrder is why it exists (§6).
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const bboxParts = {
    west: take(decimal(v, DY.bboxWest, url)),
    south: take(decimal(v, DY.bboxSouth, url)),
    east: take(decimal(v, DY.bboxEast, url)),
    north: take(decimal(v, DY.bboxNorth, url)),
  };
  const centerLat = take(decimal(v, DY.centerLat, url));
  const centerLong = take(decimal(v, DY.centerLong, url));

  return validate(
    TripIndex,
    {
      iri: itOf(url),
      indexOf: v.one(DY.indexOf),
      schemaVersion: schemaVersionOf(v, url),
      entryCount: take(integer(v, DY.entryCount, url)),
      bbox: Object.values(bboxParts).every((n) => n !== undefined) ? bboxParts : undefined,
      center: centerLat !== undefined && centerLong !== undefined
        ? { lat: centerLat, long: centerLong }
        : undefined,
      entries,
      modified: take(offsetDateTime(v, DCTERMS.modified, url)),
    },
    url,
  );
}

/** The same parse, as the Result this module promises its callers — nothing
 *  here throws, so the Bail-throwing form above stays private and this is what
 *  a caller holding a parsed body rather than a URL reaches for. */
export function parseTripIndex(quads: Quad[], url: string): Result<TripIndex> {
  return guard(() => tripIndexOf(quads, url));
}

/**
 * The index, plus the ETag of the response it was parsed from.
 *
 * §10 step 3 is "read `entries.ttl`, insert the index entry, recompute … write
 * back with `If-Match`", and the ETag that makes that safe is the one from the
 * read that produced the state being edited. Splitting it into a HEAD for the
 * ETag and a GET for the body opens a window in which the two disagree: HEAD
 * first and the write fails with 412 for no reason, GET first and a concurrent
 * change is silently overwritten by a precondition that has already been
 * satisfied. So one request returns both.
 *
 * `readTripIndex` is this function with the ETag dropped, rather than a second
 * copy of the extraction — there is one parser for this resource.
 */
export async function readTripIndexWithEtag(
  url: string,
  opts?: ReadOptions,
): Promise<Result<{ index: TripIndex; etag: string | null }>> {
  const fetched = await fetchTurtle(url, opts);
  if (!fetched.ok) return fetched;
  const { quads, etag } = fetched.value;

  const parsed = parseTripIndex(quads, url);
  return parsed.ok ? ok({ index: parsed.value, etag }) : parsed;
}

export async function readTripIndex(url: string, opts?: ReadOptions): Promise<Result<TripIndex>> {
  const read = await readTripIndexWithEtag(url, opts);
  return read.ok ? ok(read.value.index) : read;
}

export async function readDiary(url: string, opts?: ReadOptions): Promise<Result<Diary>> {
  const fetched = await fetchTurtle(url, opts);
  if (!fetched.ok) return fetched;
  const { quads } = fetched.value;

  return guard(() => {
    const v = viewOf(quads, itOf(url));
    if (!v.exists) throw new Bail({ kind: "shape", url, issues: ["no <#it> subject"] });
    if (!v.types().includes(DY_CLASS.Diary)) {
      throw new Bail({ kind: "shape", url, issues: [`<#it> is not a ${DY_CLASS.Diary}`] });
    }
    return validate(
      Diary,
      {
        iri: itOf(url),
        schemaVersion: schemaVersionOf(v, url),
        title: langText(v, DCTERMS.title),
        description: langText(v, DCTERMS.description),
        creator: v.one(DCTERMS.creator),
        trips: v.all(DY.trip),
        modified: take(offsetDateTime(v, DCTERMS.modified, url)),
      },
      url,
    );
  });
}


/**
 * The owner's privacy settings (§7.6) — the home region and the default grid,
 * read before any coordinate is written (§9).
 *
 * Modelled on `readOwnerProfile`, which is the other read here that is not part
 * of the public render path. FIVE THINGS DIFFER, and each is something a later
 * "make these consistent" pass would get exactly backwards. Each is pinned by a
 * test in test/privacy-settings.test.ts.
 *
 * 1. THE SUBJECT IS `<#it>`. `readOwnerProfile` uses the whole WebID, fragment
 *    included, because a WebID *is* a fragment IRI naming a person and the
 *    fragment is not ours to choose. This is our own resource, so §6's rule
 *    applies unchanged: "every subject is a fragment, never a bare document
 *    URL, never a blank node".
 *
 * 2. `dy:schemaVersion` IS CHECKED. `readOwnerProfile` deliberately skips it —
 *    the WebID document is not ours and will never carry our version. This
 *    resource is ours, so §11's "check it on every top-level read" applies in
 *    full. It matters more here than elsewhere: a settings document written by
 *    a later version of this app could mean something different by the same
 *    four predicates, and acting on a misread home radius is not a rendering
 *    glitch.
 *
 * 3. DATATYPES ARE ENFORCED — `xsd:decimal` for the coordinate pair (never
 *    float), `xsd:integer` for the two distances (§6). `readOwnerProfile` reads
 *    only IRIs and enforces nothing. Without this a `"3000"^^xsd:string` radius
 *    reads back as the number 3000 with nothing complaining.
 *
 * 4. IT NEEDS AN AUTHENTICATED FETCH. `readOwnerProfile` is unauthenticated by
 *    design; this resource is owner-only, so a caller without a session gets
 *    401 — and on ESS an anonymous 401 does not even distinguish private from
 *    missing (§13). Both arrive here as a structured `http` error, which is the
 *    right answer either way: see below.
 *
 * 5. THERE ARE NO DEFAULTS, ANYWHERE. This is the fail-closed contract in §9,
 *    and it is the whole reason this function exists rather than a config
 *    lookup. Absent, unreadable, wrong version, half-written home region — all
 *    of them are errors, and every caller publishes NO coordinate on any error.
 *    An absent `dy:homeRadiusMeters` read as zero is a home region of no area,
 *    i.e. no protection, reported as success.
 *
 * NO `rdf:type` GATE, which it shares with `readOwnerProfile` but for a
 * different reason. There is no class for this resource: §3's four privacy
 * terms are the four that were agreed with the owner, and a class would be a
 * fifth (CLAUDE.md, "ask before doing"). §7.6 records that, and records that
 * adding one later is purely additive. `dy:schemaVersion` plus the shape is the
 * gate — which is what it would have to be regardless, since a type triple
 * never protected against a document that parses and means something else.
 *
 * ON THE COMMON CASE, WHICH IS AN ERROR. A Pod that has never had a
 * `privacy.ttl` returns 404 here, and `initialiseContainers()` creates the
 * container but deliberately writes no document into it (§5). So every fresh
 * deployment fails this read until the owner sets a home region, and §9 makes
 * that mean "no coordinates are published". That is intended. It is also
 * something the studio has to SAY — an entry silently losing its map pin
 * becomes a bug report, whereas "you have not set a home region yet" is a
 * one-time setup step with an obvious fix.
 */
export async function readPrivacySettings(
  url: string,
  opts?: ReadOptions,
): Promise<Result<PrivacySettings>> {
  const fetched = await fetchTurtle(url, opts);
  if (!fetched.ok) return fetched;
  const { quads } = fetched.value;

  return guard(() => {
    const v = viewOf(quads, itOf(url));
    if (!v.exists) throw new Bail({ kind: "shape", url, issues: ["no <#it> subject"] });

    const lat = take(decimal(v, DY.homeLat, url));
    const long = take(decimal(v, DY.homeLong, url));
    const radiusMeters = take(integer(v, DY.homeRadiusMeters, url));

    // ALL THREE OR NONE, and the difference is decided here rather than in the
    // schema, because Zod cannot tell "absent" from "absent" once the object
    // has been built. None of them present is a legitimate setting — "I have no
    // home to protect" — and fuzzing still applies to every coordinate; it just
    // never drops one. ANY of them present commits to a home region, so a
    // missing sibling is a shape error naming the field rather than a silent
    // downgrade to no protection at all.
    const declaresHome = lat !== undefined || long !== undefined || radiusMeters !== undefined;

    return validate(
      PrivacySettings,
      {
        iri: itOf(url),
        schemaVersion: schemaVersionOf(v, url),
        home: declaresHome ? { lat, long, radiusMeters } : undefined,
        defaultPrecisionMeters: take(integer(v, DY.defaultPrecisionMeters, url)),
        modified: take(offsetDateTime(v, DCTERMS.modified, url)),
      },
      url,
    );
  });
}

/**
 * The owner's WebID profile, read unauthenticated (§7.5).
 *
 * The studio's server component calls this to discover `solid:oidcIssuer` and
 * hand it to the client shell, because `session.login()` takes `oidcIssuer` as
 * a mandatory option and there is deliberately no OIDC_ISSUER env var: the
 * WebID document is the one place that reliably carries it.
 *
 * THREE THINGS HERE ARE DELIBERATELY UNLIKE EVERY OTHER READ IN THIS FILE.
 * Each looks like an omission. Each is load-bearing, and each is pinned by a
 * test in test/owner-profile.test.ts — do not "tidy" them away.
 *
 * 1. The subject is the WHOLE WebID, fragment included — `viewOf(quads, webId)`
 *    rather than `itOf(url)`. A WebID is a fragment IRI: the document fetched
 *    is the WebID with its fragment stripped, and the subject described inside
 *    it is the WebID in full. The fragment is not always `#me` (CSS and ESS
 *    both allow any), and it is never our `#it` convention — a profile may well
 *    carry an unrelated `<#it>` subject, and reading that hands `login()` the
 *    wrong identity provider.
 *
 * 2. NO `dy:schemaVersion` CHECK, though CLAUDE.md requires one on every
 *    top-level read. That rule is about *our* resources. The WebID document is
 *    not ours — on ESS the identity provider serves it and answers `PATCH` with
 *    405 — so it will never carry our version, and a version gate here would
 *    reject every real Pod. A profile declaring a version we would otherwise
 *    refuse is still read straight past.
 *
 * 3. NO `rdf:type` GATE. §7.5 types the subject `foaf:Agent`, but nothing here
 *    depends on it and plenty of real profiles omit it. What matters is the
 *    issuer, and its absence is caught by the schema.
 */
export async function readOwnerProfile(
  webId: string,
  opts?: ReadOptions,
): Promise<Result<OwnerProfile>> {
  let doc: string;
  let subject: string;
  try {
    const u = new URL(webId);
    subject = u.href;
    // Fetch the document, not the fragment. Servers ignore fragments, but the
    // caller-supplied fetch is observable and the base IRI used for parsing has
    // to be the document, or every relative IRI in the profile resolves wrong.
    u.hash = "";
    doc = u.href;
  } catch {
    // A WebID reaches this from configuration, so a malformed one is a value to
    // report, not a throw escaping a read that promises never to throw.
    return err({ kind: "shape", url: webId, issues: [`webId is not an absolute IRI: ${webId}`] });
  }

  const fetched = await fetchTurtle(doc, opts);
  if (!fetched.ok) return fetched;
  const { quads } = fetched.value;

  return guard(() => {
    const v = viewOf(quads, subject);
    if (!v.exists) {
      // Mirrors readDiary's "no <#it> subject": the document parsed, it just
      // does not describe the WebID it was reached through. `url` is the
      // document, as it is for every other error on this path.
      throw new Bail({ kind: "shape", url: doc, issues: [`no <${subject}> subject`] });
    }
    return validate(
      OwnerProfile,
      {
        oidcIssuer: v.one(PROFILE.oidcIssuer),
        // §7.5: the Pod root comes from pim:storage and never from the WebID's
        // origin — on ESS identity and storage are different hosts entirely.
        storage: v.one(PROFILE.storage),
        seeAlso: v.one(PROFILE.seeAlso),
      },
      doc,
    );
  });
}

export { describe } from "./result";
export type { PodError, Result } from "./result";
export type { ReadOptions } from "./rdf";
