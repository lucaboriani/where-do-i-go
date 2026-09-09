#!/usr/bin/env tsx
/** lib/vocab.ts and docs/data-model.md must agree about dy:, in BOTH
 *  directions. Run in CI. ./notes.md#why-12-is-excluded-from-the-vocabulary-scan */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DY, DY_CLASS, STATUS, TRAVEL_MODE, NS } from "../lib/vocab";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const full = readFileSync(resolve(REPO_ROOT, "docs", "data-model.md"), "utf8");

/** §12 names terms that deliberately do NOT exist, so scanning it would demand
 *  exports for declined vocabulary. A term graduating out of §12 moves to §3:
 *  ./notes.md#why-12-is-excluded-from-the-vocabulary-scan */
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
