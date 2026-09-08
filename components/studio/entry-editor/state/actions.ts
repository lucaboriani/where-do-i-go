/**
 * The state the editor's form is, and the catalogue of transitions that may
 * change it. No React: every rule here is a pure function of the two.
 * ./notes.md#guard-inside-the-transition
 */

import type { Photo, Status as EntryStatus, TravelMode as Mode } from "@/lib/pod/schema";
import type { Draft } from "@/lib/studio/drafts";

/**
 * WHO PUT THE COORDINATE IN THE BOXES — the record §11.3 turns on, and a
 * different question from `touchedCoordinate`.
 *
 * `touchedCoordinate` (in `save()`) is `lat.trim() !== "" || long.trim() !== ""`
 * and is HALF of what decides whether a coordinate is WRITTEN AT ALL: the other
 * half is pair-completeness — ruling F-A — which sits at the composition beside
 * it rather than inside it, because half a pair is not a point and `Number("")`
 * is `0`. An auto-filled coordinate should be written, so neither of those must
 * be given this record's meaning. This one decides whether auto-fill MAY WRITE
 * HERE, and the three answers are not reducible to two:
 *
 *   nobody — nothing has supplied a coordinate: the boxes are empty, no photo
 *            has offered one, and the entry being edited, if there is one, has
 *            none either. Fill.
 *   owner  — the owner typed, or accepted a restored draft that holds a
 *            coordinate, OR THE ENTRY ARRIVED WITH ONE. Never overwrite: a
 *            photo picked afterwards would silently replace a place they CHOSE
 *            with the place a camera happened to be, and §9 would then fuzz and
 *            publish it, so the only surface showing the substitution would be
 *            a public triple.
 *   photo  — an earlier photo filled it. Never overwrite either, which is the
 *            direction §11.3 names explicitly: filling on every `ready` moves
 *            the entry to wherever the LAST picture was taken, a different
 *            place every time one is added on a day's walk, with the note
 *            updating politely as it goes.
 *
 * IT IS EXPLICIT RATHER THAN INFERRED FROM EMPTINESS, IN BOTH DIRECTIONS — and
 * the second direction was a live defect for a day (ruling T3-B) before it was
 * written down here.
 *
 * A box can be NON-EMPTY because the owner typed, because a photo filled it, or
 * because a draft was restored into it; the first two forbid a fill, and the
 * value alone tells none of them apart. AND A BOX CAN BE EMPTY AND STILL FORBID
 * ONE: on an EDIT both boxes start empty by design — see the `lat` state, which
 * explains that prefilling the stored pair would walk the pin — and `save()`
 * reads empty as "leave the stored coordinate alone". So on an edit emptiness
 * does not mean "there is no value"; it means "the value on the Pod stands",
 * and filling it IS an overwrite of something the owner has not touched, merely
 * spelled as an offer. The latitude's own hint promises exactly that: "Leave
 * both boxes empty to keep the coordinate this entry already has."
 *
 * WHAT GETTING THAT WRONG COSTS IS PUBLISHED DATA, not a convenience. The fill
 * flips `touchedCoordinate` to true, `fuzzed()` runs, and `placeFor` reads a
 * `drop` as a REMOVAL — so a photo taken inside the home region, which is the
 * ordinary case of attaching a picture from home to an entry you are
 * correcting, takes the entry's `#geo` off a world-readable resource and off
 * the §7.4 index row the public trip page renders its pin from. No message, no
 * failed save, both boxes exactly as they were. A photo taken elsewhere is the
 * same shape one step less destructive: the pin MOVES to wherever the picture
 * was taken.
 *
 * "Is it empty?" therefore cannot answer this question in either direction,
 * which is why the record is a value in its own right and is SEEDED FROM THE
 * ENTRY rather than from the form.
 */
export type CoordinateAuthor =
  { kind: "nobody" } | { kind: "owner" } | { kind: "photo"; name: string };

