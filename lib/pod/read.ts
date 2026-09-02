/**
 * Unauthenticated Pod reads. Imported by BOTH the public site and the studio.
 *
 * Everything here uses plain `fetch` with no Solid auth library — phase 0
 * verified that a genuinely public resource is readable this way on both
 * Community Solid Server and Inrupt ESS, even though ESS answers protected
 * resources with a UMA challenge (docs/phase-0-spike.md).
 *
 * Phase 1 fills this in: every read returns a typed object or a structured
 * error via Zod, checks dy:schemaVersion, and never lets a component index into
 * raw triples (docs/data-model.md §11).
 */
export {};
