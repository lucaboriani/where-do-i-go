/**
 * §10's four steps as the editor spends them: the pre-flight refusals, the
 * `Entry` this form assembles, and the three values that make a SECOND save an
 * update rather than a first. ./notes.md#what-use-entry-save-is-tested-for
 */

import { useState } from "react";
import { documentUrlOf } from "@/lib/pod/entry-model";
import { describe } from "@/lib/pod/result";
import { saveEntry } from "@/lib/pod/save-entry";
import { placeFor, placeTextOf } from "@/lib/studio/place/place";
import { revalidatePublicSite } from "@/lib/studio/revalidate";
import { nowWithOffset, toOffsetDateTime } from "@/lib/studio/time/offsets";
import { SCHEMA_VERSION } from "@/lib/vocab";
import { photosFor } from "./use-photo-pipeline";
import type { DraftText, SettleDraft } from "./use-entry-draft";
import type { EditorTrip } from "../entry-editor";
import type { EntryFormState } from "../state/actions";
import type { Entry, Photo, Status as EntryStatus } from "@/lib/pod/schema";
import type { SaveEntryReport } from "@/lib/pod/save-entry";
import type { Precondition } from "@/lib/pod/write";
import type { EntryPlace } from "@/lib/studio/place/place";
import type { StudioSessionLike } from "@/lib/studio/session";

/* ═════════════════════════════════════════════════════════════════ helpers ══ */

/** Every human-readable literal is language-tagged (§6); an edit keeps the tag
 *  it had. A fixed default, not a control: ./notes.md#the-language-tag-is-a-fixed-default */
const LANGUAGE = "en";

/** `dy:tag` is a token, not prose (§3): comma-separated in, trimmed, untagged. */
const parseTags = (text: string) =>
  text
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");

/** §11 guardrail 7: an entry's `dy:slug` is its filename. Encoded for the
 *  reason lib/pod/read.ts's URL builders are — an unencoded `#` or `?` in a
 *  slug silently addresses a different resource. */
function entryUrlIn(trip: EditorTrip, slug: string): string {
  const container = trip.entriesContainer.endsWith("/")
    ? trip.entriesContainer
    : `${trip.entriesContainer}/`;
  return `${container}${encodeURIComponent(slug)}.ttl`;
}

/* ══════════════════════════════════════════════════ what the owner is told ══ */

/** The result of a save, in the two roles that ANNOUNCE it — `status` for news,
 *  `alert` for a decision: ./notes.md#six-outcomes-six-things-to-say */
export type Announcement = { tone: "ok" | "problem"; text: string; detail?: string };

/** SIX OUTCOMES, SIX THINGS TO SAY — keyed on WHICH STEP FAILED, never on
 *  `recovery`, which collapses two pairs: ./notes.md#six-outcomes-six-things-to-say */
export function announce(report: SaveEntryReport, status: EntryStatus): Announcement {
  const failure = report.failed;

  /** A clean save says nothing about the public site, the cache or what a
   *  visitor might see — a measured wording trap, not a preference:
   *  ./notes.md#a-clean-save-says-nothing-about-the-public-site */
  if (failure === undefined) {
    return {
      tone: "ok",
      text:
        status === "published"
          ? "Saved and published. The entry is on your Pod, listed on its trip, and the pages that show it have been refreshed."
          : "Saved as a draft. The entry is on your Pod, readable only by you, and no row for it appears in the trip's index.",
    };
  }

  const detail = describe(failure.error);

  switch (failure.step) {
    /**
     * Nothing reached the Pod, so nothing there changed. A 412 is its own
     * sentence: the resource is not what this edit started from, and "try
     * again" is wrong advice — the identical request fails identically.
     */
    case "entry":
      return report.recovery === "refetch"
        ? {
            tone: "problem",
            text:
              "Refused: what is on your Pod at this address is no longer what you started from — " +
              "it changed elsewhere, or in another tab. Reload the entry to see the newer version, " +
              "then apply your change to that. Nothing on your Pod was overwritten, and everything " +
              "you typed is still on this screen.",
            detail,
          }
        : {
            tone: "problem",
            text:
              "The entry did not reach your Pod, and nothing there changed. Everything you typed is " +
              "still on this screen — try again.",
            detail,
          };

    /**
     * §10's published-but-unreadable. The entry IS on the Pod; what could not
     * be confirmed is who may read it, and the index was deliberately left
     * alone rather than advertising a link the public may not be able to
     * follow.
     */
    case "access":
      return {
        tone: "problem",
        text:
          "The entry is on your Pod, but its access could not be confirmed: visitors may not be able " +
          "to read it, so it has not been added to its trip either. Rebuild this trip's index to " +
          "settle both.",
        detail,
      };

    /**
     * §10's "invisible, not corrupt". The wording matters more here than
     * anywhere else on this screen: an owner who reads this as "your work went
     * nowhere" retypes an entry that is already on the Pod, and the retype
     * either collides on the precondition or overwrites the copy that is there.
     */
    case "index":
      return {
        tone: "problem",
        text:
          "The entry is saved on your Pod with the right access, but its trip's index could not be " +
          "updated, so it will not appear in the trip listing yet. Rebuild this trip's index to " +
          "list it.",
        detail,
      };

    /**
     * Everything on the Pod is consistent and only this app's cache is behind —
     * which heals on its own when the 15-minute timer rolls. The same
     * `recovery` value as a refused write, and the opposite situation.
     */
    case "revalidate":
      return {
        tone: "problem",
        text:
          "The entry is saved on your Pod and listed on its trip. Only the public site's cache could " +
          "not be cleared, so visitors may see the previous version for a few minutes.",
        detail,
      };
  }
}

