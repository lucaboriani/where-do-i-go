/**
 * Where the entry was: the three place fields §9's mitigation leans on, the
 * coordinate pair, the grid it is published in, and the notes. Presentational —
 * every value and every callback arrives as a prop. ./notes.md#props-only
 */

import { precisionLabel } from "@/lib/studio/place/place";
import Field, { CONTROL } from "../../field";

export interface WhereFieldsProps {
  placeName: string;
  onPlaceNameChange: (name: string) => void;
  locality: string;
  onLocalityChange: (locality: string) => void;
  country: string;
  onCountryChange: (code: string) => void;
  /** The coordinate AS TYPED, which is never what the Pod stores (§9). */
  lat: string;
  onLatChange: (lat: string) => void;
  long: string;
  onLongChange: (long: string) => void;
  precision: string;
  onPrecisionChange: (metres: string) => void;
  /** Every grid the select may offer, in metres, in the order it shows them. */
  precisionOptions: readonly number[];
  /**
   * The privacy settings answered, so there is a home region to check a point
   * against (§7.6). It holds the three coordinate controls and NOT the three
   * place fields — a name needs no such check, and an owner with no settings
   * must still be able to say something about where they were.
   */
  coordinatesLive: boolean;
  /** Why the three are dead, or `null` when they are not. */
  coordinateNote: string | null;
  /** The failure as `describe()` renders it, or `null`. Rendered outside the
   *  association: a screen reader should not read a Pod URL out character by
   *  character to deliver a sentence a person can act on. */
  settingsDetail: string | null;
  /** The file credited with the PAIR, or `null` when nobody is. */
  coordinateSource: string | null;
  /** The entry already carries a coordinate, which is what the latitude hint
   *  turns on: on an edit, leaving both boxes empty keeps it. */
  hasStoredCoordinate: boolean;
}

/** THE HOLD'S END OF THE ASSOCIATION, on EACH of the three controls and NOT on
 *  a fieldset around them — nothing propagates a group's description to its
 *  members: ./notes.md#the-holds-association-goes-on-each-control */
const COORDINATE_NOTE_ID = "entry-coordinate-note";

/** THE PROVENANCE NOTE'S END — ONE ELEMENT FOR THE PAIR, not one per box, and
 *  NOT AN `aria-label` ON A WRAPPER, which shadows the control inside it:
 *  ./notes.md#one-provenance-note-for-the-pair */
const COORDINATE_SOURCE_ID = "entry-coordinate-source";

/** Names the FILE, which is what the owner recognises — the photo has no other
 *  name on screen, and its `contentUrl` is a content-addressed hash nobody can
 *  read. The second sentence is there because the first one otherwise reads as
 *  a hold: the boxes are live, and typing replaces this. */
const coordinateSourceNote = (name: string) =>
  `Latitude and longitude came from ${name}. Type in either box to replace them.`;

