/**
 * The `Place` §9 governs, assembled from what the editor's controls hold, plus
 * the precision select's own reading. No React and no DOM.
 * Why it left the editor: ./notes.md#tested-through-the-dom-until-now
 */

import type { Entry } from "@/lib/pod/schema";

/**
 * The grids offered besides the owner's own default. NO "EXACT" OPTION, AND
 * THAT IS A DECISION: it could only be implemented by going around
 * `fuzzForPublication`, which is the one place the home region is checked.
 * ./notes.md#no-exact-option-and-what-it-would-take
 */
export const PRECISION_GRIDS = [100, 1000, 10_000] as const;

/** The value of the precision control, in metres, or `null` when it holds
 *  nothing a grid can be built from. `xsd:integer`, so a fractional metre is
 *  refused here rather than rounded on the owner's behalf (§6). */
export function gridOf(text: string): number | null {
  if (text.trim() === "") return null;
  const metres = Number(text);
  return Number.isInteger(metres) && metres > 0 ? metres : null;
}

/** Everything `Place` holds. `lib/pod/schema.ts` exports the Zod object but no
 *  type for it, and this file imports no Zod. */
export type EntryPlace = NonNullable<Entry["place"]>;

/** The three things this form can SAY about a place, as terms rather than as
 *  form strings: the empty box has already become `undefined` by the time one
 *  of these is built, because `""` is not a name — see `placeTextOf`. */
export type PlaceText = Pick<EntryPlace, "name" | "locality" | "country">;

/**
 * The place to write, given whatever the entry already had, whatever the fuzz
 * allowed, and whatever the three text controls hold. `undefined` IS A REMOVAL,
 * NOT AN OMISSION, ON ALL FOUR FIELDS, and the four are removed independently.
 * ./notes.md#undefined-is-a-removal-on-all-four-fields
 */
export function placeFor(
  existing: EntryPlace | undefined,
  geo: EntryPlace["geo"],
  text: PlaceText,
): EntryPlace | undefined {
  // Start from what the entry already had, so a field this form does not hold
  // survives; then let this save's answer overwrite it, `undefined` INCLUDED.
  // Spreading `undefined` over a stored value is what makes a removal a
  // removal rather than an omission, so this is not a merge and must not
  // become one.
  const place: EntryPlace = { ...existing, ...text, geo };
  /* A KEY PRESENT WITH AN `undefined` VALUE IS NOT CONTENT, and needs no
     delete pass to say so — a loop that deleted them stood here and was a
     no-op with a comment claiming otherwise.
     ./notes.md#undefined-is-a-removal-on-all-four-fields */
  return Object.values(place).some((value) => value !== undefined) ? place : undefined;
}

/**
 * The three boxes as RDF terms, with `""` MEANING REMOVE. TRIMMED, because
 * `Place.name` is `min(1)` and a one-space box parses. The language is the
 * entry's own; `country` is a code and stays untagged (§7.3).
 * ./notes.md#empty-box-trimmed-and-the-language-it-carries
 */
export const placeTextOf = (
  form: { placeName: string; locality: string; country: string },
  language: string,
): PlaceText => ({
  name:
    form.placeName.trim() === "" ? undefined : { value: form.placeName.trim(), language },
  locality: form.locality.trim() === "" ? undefined : form.locality.trim(),
  country: form.country.trim() === "" ? undefined : form.country.trim(),
});