/* ══════════════════════════════════════════════════════════════════ target ══ */

/** Where the entry lives once it exists, and the ETag of the state we hold.
 *  `null` twice over means two things: ./notes.md#what-a-target-is-and-what-a-null-etag-means */
export type Target = { url: string; etag: string | null };

/** The precondition for the next write, or `null` when there is none to be
 *  had. No third option, and both wrong answers are silent:
 *  ./notes.md#the-precondition-has-no-third-option */
export function preconditionFor(target: Target | null): Precondition | null {
  if (target === null) return { create: true };
  return target.etag === null ? null : { etag: target.etag };
}

/* ══════════════════════════════════════════════════════════════════ inputs ══ */

export interface EntrySaveSeed {
  /** Its `fetch` is the only authenticated one in the browser: anonymously a
   *  Pod read is "not found" and a write is a 401 (invariant 4). */
  session: StudioSessionLike;
  trips: readonly EditorTrip[];
  /** Absent means CREATE. Present means EDIT, and its `etag` is the one from
   *  THE READ THAT PRODUCED THIS STATE (§10). */
  initial: { entry: Entry; etag: string | null } | undefined;
  /** The twenty values the form is. */
  values: EntryFormState;
  /** The sixteen the draft is — the SAME object `useEntryDraft` was given, so
   *  that what `settle` is told was sent is what the entry was built from. */
  text: DraftText;
  /** The `ready` picks, from `attachedOf`. */
  attached: readonly Photo[];
  /** §9 steps 1–3, delegated whole: ./use-settings-gate.ts */
  fuzzed: (point: { lat: number; long: number }) => EntryPlace["geo"];
}

export interface EntrySave {
  target: Target | null;
  /** The address is fixed once the resource exists: this editor writes, and
   *  moving a resource is a copy and a delete it does not do. */
  addressFixed: boolean;
  outcome: Announcement | null;
  saving: boolean;
  /**
   * `settle` IS A PARAMETER AND NOT AN OPTION, which is where the two hooks
   * meet: the draft's scope follows `target`, so it is built after this hook,
   * and §10 step 1 completing is the one moment the local copy stops being a
   * backup. ./notes.md#the-save-and-the-draft-meet-at-the-submit-handler
   */
  save: (settle: SettleDraft) => Promise<void>;
}

/* ═════════════════════════════════════════════════════════════════ the hook ══ */

