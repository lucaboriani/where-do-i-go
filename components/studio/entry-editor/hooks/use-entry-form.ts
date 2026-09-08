/**
 * The twenty values the form IS, as one `useReducer`, plus the named callbacks
 * the five field groups get instead of `dispatch`.
 * ../state/notes.md#guard-inside-the-transition
 */

import { useMemo, useReducer } from "react";
import {
  OFFSETS,
  offsetHere,
  offsetMinutes,
  offsetOf,
  wallClockNow,
  wallClockOf,
} from "@/lib/studio/time/offsets";
import { sourceOf } from "../state/actions";
import { entryFormReducer } from "../state/entry-form-reducer";
import type { EntryFormState, PhotoSlot, RestoreContext, TextField } from "../state/actions";
import type { Entry, Status as EntryStatus, TravelMode as Mode } from "@/lib/pod/schema";
import type { Draft } from "@/lib/studio/drafts";

/** What the form opens with, and the only two facts the initial state needs:
 *  the entry being edited if there is one, and the trips on offer. */
export interface EntryFormSeed {
  existing: Entry | undefined;
  tripIris: readonly string[];
}

/**
 * Where every seeding decision in the form lives — and there are five that are
 * not the obvious spelling. ./notes.md#the-five-seedings-that-are-not-obvious
 */
