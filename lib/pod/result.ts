/**
 * Structured results for every Pod read. §11: a read returns a typed object or
 * a structured error, and a component never indexes into raw triples. A thrown
 * exception is not a structured error — the public site has to render something
 * when one trip in an index is malformed, so failures are values.
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
   * Distinct from `http` on purpose: A 2XX PROVES THE WRITE, NOT THE RULE.
   * ./notes.md#a-2xx-write-proves-the-write-not-the-access-rule
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
