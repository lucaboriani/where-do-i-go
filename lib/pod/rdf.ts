/**
 * Turtle fetching and quad access. Unauthenticated: plain `fetch`, no Solid
 * library, no credentials — phase 0 verified this works for public resources on
 * both Community Solid Server (WAC) and Inrupt ESS (ACP), even though ESS
 * answers *protected* resources with a UMA challenge.
 *
 * Nothing above this layer touches quads directly.
 */
import { Parser, type Quad } from "n3";
import { RDF, XSD } from "@/lib/vocab";
import { err, ok, type Result } from "./result";

export type Fetched = { url: string; quads: Quad[]; etag: string | null };

/** The studio passes its authenticated fetch here so the same read path can see
 *  drafts; the public site passes nothing and gets plain unauthenticated fetch. */
export type PodFetch = typeof globalThis.fetch;
export type ReadOptions = { fetch?: PodFetch; init?: RequestInit };

export async function fetchTurtle(url: string, opts: ReadOptions = {}): Promise<Result<Fetched>> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      ...opts.init,
      headers: { accept: "text/turtle", ...(opts.init?.headers ?? {}) },
    });
  } catch (cause) {
    return err({ kind: "network", url, message: cause instanceof Error ? cause.message : String(cause) });
  }
  if (!res.ok) return err({ kind: "http", url, status: res.status });

  const body = await res.text();
  try {
    // baseIRI is mandatory: Pod resources use relative IRIs throughout, and a
    // parse without it silently yields terms that never resolve.
    const quads = new Parser({ baseIRI: url }).parse(body);
    return ok({ url, quads, etag: res.headers.get("etag") });
  } catch (cause) {
    return err({ kind: "parse", url, message: cause instanceof Error ? cause.message : String(cause) });
  }
}

/** `<doc.ttl>` → `<doc.ttl#it>`. Every resource's primary subject is a fragment;
 *  blank nodes are banned outright (§6). */
export const itOf = (url: string) => `${url}#it`;
export const fragmentOf = (url: string, fragment: string) => `${url}#${fragment}`;

export type View = ReturnType<typeof viewOf>;

export function viewOf(quads: Quad[], subject: string) {
  const mine = quads.filter((q) => q.subject.value === subject);
  const objects = (predicate: string) => mine.filter((q) => q.predicate.value === predicate);

  return {
    subject,
    /** Present at all? Distinguishes "absent" from "malformed". */
    exists: mine.length > 0,
    types: () =>
      objects(RDF.type).map((q) => q.object.value),
    one: (predicate: string) => objects(predicate)[0]?.object.value,
    all: (predicate: string) => objects(predicate).map((q) => q.object.value),
    /** Literal plus its datatype, so callers can enforce §6's explicit-datatype
     *  rule instead of trusting the lexical form. */
    typed: (predicate: string) => {
      const term = objects(predicate)[0]?.object;
      if (!term || term.termType !== "Literal") return undefined;
      return { value: term.value, datatype: term.datatype.value, language: term.language };
    },
  };
}

/** Coordinates are xsd:decimal, never xsd:float (§6). Enforced on read, because
 *  a Pod contains whatever was written to it — including by an older version of
 *  this app, or someone else's. */
export function decimal(view: View, predicate: string, url: string): Result<number | undefined> {
  const lit = view.typed(predicate);
  if (!lit) return ok(undefined);
  if (lit.datatype !== XSD.decimal) {
    return err({ kind: "datatype", url, predicate, found: lit.datatype, expected: XSD.decimal });
  }
  const n = Number(lit.value);
  return Number.isFinite(n)
    ? ok(n)
    : err({ kind: "shape", url, issues: [`${predicate} is not a number: ${lit.value}`] });
}

/** Counts and distances are xsd:integer (§6). Without this check a
 *  `"14"^^xsd:string` reads back as the number 14 and nothing complains, which
 *  is exactly the silent-wrong-value the structured-error design exists to
 *  prevent. */
export function integer(view: View, predicate: string, url: string): Result<number | undefined> {
  const lit = view.typed(predicate);
  if (!lit) return ok(undefined);
  if (lit.datatype !== XSD.integer) {
    return err({ kind: "datatype", url, predicate, found: lit.datatype, expected: XSD.integer });
  }
  const n = Number(lit.value);
  return Number.isInteger(n)
    ? ok(n)
    : err({ kind: "shape", url, issues: [`${predicate} is not an integer: ${lit.value}`] });
}

/** Trip extent is xsd:date — a travel diary wants dates, not times (§7.2). */
export function date(view: View, predicate: string, url: string): Result<string | undefined> {
  const lit = view.typed(predicate);
  if (!lit) return ok(undefined);
  if (lit.datatype !== XSD.date) {
    return err({ kind: "datatype", url, predicate, found: lit.datatype, expected: XSD.date });
  }
  return ok(lit.value);
}

/** xsd:dateTime with a UTC offset. Normalising to UTC destroys the fact that it
 *  was evening, which for a travel diary is most of the meaning (§7.3). */
const OFFSET = /([+-]\d{2}:\d{2}|Z)$/;

export function offsetDateTime(view: View, predicate: string, url: string): Result<string | undefined> {
  const lit = view.typed(predicate);
  if (!lit) return ok(undefined);
  if (lit.datatype !== XSD.dateTime) {
    return err({ kind: "datatype", url, predicate, found: lit.datatype, expected: XSD.dateTime });
  }
  if (!OFFSET.test(lit.value)) {
    return err({ kind: "shape", url, issues: [`${predicate} has no UTC offset: ${lit.value}`] });
  }
  return ok(lit.value);
}