export function initialEntryFormState({ existing, tripIris }: EntryFormSeed): EntryFormState {
  return {
    tripIri: existing?.trip !== undefined && tripIris.includes(existing.trip) ? existing.trip : "",
    slug: existing?.slug ?? "",
    headline: existing?.headline.value ?? "",
    story: existing?.articleBody?.value ?? "",
    occurred: wallClockOf(existing?.occurredAt),
    /**
     * THE OTHER HALF OF THE TIMESTAMP, AND NOW AN ANSWER RATHER THAN A GUESS.
     *
     * §7.3: `dy:occurredAt` "carries the local UTC offset of the place", because
     * normalising to UTC destroys the fact that it was evening. Until this state
     * existed the offset was computed at save time as
     * `offsetOf(existing?.occurredAt) ?? offsetHere(wall)` — the entry's own,
     * else THE EDITING MACHINE'S — so writing up a Japan trip from the sofa at
     * home stamped an evening in Tokyo `+02:00`, silently, and no control on the
     * form could correct it.
     *
     * THE INITIAL VALUE IS THAT SAME CHAIN, UNCHANGED. The behaviour has not
     * moved; the guess has become visible and correctable, which is the whole
     * change. On an edit it is the offset the entry already carries, so an edit
     * that never opens this control writes the timestamp back exactly as stored.
     *
     * `wallClockNow()` RATHER THAN `occurred`, and that is not interchangeable:
     * `occurred` is `""` on a create and `offsetHere("")` is `+00:00`, not this
     * machine's zone. The control has a value at MOUNT, when there may be no date
     * on the form at all, so the honest wall clock to ask about is the current
     * instant.
     *
     * ONE CONSEQUENCE OF THAT, ON THE RECORD: in a zone with DST, a create
     * defaults to TODAY'S offset rather than the one in force on the date the
     * owner then types. The old code asked about the entry's own wall clock and
     * so got that right by accident, in the one case where its answer was
     * defensible at all. It is a fair trade because the value is now on screen
     * and one click from correct, where before it was neither.
     */
    offset: offsetOf(existing?.occurredAt) ?? offsetHere(wallClockNow()),
    tagsText: existing?.tags.join(", ") ?? "",
    mode: existing?.travelModeFrom ?? "",
    status: existing?.status ?? "draft",
    /**
     * THE COORDINATE, AS TYPED — and EMPTY on an edit, even for an entry that
     * already has one.
     *
     * Prefilling from `existing.place.geo` is the obvious spelling and is the
     * bug. What is stored there is the PUBLISHED pair, already snapped, and not
     * necessarily on the grid the settings name today: putting it in the box
     * makes it indistinguishable from something the owner typed, so every save
     * re-snaps it and the pin walks. Measured on the §7.3 fixture —
     * `snapToPrecision(35.6938, 139.7034, 500)` is 35.69423/139.70348, half a
     * cell from where it started.
     *
     * Empty therefore means "leave the coordinate alone", which is the same
     * treatment `created` and `datePublished` get and is said on the control's
     * own hint. Typing means "replace it", and typing something inside the home
     * region means "remove it" — see `save()`.
     */
    lat: "",
    long: "",
    /**
     * The grid in metres, as the select's value. `""` until §7.6 answers, which
     * is also the state the control keeps for ever when it cannot be read: there
     * is deliberately no built-in default, because "a fallback is a distance this
     * project would be choosing for someone else's front door".
     */
    precision: "",
    /**
     * WHERE THE OWNER WAS, IN WORDS — and unlike the coordinate above, SEEDED
     * FROM THE ENTRY BEING EDITED.
     *
     * The asymmetry is the whole of the "untouched versus removed" logic for
     * text, so it is worth saying why it goes the other way. The stored
     * coordinate must not be prefilled because what is on the Pod is the
     * PUBLISHED pair, already snapped, and putting it in the box makes it
     * indistinguishable from something typed — so every save re-snaps it and the
     * pin walks. A name has no such transformation: what is on the Pod is exactly
     * what was typed, so showing it costs nothing and buys the two things the
     * coordinate has to buy with a separate `touchedCoordinate` flag. A box the
     * owner never opens still holds the stored value, so saving writes it back
     * unchanged — untouched. A box the owner EMPTIES holds `""`, which `save()`
     * turns into `undefined` and `placeFor` turns into a removal.
     *
     * Prefilling is therefore not a convenience here; it is what makes the two
     * instructions distinguishable at all. An editor that left these empty on an
     * edit would delete the place name of every entry whose headline was
     * corrected — silently, and only discoverable by reading the Pod.
     *
     * "SEEDED FROM THE ENTRY" STOPS BEING TRUE AT EXACTLY ONE MOMENT: `restore()`,
     * which writes these controls from a stored draft rather than from the entry.
     * That is where the missing flag would otherwise have been needed, and it is
     * handled there instead — a draft field that is ABSENT leaves the control
     * alone, and only an explicitly empty one empties it.
     */
    placeName: existing?.place?.name?.value ?? "",
    locality: existing?.place?.locality ?? "",
    /** A CODE, not prose (§7.3) — `schema:addressCountry` is written untagged,
     *  so what belongs in this box is `JP`, not `Japan`. */
    country: existing?.place?.country ?? "",
    /**
     * THE PHOTOS PICKED IN THIS EDITOR, and NOT the ones the entry arrived with.
     *
     * Seeding this from `existing.photos` is the obvious spelling and is wrong
     * twice over. It would renumber their `sortOrder` from the list position on
     * every save, walking §7.3 data nobody touched — the same defect the `lat`
     * state's note describes for the coordinate — and each seeded row would
     * render a settled `role="status"` at mount, so the editor would announce, to
     * a screen reader, news about photos that have not changed. What the entry
     * arrived with is carried at save time instead, by `photosFor`.
     */
    slots: [],
    /**
     * WHO SUPPLIED THE COORDINATE — see `CoordinateAuthor` for what the three
     * answers mean and why "is the box empty?" is not one of them.
     *
     * A REF, AND READ AT THE MOMENT OF THE FILL RATHER THAN FROM A CLOSURE. This
     * is `touched`'s reason plus one more that is specific to this record. A fill
     * happens in `attach`'s continuation, after two awaits — the decode and two
     * PUTs — and the handler that started it closed over the render BEFORE the
     * pick. So a closure would answer "who supplied the coordinate?" as of a
     * moment that can be several seconds old, and the two things that can happen
     * inside that window are exactly the two this record exists to refuse: the
     * owner typing while the photo uploads, and a second photo settling. Reading
     * a ref written synchronously means the first writer wins even when the two
     * writers overlap.
     *
     * DECLARED HERE, ABOVE `attach`, for the reason `touched`'s note gives at
     * length: `react-hooks/immutability` refuses a `.current` write inside a
     * function that closes over a `useRef` declared below it, and it reports the
     * pre-existing writes rather than the new declaration when you get it wrong.
     *
     * SEEDED FROM THE ENTRY, AND THAT CONDITION IS THE WHOLE OF RULING T3-B.
     * `nobody` unconditionally is the spelling this shipped with for a day, and
     * it let a photo move — or, from inside the home region, DELETE — a pin an
     * edit was loaded with. See `CoordinateAuthor` for the mechanism; the short
     * version is that on an edit an empty box means "the stored pair stands", so
     * there is a value to protect even though the form holds none.
     *
     * IT IS `existing?.place?.geo`, NOT `lat`/`long`, AND NOT UNCONDITIONAL.
     * Both boxes are `""` on an edit by design, so seeding from them is the same
     * defect spelled differently. And an unconditional `{ kind: "owner" }` would
     * switch auto-fill off for EVERY edit, silently — including an entry that has
     * no pin to protect, which is the case with nothing to lose and the one place
     * the fill is still wanted on an edit. Every refusal a test can make of this
     * record passes under that lazy spelling; what catches it is the allow-case,
     * an edit of an entry with no geometry where the photo must still fill.
     */
    coordinateAuthor: existing?.place?.geo === undefined ? { kind: "nobody" } : { kind: "owner" },
    /**
     * WHO SUPPLIED THE WALL CLOCK, AND WHO SUPPLIED THE OFFSET — see `TimeAuthor`
     * for why these are two records rather than one, and for why they are seeded
     * from the entry rather than from the boxes.
     *
     * REFS, AND READ AT THE MOMENT OF THE FILL, for `coordinateAuthor`'s reason:
     * a fill happens in `attach`'s continuation, after the decode and two PUTs,
     * so a closure would answer "who supplied this?" as of a moment that can be
     * several seconds old — and the two things that happen inside that window are
     * exactly the two these records exist to refuse, the owner typing while the
     * photo uploads and a second photo settling.
     *
     * DECLARED HERE, ABOVE `attach`, for the reason `touched`'s note gives at
     * length: `react-hooks/immutability` refuses a `.current` write inside a
     * function that closes over a `useRef` declared BELOW it, and it reports the
     * pre-existing writes rather than the new declaration when you get it wrong.
     */
    occurredAuthor: existing?.occurredAt === undefined ? { kind: "nobody" } : { kind: "owner" },
    offsetAuthor: existing?.occurredAt === undefined ? { kind: "nobody" } : { kind: "owner" },
    /**
     * IS THE OFFSET THIS MACHINE'S GUESS, STANDING BESIDE A CLOCK A PHOTO
     * SUPPLIED? §11.5's state, and the one the owner must be able to see.
     *
     * A BOOLEAN AND NOT A NAME, as of ruling T4-G. It held the photo's name until
     * 2026-09-07, which fused two facts with two lifetimes into one value: the
     * name is only checkable while the photo's clock is still in the box, and the
     * warning is true for as long as nobody has answered the offset. The name now
     * comes from `occurredSource` — so a keystroke in the clock takes the name
     * out of the sentence and leaves the warning standing.
     *
     * IT IS A RECORD, NOT A COMPARISON, and that is not a detail: marking the
     * offset whenever it equals `offsetHere(wallClockNow())` would tell an owner
     * who deliberately chose the zone they are sitting in — for most entries the
     * right answer — that their own choice is a guess.
     */
    offsetGuess: false,
  };
}

