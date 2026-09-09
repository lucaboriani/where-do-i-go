/**
 * RDF literal formatting, shared by every serialiser in this project. ONE
 * implementation on purpose: §6 fixes the datatypes, and a second copy of these
 * four lines is how one serialiser writes `1e-7` and the other does not.
 * ./notes.md#one-set-of-literal-formatters
 */
import { DataFactory } from "n3";
import { XSD } from "@/lib/vocab";
import { config } from "@/lib/config";

const { literal, namedNode } = DataFactory;

/**
 * xsd:decimal has no exponent form. `String(1e-7)` is `"1e-7"`, which is
 * reachable through a computed centre when a bbox straddles the equator or the
 * prime meridian narrowly, so format explicitly rather than trusting `String`.
 */
export const decimalLexical = (n: number): string => {
  if (Number.isInteger(n)) return n.toFixed(1);
  const s = String(n);
  if (!/e/i.test(s)) return s;
  // 7 decimal places is ~1cm of latitude; coordinates here are fuzzed anyway.
  return n.toFixed(7).replace(/0+$/, "").replace(/\.$/, ".0");
};

/** Coordinates. Never xsd:float (§6). */
export const dec = (n: number) => literal(decimalLexical(n), namedNode(XSD.decimal));

/** Counts and distances. */
export const int = (n: number) => literal(String(n), namedNode(XSD.integer));

/** An instant, always carrying its UTC offset — the caller supplies the lexical
 *  form because normalising to UTC destroys the fact that it was evening (§7.3). */
export const dt = (s: string) => literal(s, namedNode(XSD.dateTime));

/**
 * Human-readable text, always language-tagged (§6). Falls back to the
 * deployment's default language rather than to no tag at all: an untagged
 * literal is a DIFFERENT RDF term from a tagged one, so writing one now means
 * the value can never be matched against a tagged one later.
 */
export const text = (t: { value: string; language?: string }) =>
  literal(t.value, t.language ?? config.defaultLanguage);
