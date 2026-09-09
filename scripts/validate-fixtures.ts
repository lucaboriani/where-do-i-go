#!/usr/bin/env tsx
/**
 * Validate the Turtle fixtures embedded in data-model.md.
 *
 * Checks, for every ```turtle block in the document:
 *   - it parses standalone (all prefixes declared)
 *   - relative IRIs resolve to the intended absolute URLs
 *   - no blank nodes anywhere
 *   - coordinates are xsd:decimal, never xsd:float
 *   - every xsd:dateTime literal carries a UTC offset
 *
 * Run in CI. Uses n3, the same RDF parser the application uses — see
 * docs/decisions.md §23 for what that trade costs.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Parser, type Quad, type Term } from "n3";
import { NS } from "../lib/vocab";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = resolve(REPO_ROOT, "docs", "data-model.md");
const POD = "https://me.solidcommunity.net";

/** Base URI each turtle block would be served from, in document order. */
const CASES: ReadonlyArray<readonly [string, string]> = [
  ["diary", `${POD}/travel/diary.ttl`],
  ["trip", `${POD}/travel/trips/2026-japan/trip.ttl`],
  ["entry", `${POD}/travel/trips/2026-japan/entries/2026-03-29-arrival.ttl`],
  ["index", `${POD}/travel/trips/2026-japan/entries.ttl`],
  ["profile", `${POD}/profile/card`],
  ["typeindex", `${POD}/settings/publicTypeIndex.ttl`],
  // §7.6, and note the path: `travel/settings/`, NOT the `settings/` at the Pod
  // root that the line above serves the type index from. Same segment name,
  // different container, opposite access requirement (§4).
  ["privacy", `${POD}/travel/settings/privacy.ttl`],
];

/**
 * Predicates whose object must be `xsd:decimal` (§6: "never xsd:float for
 * coordinates").
 *
 * `homeLat` and `homeLong` are spelled out because NEITHER matched any existing
 * entry: `#homeLat` does not contain `#lat`, and it is not `latitude` either. So
 * §7.6's coordinate pair arrived unchecked by this rule.
 *
 * WHAT THAT DOES AND DOES NOT COST, measured rather than reasoned. `xsd:float`
 * is banned unconditionally a few lines below, so a float home latitude was
 * caught either way — an earlier draft of this comment claimed otherwise and was
 * wrong. What these two entries actually catch is every OTHER wrong datatype:
 * with them removed, `dy:homeLat "45.4655"` (i.e. `xsd:string`) passes this
 * script while failing `decimal()` in lib/pod/rdf.ts on every real read. With
 * them present it fails here, naming the predicate and both datatypes.
 */
const GEO_PREDS = ["latitude", "longitude", "#lat", "#long", "bbox", "center", "homeLat", "homeLong"];

/**
 * Predicates whose object must be `xsd:integer` (§6: "counts and distances").
 *
 * The other half of the datatype rule, and it was missing entirely — this
 * script banned `xsd:float` and required decimals on coordinates, and said
 * nothing about the integers. A `dy:homeRadiusMeters 3000.0` is `xsd:decimal`,
 * reads back through `integer()` in lib/pod/rdf.ts as a datatype error, and was
 * a perfectly valid fixture as far as this file was concerned. `Meters` covers
 * `precisionMeters`, `homeRadiusMeters` and `defaultPrecisionMeters` at once.
 */
const INT_PREDS = ["Meters", "entryCount", "sortOrder", "schemaVersion", "width", "height"];

const DT_RE = /[+-]\d{2}:\d{2}$|Z$/;

const failures: string[] = [];
const fail = (label: string, msg: string) => failures.push(`[${label}] ${msg}`);

/** Every ```turtle block in the document, in document order — which is the
 *  order `CASES` gives them their base URIs in. */
const turtleBlocks = (doc: string) =>
  [...doc.matchAll(/```turtle\n([\s\S]*?)```/g)].map((m) => m[1]);

/** Parsed at the base URI the block would be served from, or a recorded
 *  failure and nothing left to check. */
function parseBlock(label: string, base: string, block: string): Quad[] | undefined {
  try {
    return new Parser({ baseIRI: base }).parse(block);
  } catch (exc) {
    fail(label, `does not parse standalone: ${exc instanceof Error ? exc.message : String(exc)}`);
    return undefined;
  }
}

/** §6: no blank nodes anywhere. Every term of every quad, because one reached
 *  as an object is the same defect as one reached as a subject. */
function checkNoBlankNodes(label: string, quads: Quad[]): void {
  for (const q of quads) {
    for (const term of [q.subject, q.predicate, q.object, q.graph] as Term[]) {
      if (term.termType === "BlankNode") {
        fail(label, `blank node in ${q.subject.value} ${q.predicate.value} ${q.object.value}`);
      }
    }
  }
}

/** §6's datatype rules: never xsd:float, xsd:decimal for coordinates,
 *  xsd:integer for counts, a UTC offset on every xsd:dateTime. */
function checkDatatypes(label: string, quads: Quad[]): void {
  for (const q of quads) {
    if (q.object.termType !== "Literal") continue;
    const dt = q.object.datatype.value;
    const p = q.predicate.value;
    if (dt === `${NS.xsd}float`) {
      fail(label, `xsd:float literal on ${p} (use xsd:decimal)`);
    }
    if (GEO_PREDS.some((k) => p.includes(k)) && dt !== `${NS.xsd}decimal`) {
      fail(label, `${p} is ${dt}, expected xsd:decimal`);
    }
    if (INT_PREDS.some((k) => p.includes(k)) && dt !== `${NS.xsd}integer`) {
      fail(label, `${p} is ${dt}, expected xsd:integer`);
    }
    if (dt === `${NS.xsd}dateTime` && !DT_RE.test(q.object.value)) {
      fail(label, `dateTime without UTC offset on ${p}: ${q.object.value}`);
    }
  }
}

/** No IRI should still look relative after resolution. */
function checkResolvedIris(label: string, quads: Quad[]): void {
  for (const q of quads) {
    for (const term of [q.subject, q.object]) {
      const t = term.value;
      if (t.startsWith("../") || t.startsWith("./") || t.split("://").at(-1)!.includes("..")) {
        fail(label, `unresolved relative IRI: ${t}`);
      }
    }
  }
}

/** Read, count, then check each block and print its triple count. Split from
 *  59 code lines on 2026-09-09: ./notes.md#fixtures-without-a-test-file */
function main(): number {
  const blocks = turtleBlocks(readFileSync(DOC, "utf8"));

  if (blocks.length !== CASES.length) {
    console.log(`FAIL: found ${blocks.length} turtle blocks, expected ${CASES.length}.`);
    console.log("Update CASES if the document gained or lost an example.");
    return 1;
  }

  for (const [i, block] of blocks.entries()) {
    const [label, base] = CASES[i];
    const quads = parseBlock(label, base, block);
    if (quads === undefined) continue;

    checkNoBlankNodes(label, quads);
    checkDatatypes(label, quads);
    checkResolvedIris(label, quads);

    // Printed even when a check above recorded a failure, exactly as before:
    // the triple count is progress, and the failures are listed together below.
    console.log(`[${label}] ok — ${quads.length} triples`);
  }

  if (failures.length) {
    console.log("\n" + failures.join("\n"));
    console.log(`\n${failures.length} problem(s).`);
    return 1;
  }

  console.log("\nAll fixtures valid.");
  return 0;
}

process.exit(main());
