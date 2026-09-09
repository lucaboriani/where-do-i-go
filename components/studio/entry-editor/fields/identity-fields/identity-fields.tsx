/**
 * The four controls that say WHICH entry this is: the trip it belongs to, the
 * slug its URL is built from, its headline and its story. Presentational — every
 * value and every callback arrives as a prop: ./notes.md#props-only
 */

import Field, { CONTROL } from "../../field";
import type { EditorTrip } from "../../entry-editor";

export interface IdentityFieldsProps {
  /** Every trip the owner may write into, in the order the picker shows them. */
  trips: readonly EditorTrip[];
  tripIri: string;
  onTripChange: (iri: string) => void;
  /**
   * §10: the entry's URL is built from the trip and the slug, so once it exists
   * neither may move. It holds BOTH — a slug that stayed live beside a fixed
   * trip would offer an address change the write sequence refuses.
   */
  addressFixed: boolean;
  slug: string;
  onSlugChange: (slug: string) => void;
  headline: string;
  onHeadlineChange: (headline: string) => void;
  story: string;
  onStoryChange: (story: string) => void;
}

export default function IdentityFields({
  trips,
  tripIri,
  onTripChange,
  addressFixed,
  slug,
  onSlugChange,
  headline,
  onHeadlineChange,
  story,
  onStoryChange,
}: IdentityFieldsProps) {
  return (
    <>
      <Field id="entry-trip" label="Trip">
        <select
          id="entry-trip"
          name="entry-trip"
          className={CONTROL}
          value={tripIri}
          disabled={addressFixed}
          onChange={(event) => onTripChange(event.target.value)}
        >
          <option value="">{"Choose a trip"}</option>
          {/* IN TEXT, NOT IN A COLOUR. An `<option>` carries no styling a
              screen reader announces and no styling a colour-blind reader
              can rely on, so the one thing that distinguishes a draft trip
              from a published one has to be part of its name here. */}
          {trips.map((choice) => (
            <option key={choice.iri} value={choice.iri}>
              {choice.status === "draft" ? `${choice.name} (draft)` : choice.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id="entry-slug"
        label="Slug"
        hint="Becomes the entry's address, and is fixed once it is saved."
      >
        <input
          id="entry-slug"
          name="entry-slug"
          type="text"
          className={CONTROL}
          value={slug}
          disabled={addressFixed}
          aria-describedby="entry-slug-hint"
          onChange={(event) => onSlugChange(event.target.value)}
        />
      </Field>

      <Field id="entry-headline" label="Headline">
        <input
          id="entry-headline"
          name="entry-headline"
          type="text"
          className={CONTROL}
          value={headline}
          onChange={(event) => onHeadlineChange(event.target.value)}
        />
      </Field>

      <Field id="entry-story" label="Story">
        <textarea
          id="entry-story"
          name="entry-story"
          rows={8}
          className={CONTROL}
          value={story}
          onChange={(event) => onStoryChange(event.target.value)}
        />
      </Field>
    </>
  );
}
