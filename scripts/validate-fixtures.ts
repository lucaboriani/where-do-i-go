#!/usr/bin/env tsx
/** Validate the Turtle fixtures embedded in docs/data-model.md: parses
 *  standalone, IRIs resolve, no blank nodes, xsd:decimal coordinates,
 *  offset-bearing dateTimes. Run in CI.
 *  ./notes.md#what-the-fixture-validator-checks-and-with-what */
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

/** §6: coordinates are xsd:decimal, never xsd:float. `homeLat`/`homeLong` are
 *  spelled out because neither matched any other entry, so §7.6's pair was
 *  unchecked: ./notes.md#the-two-datatype-lists-and-what-each-was-missing */
const GEO_PREDS = ["latitude", "longitude", "#lat", "#long", "bbox", "center", "homeLat", "homeLong"];

/** §6: counts and distances are xsd:integer. This half was missing entirely -
 *  homeRadiusMeters 3000.0 was a valid fixture and a read-time datatype error:
 *  ./notes.md#the-two-datatype-lists-and-what-each-was-missing */
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
