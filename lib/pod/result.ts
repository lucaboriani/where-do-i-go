/**
 * Structured results for every Pod read.
 *
 * docs/data-model.md §11: "Every read goes through a parser returning a typed
 * object or a structured error. Never index into raw triples inside a
 * component." A thrown exception is not a structured error — the public site
 * has to render *something* when one trip in an index is malformed, so failures
 * are values, not control flow.
 */

export type PodError =
  | { kind: "network"; url: string; message: string }
  | { kind: "http"; url: string; status: number }
  | { kind: "parse"; url: string; message: string }
  | { kind: "shape"; url: string; issues: string[] }
  | { kind: "schemaVersion"; url: string; found: string | undefined; expected: number }
  | { kind: "datatype"; url: string; predicate: string; found: string | undefined; expected: string }
  | { kind: "slugMismatch"; url: string; slug: string; segment: string }
  /**
   * Access control was written, or read, and the result could not be confirmed.
   *
   * Distinct from `http` on purpose: the request may well have returned 2xx.
   * "A 200 write response proves nothing — the only evidence that counts is the
   * failed read" (docs/phase-0-spike.md, question 3), so lib/pod/access.ts
   * reads the resulting access back and reports this when what came back is not
   * what it asked for, or when the server says nothing it can act on.
   *
   * It is also the honest answer to "is this public?" when access could not be
   * determined. Collapsing that into `read: false` tells the owner their entry
   * is private on no evidence at all, and the owner acts on what is shown.
   */
  | { kind: "accessUnverified"; url: string; expected: string; found: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: PodError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(error: PodError): Result<T> => ({ ok: false, error });

/** A one-line description, safe to log or show in a fallback. */
export function describe(error: PodError): string {
  switch (error.kind) {
    case "network":
      return `could not reach ${error.url}: ${error.message}`;
    case "http":
      return `${error.url} returned HTTP ${error.status}`;
    case "parse":
      return `${error.url} is not valid Turtle: ${error.message}`;
    case "shape":
      return `${error.url} does not match the data model: ${error.issues.join("; ")}`;
    case "schemaVersion":
      return `${error.url} declares dy:schemaVersion ${error.found ?? "(absent)"}, expected ${error.expected}`;
    case "datatype":
      return `${error.url}: ${error.predicate} has datatype ${error.found ?? "(none)"}, expected ${error.expected}`;
    case "slugMismatch":
      return `${error.url}: dy:slug "${error.slug}" does not match container segment "${error.segment}"`;
    case "accessUnverified":
      return `could not verify access on ${error.url}: expected ${error.expected}, found ${error.found}`;
  }
}