/** One callback per control, so a group never holds `dispatch` and cannot
 *  invent a transition. Spelled by hand: fifteen names is the interface. */
export interface EntryFormSetters {
  tripIri: (value: string) => void;
  slug: (value: string) => void;
  headline: (value: string) => void;
  story: (value: string) => void;
  occurred: (value: string) => void;
  offset: (value: string) => void;
  tagsText: (value: string) => void;
  lat: (value: string) => void;
  long: (value: string) => void;
  precision: (value: string) => void;
  placeName: (value: string) => void;
  locality: (value: string) => void;
  country: (value: string) => void;
  mode: (value: Mode | "") => void;
  status: (value: EntryStatus) => void;
}

export interface EntryForm {
  values: EntryFormState;
  /** Which photo supplied each of the three, or `null`. Derived rather than
   *  stored: ../state/notes.md#what-is-derived-and-what-had-to-stay-stored */
  sources: { coordinate: string | null; occurred: string | null; offset: string | null };
  /** What the offset control offers. Derived from one field, exactly as
   *  `sources` is from three: ./notes.md#the-offset-option-list-is-the-forms-own */
  offsetOptions: string[];
  set: EntryFormSetters;
  addSlot: (slot: PhotoSlot) => void;
  settleSlot: (key: string, slot: PhotoSlot) => void;
  offerCoordinate: (name: string, lat: string, long: string) => void;
  offerTimestamp: (offer: { key: string; name: string; wall?: string; offset?: string }) => void;
  restore: (draft: Draft, context: RestoreContext) => void;
}

