/**
 * The state the editor's form is, and the catalogue of transitions that may
 * change it. No React: every rule here is a pure function of the two.
 * ./notes.md#guard-inside-the-transition
 */

import type { Photo, Status as EntryStatus, TravelMode as Mode } from "@/lib/pod/schema";
import type { Draft } from "@/lib/studio/drafts";

/** WHO PUT THE COORDINATE IN THE BOXES — the record §11.3 turns on, EXPLICIT
 *  rather than inferred from emptiness in BOTH directions, and a different
 *  question from `touchedCoordinate`. Getting it wrong costs published data:
 *  ./notes.md#what-coordinateauthor-decides-and-what-it-does-not */
export type CoordinateAuthor =
  { kind: "nobody" } | { kind: "owner" } | { kind: "photo"; name: string };

/** WHO SUPPLIED EACH HALF OF THE TIMESTAMP — `CoordinateAuthor`'s question
 *  asked TWICE, because a clock and a zone compose where a lat and a long do
 *  not (T4-C), and `photo` carries a `key` as well as a name (T4-E):
 *  ./notes.md#two-time-records-not-one */
export type TimeAuthor =
  { kind: "nobody" } | { kind: "owner" } | { kind: "photo"; key: string; name: string };

/** ONE PICKED FILE, IN THE FOUR STATES IT PASSES THROUGH — a state machine so
 *  that only `ready` carries a `Photo`, and `key` IS NOT THE FILE NAME:
 *  ./notes.md#photoslot-is-a-state-machine-and-key-is-not-the-name */
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

/** THE ONE WRITER for the two records and all three surfaces, because the mark
 *  reads both. `|| was` is ruling T4-G and is the whole of it:
 *  ./notes.md#withtimecredit-is-the-one-writer */
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
