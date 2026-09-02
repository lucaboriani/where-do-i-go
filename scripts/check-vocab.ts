#!/usr/bin/env tsx
/**
 * Assert lib/vocab.ts and docs/data-model.md agree about the dy: vocabulary,
 * in BOTH directions. This is what stops the data model rotting: a term added
 * to the document but never exported is unusable, and a term exported but no
 * longer in the document is a predicate nobody agreed to write to a Pod.
 *
 * Run in CI.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DY, DY_CLASS, STATUS, TRAVEL_MODE, NS } from "../lib/vocab";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const full = readFileSync(resolve(REPO_ROOT, "docs", "data-model.md"), "utf8");

/**
 * §12 "Deliberately out of scope" names terms that intentionally do NOT exist —
 * dy:companionTrip for multi-traveler trips, for instance. Scanning it would
 * demand exports for vocabulary the document explicitly declines to define, so
 * the section is excluded. If a term graduates out of §12 it must move into §3,
 * which is where this check looks.
 */
const OUT_OF_SCOPE = /## 12\. Deliberately out of scope[\s\S]*?(?=\n## \d+\.)/;
const doc = full.replace(OUT_OF_SCOPE, "");

/** Every `dy:Term` mentioned anywhere in the document, prose and Turtle alike. */
const inDoc = new Set(
  [...doc.matchAll(/\bdy:([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]),
);

/** Every dy: term exported from lib/vocab.ts. */
const exported = new Set(
  [DY, DY_CLASS, STATUS, TRAVEL_MODE]
    .flatMap((group) => Object.values(group) as string[])
    .filter((iri) => iri.startsWith(NS.dy))
    .map((iri) => iri.slice(NS.dy.length)),
);

const missingFromVocab = [...inDoc].filter((t) => !exported.has(t)).sort();
const missingFromDoc = [...exported].filter((t) => !inDoc.has(t)).sort();

console.log(`  docs/data-model.md: ${inDoc.size} dy: terms`);
console.log(`  lib/vocab.ts:       ${exported.size} dy: terms`);

if (missingFromVocab.length) {
  console.log("\nIn the data model but NOT exported from lib/vocab.ts:");
  for (const t of missingFromVocab) console.log(`  - dy:${t}`);
}
if (missingFromDoc.length) {
  console.log("\nExported from lib/vocab.ts but NOT in the data model:");
  for (const t of missingFromDoc) console.log(`  - dy:${t}`);
}

if (missingFromVocab.length || missingFromDoc.length) {
  console.log(
    "\nThe data model is normative. Either add the term to lib/vocab.ts, or " +
      "remove it from the export — and if a dy: term is genuinely changing, " +
      "CLAUDE.md says ask first.",
  );
  process.exit(1);
}
console.log("\nVocabulary matches the data model in both directions.");