export default function WhereFields({
  placeName,
  onPlaceNameChange,
  locality,
  onLocalityChange,
  country,
  onCountryChange,
  lat,
  onLatChange,
  long,
  onLongChange,
  precision,
  onPrecisionChange,
  precisionOptions,
  coordinatesLive,
  coordinateNote,
  settingsDetail,
  coordinateSource,
  hasStoredCoordinate,
}: WhereFieldsProps) {
  /** The ids one coordinate control describes itself by, BUILT because every
   *  half is silent when wrong, and THE SOURCE NOTE IS PASSED IN rather than
   *  read here: ./notes.md#every-half-of-coordinatehelp-is-silent-when-wrong */
  const coordinateHelp = (ownHintId?: string, sourceNoteId?: string): string | undefined => {
    const ids = [
      ownHintId,
      coordinateNote === null ? undefined : COORDINATE_NOTE_ID,
      sourceNoteId,
    ].filter((id): id is string => id !== undefined);
    return ids.length === 0 ? undefined : ids.join(" ");
  };

  /** The provenance note's id while there is a note — the same value decides
   *  whether the note renders at all, on purpose:
   *  ./notes.md#every-half-of-coordinatehelp-is-silent-when-wrong */
  const coordinateSourceId = coordinateSource === null ? undefined : COORDINATE_SOURCE_ID;

  return (
    <>
      {/* WHERE THE OWNER WAS, IN WORDS, immediately above the coordinate and NOT
          HELD BY `coordinatesLive` — a name needs no home region. NO
          `aria-label` ON THIS BLOCK OR ANYTHING WRAPPING IT:
          ./notes.md#the-place-text-sits-above-the-coordinate-and-is-not-held-with-it */}
      <Field
        id="entry-place-name"
        label="Place name"
        hint="Kept even when the coordinate is not. Near your home region the point is dropped rather than blurred, and this name is then all the entry says about where it was."
      >
        <input
          id="entry-place-name"
          name="entry-place-name"
          type="text"
          className={CONTROL}
          value={placeName}
          aria-describedby="entry-place-name-hint"
          onChange={(event) => onPlaceNameChange(event.target.value)}
        />
      </Field>

      <Field id="entry-locality" label="Town or city">
        <input
          id="entry-locality"
          name="entry-locality"
          type="text"
          className={CONTROL}
          value={locality}
          onChange={(event) => onLocalityChange(event.target.value)}
        />
      </Field>

      {/* A CODE, NOT A NAME (§7.3): `"JP"@en` is a different RDF term from `"JP"`
          and nothing downstream can tell them apart:
          ./notes.md#the-place-text-sits-above-the-coordinate-and-is-not-held-with-it */}
      <Field
        id="entry-country"
        label="Country"
        hint="The two-letter code, such as JP or IT — not the country's name."
      >
        <input
          id="entry-country"
          name="entry-country"
          type="text"
          className={CONTROL}
          value={country}
          aria-describedby="entry-country-hint"
          onChange={(event) => onCountryChange(event.target.value)}
        />
      </Field>

      {/* THE THREE COORDINATE CONTROLS, INSIDE THE HELD FIELDSET WITH THE OTHERS.
          THEY CARRY A SECOND, INDEPENDENT HOLD AND THE TWO COMPOSE. NO NESTED
          `<fieldset disabled>`: it carries the `disabled` once and the REASON
          nowhere. ./notes.md#two-independent-holds-that-compose */}
      <Field
        id="entry-latitude"
        label="Latitude"
        hint={
          hasStoredCoordinate
            ? "Snapped to the precision below before it is saved. Leave both boxes empty to keep the coordinate this entry already has."
            : "Snapped to the precision below before it is saved. Your Pod never holds the point you type here."
        }
      >
        <input
          id="entry-latitude"
          name="entry-latitude"
          type="number"
          step="any"
          inputMode="decimal"
          className={CONTROL}
          value={lat}
          disabled={!coordinatesLive}
          aria-describedby={coordinateHelp("entry-latitude-hint", coordinateSourceId)}
          onChange={(event) => onLatChange(event.target.value)}
        />
      </Field>

      <Field id="entry-longitude" label="Longitude">
        <input
          id="entry-longitude"
          name="entry-longitude"
          type="number"
          step="any"
          inputMode="decimal"
          className={CONTROL}
          value={long}
          disabled={!coordinatesLive}
          aria-describedby={coordinateHelp(undefined, coordinateSourceId)}
          onChange={(event) => onLongChange(event.target.value)}
        />
      </Field>

      {/* WHERE THE PAIR ABOVE CAME FROM, WHILE A PHOTO IS THE ANSWER — one
          sentence for the pair, RENDERED EXACTLY WHEN SOMETHING POINTS AT IT:
          ./notes.md#where-the-pair-came-from-while-a-photo-is-the-answer */}
      {coordinateSource !== null && (
        <p id={COORDINATE_SOURCE_ID} className="text-sm text-muted-foreground">
          {coordinateSourceNote(coordinateSource)}
        </p>
      )}

      {/* §9 step 3: whatever this says, `dy:precisionMeters` says the same. The
          owner's own default is in the list VERBATIM:
          ./notes.md#where-the-pair-came-from-while-a-photo-is-the-answer */}
      <Field
        id="entry-precision"
        label="Precision"
        hint="How large a cell the point is published in. Coarser is never a leak; finer is."
      >
        <select
          id="entry-precision"
          name="entry-precision"
          className={CONTROL}
          value={precision}
          disabled={!coordinatesLive}
          aria-describedby={coordinateHelp("entry-precision-hint")}
          onChange={(event) => onPrecisionChange(event.target.value)}
        >
          {/* Only ever reachable with the control dead — §7.6 has no default and
              this app supplies none:
              ./notes.md#where-the-pair-came-from-while-a-photo-is-the-answer */}
          {precision === "" && <option value="">{"Unavailable"}</option>}
          {precisionOptions.map((metres) => (
            <option key={metres} value={String(metres)}>
              {precisionLabel(metres)}
            </option>
          ))}
        </select>
      </Field>

      {/* WHY THE THREE ABOVE ARE DEAD, ON SCREEN AND ASSOCIATED WITH THEM (§9),
          rendered exactly when something points at it:
          ./notes.md#why-the-three-above-are-dead-on-screen-and-associated */}
      {coordinateNote !== null && (
        <p id={COORDINATE_NOTE_ID} className="text-sm text-muted-foreground">
          {coordinateNote}
        </p>
      )}
      {/* The failure as `describe()` renders it, OUTSIDE the association:
          ./notes.md#why-the-three-above-are-dead-on-screen-and-associated */}
      {settingsDetail !== null && (
        <p className="text-sm text-muted-foreground">{settingsDetail}</p>
      )}
    </>
  );
}