/**
 * WHO SUPPLIED EACH HALF OF THE TIMESTAMP — `CoordinateAuthor`'s question, with
 * its three answers and its whole argument for asking it explicitly rather than
 * reading it off an empty box, asked TWICE.
 *
 * TWO RECORDS, NOT ONE, AND THE SYMMETRY WITH THE COORDINATE IS THE TRAP
 * (ruling T4-C). `coordinateAuthor` is deliberately ONE record for a pair,
 * because a latitude from the owner beside a longitude from a photo is a point
 * that is nowhere. A timestamp does not compose that way: a wall clock is "the
 * time at the place" and the offset is "the place's zone", so the owner
 * correcting WHEN while the photo supplies WHERE is coherent, and so is the
 * reverse. Fusing them into one flag would refuse a fill that is honest and buy
 * nothing at all.
 *
 * SEEDED FROM THE ENTRY, AND THAT CONDITION IS RULING T4-B — the defect
 * `coordinateAuthor` shipped with for a day (T3-B), on a field where it is
 * worse shaped. `occurred` and `offset` are NOT empty on an edit: both are
 * seeded from `existing.occurredAt`, so "nothing has been typed here" cannot
 * mean "there is nothing here". A record reading `nobody` on an edit lets a
 * photo replace `dy:occurredAt` — "when the moment happened", the single most
 * load-bearing fact on a travel diary entry — with the value it replaced
 * visible on screen the whole time. The coordinate's version of this at least
 * hid behind an empty box.
 *
 * AND IT IS NOT `initial === undefined ? nobody : owner`, WHICH IS THE LAZY
 * SPELLING THE FIX ROUND MEASURED: it switches auto-date off for every edit ever
 * made, silently, while every refusal a test can make of these records still
 * passes. What separates the two is the ALLOW-CASE — an edit of an entry with
 * no `dy:occurredAt` at all (the field is `.optional()`), where there is nothing
 * to protect and the photo may still date it.
 *
 * `nobody` MEANS ONE MORE THING ON THE OFFSET THAN IT DOES ON THE CLOCK, and
 * `offsetGuess` is what does something with it: the offset control always shows
 * a value, so an unauthored offset is not an absence — it is
 * `offsetHere(wallClockNow())`, THIS MACHINE'S GUESS, which is the state §11.5
 * says the owner must be able to see.
 *
 * AND `photo` CARRIES TWO THINGS AS OF 2026-09-07 — ruling T4-E, and the
 * correction it needed the same day. A fill has to ask not only WHETHER the
 * other half is a photo's but WHOSE: photo A's clock beside photo B's zone is
 * the one composition in this task with no authority anywhere in it (see
 * `offerTimestamp`). T4-E asked that question with the FILE NAME — and
 * `PhotoSlot`'s docblock, further down this file, says a file name is not an
 * identity: the picker is `multiple`, it deduplicates nothing, and two cameras
 * both calling their first photo `IMG_0001.jpg` walked back through the guard
 * as one file. So the COMPARISON is on `key`, the per-editor slot identity
 * `attach` mints and React reconciles on, unique by construction; `name` stays
 * for the NOTES, which are §11.3's sentences and want the file the owner
 * recognises. `CoordinateAuthor` needs no `key` — it uses the name for display
 * only and never compares it.
 */
export type TimeAuthor =
  { kind: "nobody" } | { kind: "owner" } | { kind: "photo"; key: string; name: string };

/**
 * ONE PICKED FILE, IN THE FOUR STATES IT PASSES THROUGH.
 *
 * A STATE MACHINE RATHER THAN A `Photo | null` PLUS A FLAG, because the owner
 * has to be able to tell three different waits apart from a failure — and
 * because only `ready` may be saved. Every slot the entry is allowed to
 * reference carries its `Photo`, so there is no branch anywhere in which a
 * half-finished upload can be serialised: the shape refuses it rather than a
 * condition remembering to.
 *
 * `key` IS NOT THE FILE NAME. Two files picked from two directories can share
 * one, and the same file can be picked twice while the first is still decoding;
 * a name-keyed list would then update the wrong row. React's reconciler needs a
 * stable identity here too, since a slot moves through three renders.
 */
export type PhotoSlot =
  | { key: string; name: string; state: "decoding" }
  | { key: string; name: string; state: "uploading" }
  | { key: string; name: string; state: "ready"; photo: Photo }
  | { key: string; name: string; state: "failed"; message: string };

/* ══════════════════════════════════════════════════════════════════ state ══ */

/**
 * THE FIFTEEN FORM FIELDS, THE PHOTOS AND THE FOUR CREDITS, as one value.
 * The field names are `Draft`'s, deliberately: ./notes.md#what-is-derived-and-what-had-to-stay-stored
 */
export interface EntryFormState {
  tripIri: string;
  slug: string;
  headline: string;
  story: string;
  occurred: string;
  offset: string;
  tagsText: string;
  mode: Mode | "";
  status: EntryStatus;
  lat: string;
  long: string;
  precision: string;
  placeName: string;
  locality: string;
  country: string;
  /** Richer than `Draft.photos`: a slot in flight has no `Photo` yet. */
  slots: PhotoSlot[];
  coordinateAuthor: CoordinateAuthor;
  occurredAuthor: TimeAuthor;
  offsetAuthor: TimeAuthor;
  /** §11.5's mark, and the one credit that is not a projection of a record:
   *  it latches. ./notes.md#what-is-derived-and-what-had-to-stay-stored */
  offsetGuess: boolean;
}

/** Which photo supplied a value, or `null` for one no photo supplied — what
 *  the three rendered notes are built from, and what made the three
 *  `*Source` states redundant. */
