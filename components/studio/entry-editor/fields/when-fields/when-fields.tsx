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

/**
 * THE TIMESTAMP'S THREE NOTES, ONE PER CLAIM — `COORDINATE_SOURCE_ID`'s shape
 * and all of its reasons: `aria-describedby` from the control itself and never
 * an `aria-label` on a wrapper (a `<section aria-label="Photos">` around the
 * picker once cost this file six tests, because a named wrapper shadows the
 * control inside it), and each one RENDERED EXACTLY WHEN SOMETHING POINTS AT
 * IT, because an id naming an element that is not there computes to the empty
 * string — silently, with nothing on screen to show for it.
 *
 * THREE, BECAUSE THERE ARE THREE CLAIMS AND THEY STOP BEING TRUE AT THREE
 * DIFFERENT MOMENTS. One element per claim is what makes each of them
 * removable on its own; a single sentence covering all three would have to
 * outlive the shortest-lived thing in it.
 *
 *   `OCCURRED_SOURCE_ID` — "the time came from a.jpg". Dies at the first
 *     keystroke in the clock: §11.3's provenance rule (the owner is told a
 *     photo supplied a value, "so a wrong pin is attributable to the photo
 *     instead of to the editor") is what puts it there, and the coordinate's
 *     rule — "a note left standing beside a number the owner typed over is a
 *     claim they have no way to check" — is what takes it away.
 *   `OFFSET_SOURCE_ID` — "the offset came from a.jpg". §11.3 again, for the
 *     half a modern phone does write. Dies when the owner chooses an offset.
 *   `OFFSET_GUESS_ID` — "the offset beside this time is this machine's guess"
 *     (§11.5). Dies ONLY when the offset acquires an author, which is ruling
 *     T4-G: a keystroke in the CLOCK says nothing about who supplied the
 *     OFFSET, so the warning is still true after one and stays. It loses the
 *     photo's NAME at that keystroke, for `OCCURRED_SOURCE_ID`'s reason, and
 *     keeps saying the thing that is still checkable.
 *
 * WHY §11.3's CREDIT IS NOT OPTIONAL HERE, recorded because this file argued
 * the other way for a day: the guess mark is `null` whenever the photo supplied
 * BOTH halves, so a camera reset to factory time publishes a wrong
 * `dy:occurredAt` — the most load-bearing fact on the entry — attributable to
 * the editor rather than to the file. §11.5 is silent about provenance because
 * it does not restate its parent, exactly as it does not restate "never
 * overwrites"; reading that silence as a withdrawal would withdraw the
 * no-overwrite rule with it.
 *
 * AND THE SENTENCES ARE ONE HALF OF THE GUESS; THE `data-offset-unconfirmed`
 * ATTRIBUTE ON THE CONTROL IS THE OTHER. Wording alone cannot carry that state,
 * and this control is the proof: its PERMANENT hint already says the offset is
 * "not of wherever you are writing this", so a reader — or a test — fenced on
 * phrasing would find the same words in the confirmed cases as in the guessed
 * one. Every one of these is written by `creditTime`, which is what stops them
 * drifting from each other or from the records.
 */
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