export function useEntrySave({
  session,
  trips,
  initial,
  values,
  text,
  attached,
  fuzzed,
}: EntrySaveSeed): EntrySave {
  const existing = initial?.entry;
  const {
    tripIri,
    slug,
    headline,
    story,
    occurred,
    offset,
    tagsText,
    mode,
    status,
    lat,
    long,
    placeName,
    locality,
    country,
  } = values;

  const [target, setTarget] = useState<Target | null>(
    initial === undefined ? null : { url: documentUrlOf(initial.entry.iri), etag: initial.etag },
  );
  /** THE TWO TIMESTAMPS THAT MUST NOT MOVE — after the first save this is the
   *  only thing that knows them: ./notes.md#the-two-timestamps-that-must-not-move */
  const [provenance, setProvenance] = useState<{ created?: string; datePublished?: string }>({
    created: existing?.created,
    datePublished: existing?.datePublished,
  });
  const [outcome, setOutcome] = useState<Announcement | null>(null);
  const [saving, setSaving] = useState(false);
  const trip = trips.find((t) => t.iri === tripIri);
  const addressFixed = target !== null;

  async function save(settle: SettleDraft) {
    // The previous result stops being true the moment a new save starts, and
    // leaving it up would also let a caller mistake it for this save's.
    setOutcome(null);

    const missing = [
      trip === undefined ? "a trip" : null,
      slug.trim() === "" ? "a slug" : null,
      headline.trim() === "" ? "a headline" : null,
    ].filter((what): what is string => what !== null);

    if (trip === undefined || missing.length > 0) {
      setOutcome({
        tone: "problem",
        text: `This entry needs ${missing.join(", ")} before it can be saved. Nothing has been sent to your Pod.`,
      });
      return;
    }

    const precondition = preconditionFor(target);
    if (precondition === null) {
      setOutcome({
        tone: "problem",
        text:
          "This entry is on your Pod, but your Pod did not return a version tag for the last write, " +
          "so there is nothing to condition the next one on. Reload the entry before editing it " +
          "further: saving without a precondition would silently overwrite whatever is there now.",
      });
      return;
    }

    const url = target?.url ?? entryUrlIn(trip, slug.trim());
    const language = existing?.headline.language ?? LANGUAGE;
    const body = story.trim();

    /** ONE INSTANT for this whole save, handed to `saveEntry` so the value this
     *  form remembers is the one that reaches the Pod:
     *  ./notes.md#one-instant-for-the-whole-save */
    const stamp = nowWithOffset();
    const creating = target === null;
    // Mirrors saveEntry's own rule rather than replacing it: invent `created`
    // only when creating. An older entry that has none must not be given one
    // now — that would claim the record came into being today.
    const created = provenance.created ?? (creating ? stamp : undefined);
    // "When it became public", fixed at the first publication and never
    // recomputed. Unpublishing does not clear it: it is a fact about the past.
    const datePublished = provenance.datePublished ?? (status === "published" ? stamp : undefined);

    /**
     * §9 HAPPENS HERE, so `saveEntry` is never handed a precise coordinate.
     * THREE OUTCOMES, `undefined` MEANS TWO OF THEM, AND HALF A PAIR IS
     * "NOTHING TYPED" — ruling F-A, measured; `Number("")` is `0`.
     * ./notes.md#fuzzing-happens-here-and-half-a-pair-is-nothing-typed
     */
    const touchedCoordinate = lat.trim() !== "" || long.trim() !== "";
    const place = placeFor(
      existing?.place,
      /* "Nothing typed" is THE GEOMETRY THE ENTRY ALREADY HAD, never `undefined`,
         and the two conjuncts are ruling F-A. `touchedCoordinate` is subsumed by
         them rather than load-bearing, conditionally:
         ./notes.md#the-untouched-geometry-is-spelled-as-the-stored-one */
      touchedCoordinate && lat.trim() !== "" && long.trim() !== ""
        ? fuzzed({ lat: Number(lat), long: Number(long) })
        : existing?.place?.geo,
      /* AND THE TEXT NEEDS NO SUCH FLAG — these three controls ARE seeded from
         the entry: ./notes.md#the-untouched-geometry-is-spelled-as-the-stored-one */
      placeTextOf({ placeName, locality, country }, language),
    );

    /** `dcterms:created` AND the fields this form does not offer are carried
     *  through; an edit without them destroys them silently:
     *  ./notes.md#what-the-entry-carries-through-untouched */
    const entry: Entry = {
      iri: `${url}#it`,
      slug: slug.trim(),
      status,
      schemaVersion: SCHEMA_VERSION,
      headline: { value: headline.trim(), language },
      articleBody: body === "" ? undefined : { value: body, language },
      trip: trip.iri,
      // WHAT THE TWO CONTROLS HOLD, concatenated and never converted, and what
      // this line must not become is a THIRD source:
      // ./notes.md#the-timestamp-is-concatenated-never-converted
      occurredAt: occurred === "" ? undefined : toOffsetDateTime(occurred, offset),
      datePublished,
      travelModeFrom: mode === "" ? undefined : mode,
      place,
      /** WHAT THE ENTRY ARRIVED WITH, THEN WHAT WAS PICKED HERE — and only the
       *  `ready` picks: ./notes.md#the-photos-and-why-a-failed-slot-reaches-nothing */
      photos: photosFor(existing?.photos ?? [], attached),
      tags: parseTags(tagsText),
      created,
      creator: existing?.creator ?? session.info.webId,
      // Stamped by saveEntry, which shares one instant with the index it writes.
      modified: existing?.modified,
    };

    setSaving(true);
    let report: SaveEntryReport;
    try {
      report = await saveEntry({
        // The visitor's own authenticated fetch, and never the ambient one:
        // anonymous reads as "not found" on a hosted Pod (invariant 4).
        fetch: session.fetch,
        entry,
        precondition,
        indexUrl: trip.indexUrl,
        tripIri: trip.iri,
        tripSlug: trip.slug,
        webId: session.info.webId,
        // Step 4 posts to this app's own route, unauthenticated by design.
        revalidate: revalidatePublicSite,
        now: () => stamp,
      });
    } catch (cause) {
      /** Reaching here means something threw where nothing is meant to, so what
       *  reached the Pod is UNKNOWN rather than failed:
       *  ./notes.md#a-throw-means-unknown-not-failed */
      setOutcome({
        tone: "problem",
        text:
          "The save stopped unexpectedly, so what reached your Pod is unknown. Reload the entry " +
          "to see what is there before saving again.",
        detail: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    } finally {
      setSaving(false);
    }

    // The resource exists from the moment step 1 succeeds, whatever happened
    // after it — so the next save is an update, with whatever ETag came back.
    if (report.completed.includes("entry")) {
      /** STEP 1 IS THE WHOLE TEST, including the two §10 outcomes where a LATER
       *  step failed: ./notes.md#step-1-is-the-whole-test-for-the-settle */
      settle(text, report.entryUrl);
      setTarget({ url: report.entryUrl, etag: report.etag ?? null });
      // What the Pod now holds, so the next save carries it rather than
      // dropping it. See the note on `provenance`.
      setProvenance({ created, datePublished });
    }
    setOutcome(announce(report, status));
  }
  return { target, addressFixed, outcome, saving, save };
}