export function useEntryForm(seed: EntryFormSeed): EntryForm {
  const [values, dispatch] = useReducer(entryFormReducer, seed, initialEntryFormState);
  /**
   * MEMOISED, AND THAT IS A REQUIREMENT RATHER THAN AN OPTIMISATION — measured
   * on 2026-09-08: ./notes.md#why-the-setters-are-fifteen-names-and-not-one-dispatch
   */
  const set = useMemo<EntryFormSetters>(() => {
    const field = (name: TextField) => (value: string) =>
      dispatch({ kind: "field", field: name, value });
    return {
      tripIri: field("tripIri"),
      slug: field("slug"),
      headline: field("headline"),
      story: field("story"),
      occurred: field("occurred"),
      offset: field("offset"),
      tagsText: field("tagsText"),
      lat: field("lat"),
      long: field("long"),
      precision: field("precision"),
      placeName: field("placeName"),
      locality: field("locality"),
      country: field("country"),
      mode: (value) => dispatch({ kind: "mode", value }),
      status: (value) => dispatch({ kind: "status", value }),
    };
  }, []);

  /**
   * What the offset control offers: `OFFSETS`, plus whatever it is
   * currently holding.
   *
   * `precisionOptions`' SHAPE EXACTLY, including why it is a `Set`. It does not
   * special-case the value it cannot offer — it unions the held value into the
   * list, and the `Set` is what stops an offset that IS on the list appearing
   * twice. That single shape covers all three things this control has to do
   * with `+05:15`: render it rather than blanking, survive an edit that never
   * touched it, and not duplicate `+09:00`.
   *
   * SILENT SUBSTITUTION IS THE FAILURE THIS PREVENTS, AND IT IS NOT THE BLANK
   * CONTROL EVERYONE EXPECTS — measured, on this file's own tests, by deleting
   * the `add` above and rendering an entry stored with `+05:15`: the control
   * showed **`-12:00`**, the FIRST option, not an empty box. React marks no
   * option as selected when the value matches none of them, and a single
   * `<select>` with nothing selected displays and reports its first option. So
   * the failure mode is an offset the owner never chose, in a control that
   * looks answered.
   *
   * THE UNION IS THEREFORE UNCONDITIONAL, which is where this parts company
   * with `precisionOptions`: that one adds `gridOf(precision)` only when it is
   * a usable grid, because §9 step 3 refuses a precision the select cannot show
   * and the value is validated again at save time. Here what the control shows
   * has to equal what `toOffsetDateTime` concatenates for EVERY state it can be
   * in, including one no code path can produce — a shape check on this line
   * would buy a tidier option list at the price of a control disagreeing with
   * the timestamp it is about to write.
   *
   * SORTED BY MINUTES, because `OFFSETS` is already in order and the one value
   * that may not be on it has to land WHERE A READER WILL LOOK: `+05:15`
   * belongs between `+05:00` and `+05:30`, and appending it after `+14:00`
   * looks like a bug in the list. A string sort is not available — see
   * `offsetMinutes`.
   */
  const offsetOptions = useMemo(() => {
    const all = new Set<string>(OFFSETS);
    all.add(values.offset);
    return [...all].sort((a, b) => offsetMinutes(a) - offsetMinutes(b));
  }, [values.offset]);

  return {
    values,
    offsetOptions,
    sources: {
      coordinate: sourceOf(values.coordinateAuthor),
      occurred: sourceOf(values.occurredAuthor),
      offset: sourceOf(values.offsetAuthor),
    },
    set,
    addSlot: (slot) => dispatch({ kind: "slot-added", slot }),
    settleSlot: (key, slot) => dispatch({ kind: "slot-settled", key, slot }),
    offerCoordinate: (name, lat, long) => dispatch({ kind: "photo-coordinate", name, lat, long }),
    offerTimestamp: (offer) => dispatch({ kind: "photo-timestamp", ...offer }),
    restore: (draft, context) => dispatch({ kind: "restore", draft, context }),
  };
}