/**
 * THE GUESS, AND IT SAYS WHICH HALF THE PHOTO DID NOT SUPPLY rather than only
 * where the value came from: §11.5's whole argument is that `21:38 +02:00`
 * reads as data in both halves, so a note that credited the photo without
 * saying that would leave the owner unable to act on it.
 *
 * `null` IS THE STATE AFTER THE OWNER TYPES IN THE CLOCK, not a missing name.
 * The claim "the offset is not from a.jpg" needs a.jpg's clock to still be in
 * the box to mean anything; the claim "the offset is this machine's guess" does
 * not, and it is the one that is still true (T4-G). So the name goes and the
 * warning stays, in one sentence that no longer promises something the owner
 * cannot check.
 */
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
  /**
   * EACH CONTROL'S PERMANENT HINT, PLUS WHATEVER IS CURRENTLY TRUE ABOUT WHERE
   * ITS VALUE CAME FROM — `coordinateHelp`'s shape, for its reason: every half
   * of this is silent when it is wrong. An id that names nothing computes to
   * the empty string, and an attribute left on permanently reads as correct
   * markup while announcing a reason that has stopped being true.
   *
   * THE HINT IS ALWAYS FIRST, so the credit or the warning is heard as an
   * addition to what the control is for rather than in place of it.
   *
   * ONE FUNCTION PER CONTROL RATHER THAN `coordinateHelp`'s PARAMETERS: there
   * are two controls and each has its own set of things that can be true of it,
   * and the guess note belongs to the offset alone — the clock is not in doubt,
   * it is the thing the offset is in doubt BESIDE.
   */
  const occurredHelp = (): string =>
    ["entry-when-hint", occurredSource === null ? undefined : OCCURRED_SOURCE_ID]
      .filter((id): id is string => id !== undefined)
      .join(" ");

  /* The guess and the credit are mutually exclusive by construction — the mark
     requires the offset to be NOBODY's and the credit requires it to be a
     photo's — but both are listed rather than branched, because that exclusion
     lives in `creditTime` and a second copy of it here is a second thing to
     keep true. */
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

      {/*
        WHERE THE TIME ABOVE CAME FROM, WHILE A PHOTO IS THE ANSWER.

        §11.3: "the owner is told a photo supplied a value, so a wrong pin
        is attributable to the photo instead of to the editor" — and for
        this control the wrong value is `dy:occurredAt` itself, which a
        camera reset to factory time supplies with every confidence. The
        guess mark cannot carry this: it is `null` exactly when the photo
        supplied BOTH halves, which is the case with nothing else on the
        form to explain the date.

        RENDERED EXACTLY WHEN `occurredHelp()` NAMES IT, and the pair of
        them is decided by one value for `COORDINATE_SOURCE_ID`'s reason.
      */}
      {occurredSource !== null && (
        <p id={OCCURRED_SOURCE_ID} className="text-sm text-muted-foreground">
          {occurredSourceNote(occurredSource)}
        </p>
      )}

      {/*
        THE OTHER HALF OF THE TIMESTAMP, IMMEDIATELY BELOW THE CLOCK IT
        BELONGS TO. §7.3: `dy:occurredAt` "carries the local UTC offset of
        the place", and the control above hands back a wall clock with no
        offset at all — so without this one the offset was the entry's own
        or, failing that, the zone of whatever machine the form happened to
        be open on. An evening in Tokyo written up at home became
        `21:40+02:00`: the same instant, spelled as the wrong time of day,
        which for a travel diary is most of the meaning.

        INSIDE THE `<form>`, WHICH IS WHAT ARMS THE AUTOSAVE. React
        delivers `onChange` to ancestors and the form's own handler is the
        one place `touched` is set, so a "toolbar" spelling of this control
        beside the datetime input but outside the form would move the state
        and arm nothing: the owner corrects `+02:00` to `+09:00`, closes the
        tab, and gets `+02:00` back. That is a bug this project has already
        shipped once, in the photo pipeline, for exactly this reason.

        NO `aria-label` HERE OR ON ANYTHING WRAPPING IT, and no
        `<fieldset>`/`<legend>` pairing it with the clock. `getByLabelText`
        matches `aria-label` on ANY element, this file has already lost six
        tests to a wrapper that shadowed a real control, and a group named
        "When" would be a second thing answering to the label above. The
        `<label>` inside `Field` is the only name here.

        HELD BY THE DRAFT FIELDSET AND BY NOTHING ELSE. It is deliberately
        NOT tied to `coordinatesLive`: the privacy settings decide whether a
        POINT may be published, and an offset is not a coordinate. An owner
        whose settings cannot be read still gets to say what time of day it
        was.
      */}
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
          /* THE STATE, ON THE CONTROL THAT HOLDS THE VALUE IN DOUBT — not
             on a wrapper, which is not what holds it, and not on the note,
             which is the sentence rather than the state. `undefined` rather
             than `"false"` for `coordinateHelp`'s reason: an attribute left
             on permanently reads as correct markup and answers a question
             nobody asked. See `creditTime` for the rule and
             `OFFSET_GUESS_ID` for why wording cannot carry this alone. */
          data-offset-unconfirmed={offsetGuess ? "true" : undefined}
          aria-describedby={offsetHelp()}
          onChange={(event) => onOffsetChange(event.target.value)}
        >
          {/* The value is the offset AS WRITTEN, because that string is
              what is concatenated onto the wall clock and what the draft
              carries — one spelling, end to end. The text is the same
              string: a list of place names would be a second thing to keep
              true, and a wrong one is worse than none. */}
          {offsetOptions.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </Field>

      {/*
        WHY THE OFFSET ABOVE IS NOT DATA, WHILE THAT IS TRUE.

        §11.5, and the sentence half of it: a wall clock the photo supplied
        sits beside a zone it did not, and "the owner sees 21:38 +02:00" is
        only a problem because every part of that reads as a reading. The
        other half is `data-offset-unconfirmed` on the control itself — see
        `OFFSET_GUESS_ID` for why neither half does this alone, and why this
        is not a `role="alert"`: a photo that works announces nothing, and a
        persistent live region about the offset would leak into every
        save-outcome the form reports.

        UNDER THE CONTROL AND ITS OWN HINT, named by `offsetHelp()`, and
        RENDERED EXACTLY WHEN SOMETHING POINTS AT IT — `COORDINATE_SOURCE_ID`
        's shape: a live `aria-describedby` naming an element that is not
        there computes to the empty string, and the owner is back to a date
        and a zone that appeared from nowhere.
      */}
      {offsetGuess && (
        <p id={OFFSET_GUESS_ID} className="text-sm text-muted-foreground">
          {/* The name comes from the CLOCK's record, which is what makes
              the sentence lose it at the first keystroke there while the
              warning stays — ruling T4-G, argued in `creditTime`. */}
          {offsetGuessNote(occurredSource)}
        </p>
      )}

      {/* AND WHEN THE PHOTO DID CARRY THE ZONE, WHO IT WAS (§11.3). Not a
          guess and not marked — the value is as trustworthy as the clock
          beside it — but still a value that appeared without being typed,
          which is the whole of `COORDINATE_SOURCE_ID`'s argument. Mutually
          exclusive with the note above by construction: that one requires
          the offset to be nobody's. */}
      {offsetSource !== null && (
        <p id={OFFSET_SOURCE_ID} className="text-sm text-muted-foreground">
          {offsetSourceNote(offsetSource)}
        </p>
      )}
    </>
  );
}
