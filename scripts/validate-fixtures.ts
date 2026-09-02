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

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = resolve(REPO_ROOT, "docs", "data-model.md");
const POD = "https://me.solidcommunity.net";

const XSD = "http://www.w3.org/2001/XMLSchema#";

/** Base URI each turtle block would be served from, in document order. */
const CASES: ReadonlyArray<readonly [string, string]> = [
  ["diary", `${POD}/travel/diary.ttl`],
  ["trip", `${POD}/travel/trips/2026-japan/trip.ttl`],
  ["entry", `${POD}/travel/trips/2026-japan/entries/2026-03-29-arrival.ttl`],
  ["index", `${POD}/travel/trips/2026-japan/entries.ttl`],
  ["profile", `${POD}/profile/card`],
  ["typeindex", `${POD}/settings/publicTypeIndex.ttl`],
];

const GEO_PREDS = ["latitude", "longitude", "#lat", "#long", "bbox", "center"];
const DT_RE = /[+-]\d{2}:\d{2}$|Z$/;

const failures: string[] = [];
const fail = (label: string, msg: string) => failures.push(`[${label}] ${msg}`);

function main(): number {
  const doc = readFileSync(DOC, "utf8");
  const blocks = [...doc.matchAll(/```turtle\n([\s\S]*?)```/g)].map((m) => m[1]);

  if (blocks.length !== CASES.length) {
    console.log(`FAIL: found ${blocks.length} turtle blocks, expected ${CASES.length}.`);
    console.log("Update CASES if the document gained or lost an example.");
    return 1;
  }

  for (const [i, block] of blocks.entries()) {
    const [label, base] = CASES[i];

    let quads: Quad[];
    try {
      quads = new Parser({ baseIRI: base }).parse(block);
    } catch (exc) {
      fail(label, `does not parse standalone: ${exc instanceof Error ? exc.message : String(exc)}`);
      continue;
    }

    for (const q of quads) {
      for (const term of [q.subject, q.predicate, q.object, q.graph] as Term[]) {
        if (term.termType === "BlankNode") {
          fail(label, `blank node in ${q.subject.value} ${q.predicate.value} ${q.object.value}`);
        }
      }
    }

    for (const q of quads) {
      if (q.object.termType !== "Literal") continue;
      const dt = q.object.datatype.value;
      const p = q.predicate.value;
      if (dt === `${XSD}float`) {
        fail(label, `xsd:float literal on ${p} (use xsd:decimal)`);
      }
      if (GEO_PREDS.some((k) => p.includes(k)) && dt !== `${XSD}decimal`) {
        fail(label, `${p} is ${dt}, expected xsd:decimal`);
      }
      if (dt === `${XSD}dateTime` && !DT_RE.test(q.object.value)) {
        fail(label, `dateTime without UTC offset on ${p}: ${q.object.value}`);
      }
    }

    // No IRI should still look relative after resolution.
    for (const q of quads) {
      for (const term of [q.subject, q.object]) {
        const t = term.value;
        if (t.startsWith("../") || t.startsWith("./") || t.split("://").at(-1)!.includes("..")) {
          fail(label, `unresolved relative IRI: ${t}`);
        }
      }
    }

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
