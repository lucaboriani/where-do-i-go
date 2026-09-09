/**
 * The timestamp's two halves — the wall clock and the UTC offset — and the three
 * notes that say where their values came from. Presentational: every value and
 * every callback arrives as a prop. ./notes.md#props-only
 */

import Field, { CONTROL } from "../../field";

export interface WhenFieldsProps {
  /** The wall clock as typed, with no offset in it (§7.3). */
  occurred: string;
  onOccurredChange: (wallClock: string) => void;
  /** The file credited with the clock, or `null` when nobody is. */
  occurredSource: string | null;
  offset: string;
  onOffsetChange: (offset: string) => void;
  /** Every offset the select may show, AS WRITTEN — the string concatenated
   *  onto the wall clock, and what the draft carries. */
  offsetOptions: readonly string[];
  /** The offset is this machine's guess and nobody has confirmed it (§11.5). */
  offsetGuess: boolean;
  /** The file credited with the offset, or `null` when nobody is. */
  offsetSource: string | null;
}

/** THREE NOTES, ONE PER CLAIM: they stop being true at three different moments.
 *  NEVER AN `aria-label` ON A WRAPPER — it shadows the control and once cost six
 *  tests — and each is RENDERED EXACTLY WHEN SOMETHING POINTS AT IT.
 *  ./notes.md#three-notes-one-per-claim */
const OCCURRED_SOURCE_ID = "entry-when-source";
const OFFSET_SOURCE_ID = "entry-offset-source";
const OFFSET_GUESS_ID = "entry-offset-guess";

/** Names the FILE, which is the only name a photo has on screen — its
 *  `contentUrl` is a content-addressed hash nobody can read. The second
 *  sentence is there because the first otherwise reads as a hold: the control
 *  is live, and typing replaces this. `coordinateSourceNote`'s shape. */
const occurredSourceNote = (name: string) =>
  `The time came from ${name}. Type in the box to replace it.`;

const offsetSourceNote = (name: string) =>
  `The offset came from ${name}. Choose another to replace it.`;

/** THE GUESS, AND IT SAYS WHICH HALF THE PHOTO DID NOT SUPPLY. `null` IS THE
 *  STATE AFTER THE OWNER TYPES IN THE CLOCK, not a missing name (T4-G):
 *  ./notes.md#the-guess-note-says-which-half-the-photo-did-not-supply */
const offsetGuessNote = (name: string | null) =>
  name === null
    ? `The offset is this machine's guess for the time above, not the time zone of the place ` +
      `it happened in. Choose that offset if it was somewhere else.`
    : `The offset is not from ${name} — the photo carries no time zone of its own, so this is ` +
      `this machine's guess. Choose the offset of the place it happened in.`;

export default function WhenFields({
  occurred,
  onOccurredChange,
  occurredSource,
  offset,
  onOffsetChange,
  offsetOptions,
  offsetGuess,
  offsetSource,
}: WhenFieldsProps) {
  /** EACH CONTROL'S PERMANENT HINT FIRST, plus whatever is currently true about
   *  where its value came from. ONE FUNCTION PER CONTROL:
   *  ./notes.md#each-controls-hint-comes-first */
  const occurredHelp = (): string =>
    ["entry-when-hint", occurredSource === null ? undefined : OCCURRED_SOURCE_ID]
      .filter((id): id is string => id !== undefined)
      .join(" ");

  /* The guess and the credit are mutually exclusive by construction, and both
     are LISTED rather than branched — the exclusion lives in `withTimeCredit`:
     ./notes.md#each-controls-hint-comes-first */
  const offsetHelp = (): string =>
    [
      "entry-offset-hint",
      offsetGuess ? OFFSET_GUESS_ID : undefined,
      offsetSource === null ? undefined : OFFSET_SOURCE_ID,
    ]
      .filter((id): id is string => id !== undefined)
      .join(" ");

  return (
    <>
      <Field
        id="entry-when"
        label="When it happened"
        hint="Kept with the offset of the place it happened in, so it always reads as that time of day."
      >
        <input
          id="entry-when"
          name="entry-when"
          type="datetime-local"
          className={CONTROL}
          value={occurred}
          aria-describedby={occurredHelp()}
          onChange={(event) => onOccurredChange(event.target.value)}
        />
      </Field>

      {/* WHERE THE TIME ABOVE CAME FROM, WHILE A PHOTO IS THE ANSWER (§11.3) —
          and the guess mark cannot carry this, because it is `null` exactly when
          the photo supplied BOTH halves:
          ./notes.md#where-the-clock-came-from-while-a-photo-is-the-answer */}
      {occurredSource !== null && (
        <p id={OCCURRED_SOURCE_ID} className="text-sm text-muted-foreground">
          {occurredSourceNote(occurredSource)}
        </p>
      )}

      {/* THE OTHER HALF OF THE TIMESTAMP (§7.3). INSIDE THE `<form>`, WHICH IS
          WHAT ARMS THE AUTOSAVE. NO `aria-label` HERE OR ON ANYTHING WRAPPING
          IT. HELD BY THE DRAFT FIELDSET AND NOT BY `coordinatesLive`:
          ./notes.md#the-offset-control-and-the-four-things-it-must-not-become */}
      <Field
        id="entry-offset"
        label="UTC offset"
        hint="The offset of the place it happened in, not of wherever you are writing this. Kept exactly as chosen, so the time above always reads as that time of day."
      >
        <select
          id="entry-offset"
          name="entry-offset"
          className={CONTROL}
          value={offset}
          /* THE STATE, ON THE CONTROL THAT HOLDS THE VALUE IN DOUBT — not on a
             wrapper and not on the note, and `undefined` rather than `"false"`:
             ./notes.md#the-mark-goes-on-the-control-not-on-a-wrapper-or-the-note */
          data-offset-unconfirmed={offsetGuess ? "true" : undefined}
          aria-describedby={offsetHelp()}
          onChange={(event) => onOffsetChange(event.target.value)}
        >
          {/* The value is the offset AS WRITTEN, one spelling end to end, and the
              text is the same string: ./notes.md#the-offset-control-and-the-four-things-it-must-not-become */}
          {offsetOptions.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </Field>

      {/* WHY THE OFFSET ABOVE IS NOT DATA, WHILE THAT IS TRUE (§11.5). NOT a
          `role="alert"` — a persistent live region here would leak into every
          save-outcome the form reports. RENDERED EXACTLY WHEN SOMETHING POINTS
          AT IT: ./notes.md#why-the-offset-above-is-not-data-while-that-is-true */}
      {offsetGuess && (
        <p id={OFFSET_GUESS_ID} className="text-sm text-muted-foreground">
          {/* The name comes from the CLOCK's record, which is what loses it at the
              first keystroke there while the warning stays — T4-G:
              ./notes.md#why-the-offset-above-is-not-data-while-that-is-true */}
          {offsetGuessNote(occurredSource)}
        </p>
      )}

      {/* AND WHEN THE PHOTO DID CARRY THE ZONE, WHO IT WAS (§11.3) — not a guess
          and not marked, but still a value that appeared without being typed:
          ./notes.md#why-the-offset-above-is-not-data-while-that-is-true */}
      {offsetSource !== null && (
        <p id={OFFSET_SOURCE_ID} className="text-sm text-muted-foreground">
          {offsetSourceNote(offsetSource)}
        </p>
      )}
    </>
  );
}
