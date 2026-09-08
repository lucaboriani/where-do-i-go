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

/**
 * THE ONE END OF THE ASSOCIATION BETWEEN THE DEAD COORDINATE CONTROLS AND THE
 * SENTENCE SAYING WHY, for the reason `HOLD_REASON_ID` below is a constant: an
 * `aria-describedby` naming an id nothing renders computes to the empty string,
 * with no error and nothing on screen to show for it, and the control is back
 * to announcing itself as unavailable and no reason.
 *
 * It goes on each of the three controls and NOT on a fieldset around them. That
 * spelling reads better and is heard by nobody — a `<legend>` names a group and
 * nothing propagates a group's DESCRIPTION to its members. Measured for the
 * Save button's own hold, forty lines further down this file.
 */
const COORDINATE_NOTE_ID = "entry-coordinate-note";

/**
 * THE PROVENANCE NOTE'S END OF THE ASSOCIATION — one element for the PAIR, not
 * one per box, and both boxes point at it.
 *
 * ONE, BECAUSE THE COORDINATE IS ONE VALUE. A latitude and a longitude are two
 * halves of one point: `coordinateAuthor` records a single author for the pair
 * (a photo can never supply half a coordinate — lib/media/exif.ts sets `gps`
 * only when both tags are present — so mixing sources is something only the
 * owner could cause, and refusing both boxes is the cure), and two sentences
 * saying the same thing beside each other is noise for anyone hearing them read
 * out one after the other.
 *
 * `aria-describedby`, THROUGH `coordinateHelp`, AND NOT AN `aria-label` ON A
 * WRAPPER. This file has the receipt for the wrapper spelling: a
 * `<section aria-label="Photos">` around the picker made six tests fail with
 * "found multiple elements", because a wrapper with a name shadows the control
 * inside it. A description adds no accessible name and cannot collide with any
 * label on the form.
 *
 * NOT RENDERED WHEN THERE IS NOTHING TO SAY, for `COORDINATE_NOTE_ID`'s reason:
 * an id naming an element that is not there computes to the empty string,
 * silently, and an attribute left on permanently announces provenance for a
 * number the owner has since typed themselves.
 */
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
  /**
   * The ids one coordinate control describes itself by: its own hint, if it has
   * one, the note above while there is one, and — for the two BOXES — the
   * provenance note while a photo is credited with what they hold.
   *
   * Built rather than written out because EVERY HALF IS SILENT WHEN WRONG. An
   * id that names nothing computes to the empty string, and an attribute left
   * on permanently reads as correct markup while announcing a reason that has
   * stopped being true. `undefined` rather than `""` for the same reason: no
   * attribute at all is the honest spelling of "nothing to say".
   *
   * THE SOURCE NOTE IS PASSED IN RATHER THAN READ HERE, because it belongs to
   * two of the three controls and not to the third: the precision select is
   * about the grid a point is published in, and a photo has no opinion about
   * that. A helper that added it unconditionally would have the select announce
   * where a coordinate came from, which is true of neither its value nor its
   * effect.
   */
  const coordinateHelp = (ownHintId?: string, sourceNoteId?: string): string | undefined => {
    const ids = [
      ownHintId,
      coordinateNote === null ? undefined : COORDINATE_NOTE_ID,
      sourceNoteId,
    ].filter((id): id is string => id !== undefined);
    return ids.length === 0 ? undefined : ids.join(" ");
  };

  /** The provenance note's id while there is a note, for the two boxes to name.
   *  `undefined` is what keeps `coordinateHelp` from pointing at an element that
   *  is not rendered — the two are decided by the same value on purpose. */
  const coordinateSourceId = coordinateSource === null ? undefined : COORDINATE_SOURCE_ID;

  return (
    <>
      {/*
        WHERE THE OWNER WAS, IN WORDS — the three fields §9's mitigation
        leans on, and the reason they sit HERE, immediately above the
        coordinate: a place is one subject, and the entry's answer to
        "where" is these four controls together.

        THEY ARE NOT HELD BY `coordinatesLive`, and that is the point of
        putting them beside it rather than inside it. The coordinate
        controls go dead when the privacy settings cannot be read, because
        there is no home region to check a point against; a place NAME needs
        no such check — it is prose the owner chose, published exactly as
        typed — so an editor that dimmed these three alongside the
        coordinate would leave an owner with no settings unable to say
        anything at all about where they were. They are inside the draft
        fieldset with everything else, for the reason everything else is:
        one storage slot.

        NO `aria-label` ON THIS BLOCK OR ANYTHING WRAPPING IT, and no
        `<fieldset>`/`<legend>` grouping the four. `getByLabelText` matches
        `aria-label` on ANY element; this file has already lost six tests to
        a wrapper that shadowed a real control, and a legend reading
        "Place" would be a fifth thing for the form's own queries to find.
        The `<label>` inside each `Field` is the only name here.
      */}
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

      {/* A CODE, NOT A NAME (§7.3): `schema:addressCountry "JP"`, written
          untagged, because `"JP"@en` is a different RDF term from `"JP"`
          and every consumer filtering on the plain literal would stop
          matching. The hint is what stops the owner typing "Japan" here —
          nothing downstream can tell the two apart. */}
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

      {/*
        THE THREE COORDINATE CONTROLS, INSIDE THE HELD FIELDSET WITH THE
        OTHERS. Nothing about them is special enough to stand outside it:
        one storage slot, so an unanswered banner must not be typed past
        here either, and a latitude typed behind the banner is a latitude
        the local copy is not keeping.

        THEY CARRY A SECOND, INDEPENDENT HOLD — `disabled={!coordinatesLive}`
        — and the two COMPOSE rather than replace one another, exactly as
        `saving` and the fieldset do on the Save button. The fieldset says
        "answer the banner first"; this says "there are no settings to
        publish a coordinate against". Respelling either as the other passes
        every attribute assertion and reopens the case it was not spelled
        for.

        NO NESTED `<fieldset disabled>` AROUND THE THREE, tempting as it is:
        it would carry the `disabled` once, and it would carry the REASON
        nowhere. Nothing propagates a group's description to its members —
        measured for the Save button's hold, and the same measurement
        applies here — so the association has to be on each control
        regardless, and a `<legend>` would add a fourth thing named
        "coordinates" for the form's own queries to trip over.
      */}
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

      {/*
        WHERE THE PAIR ABOVE CAME FROM, WHILE A PHOTO IS THE ANSWER.

        UNDER THE TWO BOXES AND ABOVE THE PRECISION SELECT, because that is
        what it is about — one sentence for the pair, named by both boxes'
        `aria-describedby` (see `COORDINATE_SOURCE_ID` for why one and not
        two, and why not an `aria-label` on a wrapper).

        RENDERED EXACTLY WHEN SOMETHING POINTS AT IT, which is
        `coordinateSourceId`'s only other use: a live `aria-describedby`
        naming an element that is not there computes to the empty string,
        silently, and the owner is back to a number that appeared from
        nowhere.
      */}
      {coordinateSource !== null && (
        <p id={COORDINATE_SOURCE_ID} className="text-sm text-muted-foreground">
          {coordinateSourceNote(coordinateSource)}
        </p>
      )}

      {/* §9 step 3: whatever this says, `dy:precisionMeters` says the same
          and the pair beside it is that grid's. The owner's own
          `dy:defaultPrecisionMeters` is preselected and is in the list
          VERBATIM — see `precisionOptions` for why it is not rounded onto
          the fixed grids in either direction. */}
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
          {/* Only ever reachable with the control dead: §7.6 has no default
              and this app supplies none, so an empty value means the
              settings have not answered or could not be read. A controlled
              <select> whose value matches no option renders blank, which
              reads as a list someone forgot to fill in. */}
          {precision === "" && <option value="">{"Unavailable"}</option>}
          {precisionOptions.map((metres) => (
            <option key={metres} value={String(metres)}>
              {precisionLabel(metres)}
            </option>
          ))}
        </select>
      </Field>

      {/*
        WHY THE THREE ABOVE ARE DEAD, ON SCREEN AND ASSOCIATED WITH THEM.
        §9: "an entry silently losing its map pin becomes a bug report,
        whereas 'you have not set a home region yet' is a one-time setup
        step with an obvious fix."

        Rendered exactly when something points at it — a live
        `aria-describedby` naming an element that is not there computes to
        the empty string, silently, and the control is back to announcing
        itself as unavailable with no reason given.
      */}
      {coordinateNote !== null && (
        <p id={COORDINATE_NOTE_ID} className="text-sm text-muted-foreground">
          {coordinateNote}
        </p>
      )}
      {/* The failure as `describe()` renders it — a URL and a status code.
          Outside the association for the same reason the save's detail is
          outside the announced region: the sentence above is what a person
          can act on, and a screen reader should not read a Pod URL out
          character by character to deliver it. */}
      {settingsDetail !== null && (
        <p className="text-sm text-muted-foreground">{settingsDetail}</p>
      )}
    </>
  );
}
