/**
 * Unauthenticated Pod reads. Imported by BOTH the public site and the studio.
 *
 * Every function returns a typed object or a structured error — never a thrown
 * exception and never raw triples (docs/data-model.md §11). Callers render a
 * fallback for the failure instead of losing the whole page.
 */
import * as z from "zod";
import {
  DCTERMS, DY, DY_CLASS, SCHEMA, SCHEMA_VERSION, STATUS, TRAVEL_MODE,
} from "@/lib/vocab";
import {
  date, decimal, fetchTurtle, integer, itOf, offsetDateTime, viewOf,
  type ReadOptions, type View,
} from "./rdf";
import { describe, err, ok, type PodError, type Result } from "./result";
import {
  Diary, Entry, IndexEntry, Place, Trip, TripIndex, type LangText,
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
        modified: take(offsetDateTime(v, DCTERMS.modified, url)),
      },
      url,
    );
  });
}

export async function readTripIndex(url: string, opts?: ReadOptions): Promise<Result<TripIndex>> {
  const fetched = await fetchTurtle(url, opts);
  if (!fetched.ok) return fetched;
  const { quads } = fetched.value;

  return guard(() => {
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
  });
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

export { describe } from "./result";
export type { PodError, Result } from "./result";
export type { ReadOptions } from "./rdf";
