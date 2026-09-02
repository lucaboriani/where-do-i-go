import { Parser } from "n3";

/**
 * §11: compare RDF by triple set, never bytes. Turtle has no canonical form —
 * prefix order, grouping, whitespace and 35.6938 vs 35.69380 are all free
 * choices any library upgrade may change.
 *
 * Because blank nodes are banned outright (§6), isomorphism collapses to set
 * equality: with every subject a named node, there is nothing to map. That is a
 * real dividend of the no-blank-nodes rule, not a shortcut.
 */
const key = (t: { termType: string; value: string; datatype?: { value: string }; language?: string }) =>
  t.termType === "Literal"
    ? `L|${t.value}|${t.datatype?.value ?? ""}|${t.language ?? ""}`
    : `N|${t.value}`;

export function triples(turtle: string, baseIRI: string): Set<string> {
  const quads = new Parser({ baseIRI }).parse(turtle);
  for (const q of quads) {
    for (const term of [q.subject, q.predicate, q.object]) {
      if (term.termType === "BlankNode") throw new Error(`blank node in graph: ${term.value}`);
    }
  }
  return new Set(quads.map((q) => `${key(q.subject)} ${key(q.predicate)} ${key(q.object)}`));
}

export function graphEquals(a: string, b: string, baseIRI: string) {
  const [x, y] = [triples(a, baseIRI), triples(b, baseIRI)];
  const missing = [...x].filter((t) => !y.has(t));
  const extra = [...y].filter((t) => !x.has(t));
  return { equal: missing.length === 0 && extra.length === 0, missing, extra };
}