export const sourceOf = (author: CoordinateAuthor | TimeAuthor): string | null =>
  author.kind === "photo" ? author.name : null;

/**
 * THE ONE WRITER for the two records and all three surfaces —
 * `creditCoordinate`'s deal, with more to keep true: the mark reads BOTH
 * records, so deriving it anywhere else would be a second copy of the rule
 * that says nothing when the two stop agreeing.
 *
 * THE TWO CREDITS ARE THE RECORDS, RESTATED. `photo` means a file supplied
 * this half and is named for it (§11.3); `owner` and `nobody` both mean
 * nothing on screen may credit a photo for it.
 *
 * THE MARK, IN ONE LINE: the offset is a guess while NOBODY has supplied it
 * and a photo has supplied the clock beside it. Three halves, all
 * load-bearing:
 *
 *   - `nobody` on the offset IS this machine's guess (see `TimeAuthor`), so
 *     the mark is ruling T4-A's "the displayed offset is the machine's own"
 *     without interrogating the value. On an edit the entry's stored offset is
 *     seeded `owner`, so a photo that lacks the tag casts no doubt on it —
 *     badging confirmed data because a photo said nothing is §11.5's error
 *     with the sign flipped.
 *   - `photo` on the wall clock is what makes this §11.5's composition rather
 *     than the ordinary default every create opens with. A photo that carried
 *     no time at all leaves the offset exactly as it was and has said nothing
 *     about it, so it marks nothing.
 *   - `|| was` IS RULING T4-G, and it is the whole of it. The clock's own
 *     `onChange` credits the owner, which used to clear the mark — so the
 *     owner nudging `07:05` to `07:06`, because they remember it was a minute
 *     later, left `07:06 +09:00` with §11.5's composition fully intact and
 *     the warning gone. A keystroke in the clock says nothing about who
 *     supplied the OFFSET, so the warning is still true; what it does say is
 *     that the note may no longer name the photo, and `occurredSource`
 *     handles that on its own line. Choosing an offset is what ends the mark,
 *     which is what scenario 3 says in words.
 *
 * A CALLER THAT CHANGES ONE RECORD PASSES THE OTHER'S CURRENT VALUE, which is
 * how two independent records (T4-C) share one writer without becoming one
 * flag.
 */
export function withTimeCredit(
  state: EntryFormState,
  occurredTo: TimeAuthor,
  offsetTo: TimeAuthor,
): EntryFormState {
  return {
    ...state,
    occurredAuthor: occurredTo,
    offsetAuthor: offsetTo,
    offsetGuess: offsetTo.kind === "nobody" && (occurredTo.kind === "photo" || state.offsetGuess),
  };
}

/* ════════════════════════════════════════════════════════════════ actions ══ */

/**
 * The thirteen fields a keystroke carries a string into. `mode` and `status`
 * are the two `Draft` fields whose values are not strings, and they get their
 * own kinds below: ./notes.md#three-deviations-from-the-plans-action-union-each-measured
 */
export type TextField = Exclude<keyof Draft, "savedAt" | "photos" | "mode" | "status">;

/** What the settings gate answers, and the fallbacks a restore needs from
 *  outside the form. Passed in rather than read, so the transition stays pure. */
export interface RestoreContext {
  /** §11 guardrail 7: on an edit the trip and the slug are where the resource
   *  LIVES, so a restore may not write through those two controls. */
  addressFixed: boolean;
  /** The trips on offer. One that is not leaves the picker unchosen, which is
   *  what the initial state does with the same fact. */
  tripIris: readonly string[];
  /** §7.6's `dy:defaultPrecisionMeters` as the select's value, or `""`. What a
   *  precision the control cannot show falls back to (§9 step 3). */
  presetPrecision: string;
}

/**
 * EVERY LEGAL TRANSITION, AND NOTHING ELSE. A field group receives callbacks
 * built from these and never `dispatch` itself, so it cannot invent one.
 */
export type EntryFormAction =
  | { kind: "field"; field: TextField; value: string }
  | { kind: "mode"; value: Mode | "" }
  | { kind: "status"; value: EntryStatus }
  /** A photo's GPS, already stringified at full precision (§11.3). */
  | { kind: "photo-coordinate"; name: string; lat: string; long: string }
  /** Either half of a photo's timestamp, or neither (§11.5). `key` is the slot
   *  identity the cross-half guard compares; `name` is what the notes show. */
  | { kind: "photo-timestamp"; key: string; name: string; wall?: string; offset?: string }
  | { kind: "restore"; draft: Draft; context: RestoreContext }
  | { kind: "slot-added"; slot: PhotoSlot }
  | { kind: "slot-settled"; key: string; slot: PhotoSlot };
