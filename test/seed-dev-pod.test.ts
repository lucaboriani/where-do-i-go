import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The seeder covers every trip the §7.1 diary fixture names — it used to delete
 * one on its way to the Pod. BOTH SIDES ARE DERIVED, neither hand-typed: a
 * hand-typed copy is how an earlier gap stayed invisible (see guardrails.test.ts
 * on BELTED_MODULES). ../scripts/notes.md#deriving-a-second-trip-from-the-fixtures
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const doc = readFileSync(resolve(ROOT, "docs", "data-model.md"), "utf8");
const seeder = readFileSync(resolve(ROOT, "scripts", "seed-dev-pod.ts"), "utf8");

/** Located by CONTENT, not by position: the seeder takes the first turtle
 *  fence, and a block inserted above it would move the fixture, not rename it. */
function diaryFixture(): string {
  const blocks = [...doc.matchAll(/```turtle\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .filter((block) => /a\s+dy:Diary\b/.test(block));
  expect(blocks, "docs/data-model.md should hold exactly one `a dy:Diary` turtle block").toHaveLength(
    1,
  );
  return blocks[0];
}

/** The trip slugs the diary fixture points `dy:trip` at. */
function fixtureTripSlugs(): string[] {
  return [...diaryFixture().matchAll(/<trips\/([^/>]+)\/trip\.ttl#it>/g)].map((m) => m[1]);
}

/** The trip slugs the seeder actually writes a resource for, read off its PUT
 *  paths. `travel/trips/<slug>/trip.ttl` is the §4 layout and the only spelling
 *  the script uses. */
function seededTripSlugs(): string[] {
  return [...seeder.matchAll(/["'`]travel\/trips\/([^/"'`]+)\/trip\.ttl["'`]/g)].map((m) => m[1]);
}

/** Containers the seeder creates, same source, same reason: a PUT into a
 *  container that does not exist is a 404, not a trip. */
function seededContainers(): string[] {
  return [...seeder.matchAll(/["'`]travel\/trips\/([^/"'`]+)\/["'`]/g)].map((m) => m[1]);
}

describe("scripts/seed-dev-pod.ts seeds what docs/data-model.md describes", () => {
  it("the derivation finds something on both sides, so the check below is not vacuous", () => {
    // Controls. An empty fixture list makes "every one is covered" trivially
    // true, which is exactly the green-run-that-verified-nothing this repo
    // keeps meeting; an empty seeded list means the path regex stopped matching
    // and the failure would read as a missing trip rather than a broken scan.
    expect(fixtureTripSlugs().length).toBeGreaterThan(1);
    expect(seededTripSlugs().length).toBeGreaterThan(1);
  });

  it("creates a container and a trip.ttl for every trip the diary fixture names", () => {
    const missing = fixtureTripSlugs().filter((slug) => !seededTripSlugs().includes(slug));
    expect(
      missing,
      `docs/data-model.md's diary points dy:trip at these trips and the seeder writes no ` +
        `travel/trips/<slug>/trip.ttl for them, so the seeded diary names a resource that is ` +
        `not there:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);

    const uncontained = fixtureTripSlugs().filter((slug) => !seededContainers().includes(slug));
    expect(
      uncontained,
      `no container is created for these, and a PUT into a missing container is a 404:\n  ${uncontained.join("\n  ")}`,
    ).toEqual([]);
  });
});
