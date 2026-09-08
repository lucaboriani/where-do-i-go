/**
 * The `Place` §9 governs, assembled from what the editor's controls hold, plus
 * the precision select's own reading. No React and no DOM.
 * Why it left the editor: ./notes.md#tested-through-the-dom-until-now
 */

import type { Entry } from "@/lib/pod/schema";

/**
 * The grids offered besides the owner's own default.
 *
 * **NO "EXACT" OPTION, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT.**
 * `fuzzForPublication` is the total boundary §9 asks for: it is the one place
 * that checks the home region, and it has no exact mode — `snapToPrecision`
 * refuses anything that is not a positive integer of metres. An "exact" option
 * could therefore only be implemented by going AROUND that function, and going
 * around it goes around the home-region drop as well. The one entry an owner is
 * most likely to mark "exact" is the one taken at home.
 *
 * Coarser than the owner's default is always available; finer is only ever
 * their own setting.
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

/** `500` → `~500 m`, `10000` → `~10 km`. The tilde is the honest part: what is
 *  published is a cell of about this size, not a distance from anywhere. */
export function precisionLabel(metres: number): string {
  return metres >= 1000 && metres % 100 === 0 ? `~${metres / 1000} km` : `~${metres} m`;
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
 * allowed, and whatever the three text controls are holding.
 *
 * `undefined` IS A REMOVAL, NOT AN OMISSION, ON ALL FOUR FIELDS. That is the
 * half that is easy to miss on an EDIT: the entry being edited may already
 * carry a `#geo` or a `schema:name`, and spreading the old place in and merely
 * failing to add a new value leaves the old one on a world-readable resource —
 * a leak, or a name the owner has deleted from the form and cannot delete from
 * their Pod, either way outliving the edit made to remove it.
 *
 * THE FOUR ARE REMOVED INDEPENDENTLY, which is why the geometry and the text
 * arrive as separate arguments and are never folded into one flag. Clearing a
 * name must not take the coordinate with it, and §9's drop must not take the
 * name: "it is the geometry that is absent, not the entry." The original
 * comment here said the same thing about growth — "a `Place` that grows one
 * must not lose it every time a coordinate is dropped" — and the spread of
 * `existing` below is still what keeps that true for a fifth field this form
 * does not hold.
 *
 * THAT SENTENCE NAMED A "copy-and-delete shape" UNTIL 2026-09-07 (F7), AND
 * THERE IS NO DELETE. The behaviour it claims is real, but the mechanism was
 * removed as a no-op — see the comment inside the body, which says so in as
 * many words and therefore contradicted this one. Correct behaviour defended by a
 * false reason is the shape both halves of this pair were an instance of: the
 * loop that stood here had a comment claiming it did something, and its removal
 * left a docblock claiming it was still there.
 *
 * A place with nothing left in it is no place at all rather than an empty
 * `<#place>` node, which would be a `schema:Place` asserting nothing.
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
     no-op with a comment claiming otherwise, which is worse than either half
     alone. `Object.values({ name: undefined }).some((v) => v !== undefined)`
     is already `false`, so an emptied place is `undefined` here rather than a
     bare `<#place>` asserting nothing; and `lib/pod/entry-model.ts` guards
     every field on truthiness or `!== undefined` before it writes a triple, so
     the surviving keys produce no triples either. */
  return Object.values(place).some((value) => value !== undefined) ? place : undefined;
}

/**
 * The three boxes as RDF terms, with `""` MEANING REMOVE.
 *
 * The one place `""` and `undefined` are translated between, and the reason it
 * is a function rather than three ternaries inlined in `save()`: they are
 * different instructions on three fields, and a spelling that got one of them
 * wrong would either publish `""@en` — an entry claiming to be somewhere called
 * nothing — or make a name impossible to retract once written.
 *
 * TRIMMED, AND NOTHING DOWNSTREAM WOULD CATCH IT IF IT WERE NOT. `Place.name`
 * is `min(1)` and `" ".length === 1`, so `Place.safeParse({ name: { value: " " } })`
 * SUCCEEDS — measured, not assumed. An untrimmed one-space box therefore
 * publishes `schema:name " "@en` on a world-readable resource: a name that
 * renders as nothing everywhere, that no reader can see to delete, and that a
 * `value === ""` check does not find either. Every guard between here and the
 * Turtle asks "is it absent", and a space is not absent. This is the guard.
 *
 * THE LANGUAGE IS THE ENTRY'S OWN, exactly as the headline and the body get it,
 * so an entry written in another language keeps its tag. `locality` and
 * `country` carry none here: the locality is tagged by `text()` at
 * serialisation, and the country is a CODE and is deliberately untagged —
 * `"JP"@en` is a different RDF term from `"JP"`, so every consumer filtering on
 * the plain literal would stop matching entries this studio wrote (§7.3).
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
