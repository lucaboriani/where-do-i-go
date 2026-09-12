/**
 * The twenty values the form IS, as one `useReducer`, plus the named callbacks
 * the five field groups get instead of `dispatch`.
 * components/studio/entry-editor/state/notes.md#guard-inside-the-transition
 */

import { useMemo, useReducer } from "react";
import {
  OFFSETS,
  offsetHere,
  offsetMinutes,
  offsetOf,
  wallClockNow,
  wallClockOf,
} from "@/lib/time/offsets";
import { sourceOf } from "@/components/studio/entry-editor/state/actions";
import { entryFormReducer } from "@/components/studio/entry-editor/state/entry-form-reducer";
import type { EntryFormState, PhotoSlot, RestoreContext, TextField } from "@/components/studio/entry-editor/state/actions";
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
    /** The other half of the timestamp, and an answer rather than a guess. The
     *  chain is the old save-time one: ./notes.md#the-offset-seeding-is-the-old-chain */
    offset: offsetOf(existing?.occurredAt) ?? offsetHere(wallClockNow()),
    tagsText: existing?.tags.join(", ") ?? "",
    mode: existing?.travelModeFrom ?? "",
    status: existing?.status ?? "draft",
    /** The coordinate as typed, and EMPTY on an edit even for an entry that has
     *  one — prefilling walks the pin: ./notes.md#empty-coordinate-boxes-on-an-edit */
    lat: "",
    long: "",
    /**
     * The grid in metres, as the select's value. `""` until §7.6 answers, which
     * is also the state the control keeps for ever when it cannot be read: there
     * is deliberately no built-in default, because "a fallback is a distance this
     * project would be choosing for someone else's front door".
     */
    precision: "",
    /** Where the owner was, in words — and unlike the coordinate above, SEEDED
     *  from the entry: ./notes.md#why-the-place-text-is-prefilled */
    placeName: existing?.place?.name?.value ?? "",
    locality: existing?.place?.locality ?? "",
    /** A CODE, not prose (§7.3) — `schema:addressCountry` is written untagged,
     *  so what belongs in this box is `JP`, not `Japan`. */
    country: existing?.place?.country ?? "",
    /** The photos picked in THIS editor, and not the ones the entry arrived
     *  with — carried by `photosFor`: ./notes.md#slots-is-not-seeded-from-the-entry */
    slots: [],
    /** Who supplied the coordinate; seeded from the entry, which is ruling
     *  T3-B: ./notes.md#the-coordinate-author-and-ruling-t3-b */
    coordinateAuthor: existing?.place?.geo === undefined ? { kind: "nobody" } : { kind: "owner" },
    /** Who supplied the wall clock, and who supplied the offset — two records,
     *  seeded from the entry: ./notes.md#the-two-time-authors */
    occurredAuthor: existing?.occurredAt === undefined ? { kind: "nobody" } : { kind: "owner" },
    offsetAuthor: existing?.occurredAt === undefined ? { kind: "nobody" } : { kind: "owner" },
    /** §11.5: is the offset this machine's guess beside a photo's clock? A
     *  record, not a comparison: ./notes.md#offsetguess-is-a-record-not-a-comparison */
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
   *  stored: components/studio/entry-editor/state/notes.md#what-is-derived-and-what-had-to-stay-stored */
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

  /** `OFFSETS` plus whatever the control is holding, unconditionally and
   *  sorted by minutes: ./notes.md#the-offset-option-list-is-the-forms-own */
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
