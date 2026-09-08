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

/**
 * Every human-readable literal is language-tagged (§6), and an entry being
 * edited keeps the tag it already had.
 *
 * A fixed default rather than a control: there is one owner writing one diary,
 * and a language picker is a feature to add when someone needs it. An UNtagged
 * literal is the thing §6 rules out, so a default is the honest minimum.
 */
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

/**
 * The result of a save, in the two roles that ANNOUNCE it: `status` for news,
 * `alert` for something needing a decision. Text dropped into a plain <div> is
 * text a screen-reader user never hears, and the result of a save arrives long
 * after focus has moved on.
 */
export type Announcement = { tone: "ok" | "problem"; text: string; detail?: string };

/**
 * SIX OUTCOMES, SIX THINGS TO SAY — keyed on WHICH STEP FAILED, never on
 * `recovery` alone.
 *
 * `recovery` has four values and §10 has six outcomes, so two pairs collide:
 * a refused write and a failed revalidation are both "retry" — and are opposite
 * situations, nothing written versus everything written — while an unverified
 * ACL and a refused index are both "rebuildIndex" but differ in whether the
 * entry is readable at all. Collapsing either pair sends the owner to the wrong
 * recovery: retyping work that is already on the Pod, or waiting out a cache
 * that will never refresh.
 *
 * So the message says what completed and what did not, and `describe(error)`
 * carries the technical detail underneath rather than into the sentence.
 */
export function announce(report: SaveEntryReport, status: EntryStatus): Announcement {
  const failure = report.failed;

  /**
   * A clean save says nothing about the public site, the cache or what a
   * visitor might see — deliberately, and it is not a wording preference.
   *
   * The only difference between this outcome and a failed revalidation is
   * whether the reader is warned about staleness, so the two messages must not
   * share that vocabulary or the warning stops carrying information. Measured:
   * with "and the public site has been refreshed" here, a hook that checked
   * `res.ok` and never read the body — the exact bug §10 step 4 and the route's
   * own docblock warn about — passed the test that exists to catch it, because
   * the success message it wrongly produced still mentioned the public site.
   */
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

/**
 * Where the entry lives once it exists, and the ETag of the state we hold.
 *
 * `null` means this editor has not written it and was not handed one, i.e. a
 * create. An `etag` of `null` on an existing resource is the awkward case
 * `SaveEntryReport.etag` documents: "the write happened, but the next update
 * has nothing to condition on and must re-read rather than invent one."
 */
export type Target = { url: string; etag: string | null };

/**
 * The precondition for the next write, or `null` when there is none to be had.
 *
 * `If-None-Match: *` creates; `If-Match: <etag>` updates. There is no third
 * option, and both wrong answers here are silent: reusing `{ create: true }`
 * after a create is a guaranteed 412 on a resource this editor just wrote, and
 * reusing the ETag from before the last write is a 412 the owner cannot act on
 * because the retry they try next fails identically. A blind PUT is a bug (§10).
 */
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
  /**
   * THE TWO TIMESTAMPS THAT MUST NOT MOVE, held here because after the first
   * save this component is the only thing that knows them.
   *
   * `saveEntry` sets `created` on a create and carries forward whatever the
   * caller supplies — but on the SECOND save of an entry this editor just
   * created, the caller is this form, `initial` is still absent, and a form
   * that supplies neither leaves `created` undefined on an update. The
   * serialiser then omits the triple and the first save's value is gone: §7.3's
   * distinction between "when the record came into being" and "when it became
   * public" destroyed on the second click, silently and permanently.
   * `datePublished` is the same bug in the other direction — recomputed from
   * the clock, it would creep forward on every save.
   *
   * Measured with a throwaway probe before this state existed: the second PUT
   * carried no `dcterms:created` at all.
   */
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

    /**
     * ONE INSTANT for this whole save, and it is handed to `saveEntry` rather
     * than left to its default so that the value this form remembers is the
     * value that reaches the Pod. The default is a `Z` normalised to `+00:00`;
     * this carries the owner's own offset, like every other timestamp §7.3
     * shows.
     */
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
     * §9, AND IT HAPPENS HERE — before the `Entry` below exists, so `saveEntry`
     * is never handed a precise coordinate and the only copy of one is in this
     * component's state and in the input the owner is looking at. "The studio
     * applies fuzzing before the write and discards the precise original."
     *
     * THREE OUTCOMES, AND `undefined` MEANS TWO DIFFERENT THINGS, which is why
     * `touchedCoordinate` is computed separately rather than inferred from a
     * missing geometry:
     *
     *   nothing typed  → the place travels through UNTOUCHED, coordinates and
     *                    all. They were snapped when they were stored and are
     *                    not necessarily on today's grid, so re-snapping them
     *                    would walk the pin on every save (see the note on the
     *                    `lat` state). ONE BOX OF THE PAIR counts as this, and
     *                    the paragraph at the end of this block is why.
     *   snap           → the published pair replaces whatever was there.
     *   drop           → the geometry is REMOVED. §9 step 2: not coarsened, and
     *                    the place keeps its name — "it is the geometry that is
     *                    absent, not the entry". On an edit that means deleting
     *                    a `#geo` that is already on the Pod, which is the half
     *                    an "add the new one" spelling silently skips.
     *
     * THE THREE TEXT FIELDS HAVE THE SAME THREE OUTCOMES AND ARE DECIDED
     * SEPARATELY, because a coordinate and a name are removed independently:
     * §9's drop keeps the name — "the entry is still written, with its place
     * name if it has one" — and clearing a name must leave the coordinate
     * alone. Their "untouched" is carried by the controls themselves rather
     * than by a flag; see the `placeName` state.
     *
     * FAIL CLOSED ON EVERYTHING ELSE. A form that somehow holds a coordinate
     * without trustworthy settings — a restored draft, a control re-enabled by
     * hand — publishes none: `fuzzForPublication` refuses settings that do not
     * parse, and the two guards above it refuse a gate that never opened and a
     * precision that is not a positive integer of metres. Every one of those is
     * a drop, and a drop still saves the entry.
     *
     * "TYPED" HERE MEANS "IN THE BOXES", AND THAT INCLUDES A PAIR A PHOTO
     * FILLED. This flag asks whether there is a coordinate to publish, and an
     * auto-filled one is a coordinate to publish — it is on the form, the owner
     * can see it, it is credited to the photo it came from, and it goes through
     * `fuzzed()` on this line like any other. `coordinateAuthor` is the record
     * that distinguishes the two, and it is deliberately not consulted here:
     * this line decides WHETHER a coordinate is written, that record decides
     * whether AUTO-FILL may write into the form, and collapsing them would
     * either publish nothing for every photo-filled entry or re-fuzz a stored
     * pair on every save.
     *
     * AND HALF A PAIR IS "NOTHING TYPED" — RULING F-A, AND THE TWO DIRECTIONS
     * DO NOT EVEN LAND IN THE SAME OCEAN. `Number("")` is `0`, so one typed
     * latitude composes `{ lat: 45.5155, long: 0 }`, which is finite and in
     * range and which `fuzzForPublication` therefore snaps and publishes.
     * Measured through the real function against §7.6's own settings:
     * `{45.5155, 0} → 45.51486 / 0.00000` and `{0, 9.2103} → 0.00000 /
     * 9.20909`. Both publish; neither drops. LATITUDE ONLY lands at 0° east of
     * the owner's own latitude — inland south-west France, a plausible-looking
     * pin on land, not open water. LONGITUDE ONLY lands in the Gulf of Guinea,
     * a few tens of km off Gabon — not the 700-odd km that belongs to `{0, 0}`
     * elsewhere in this codebase. The land pin is the worse of the two: nothing
     * distinguishes it on the map or in the data from a coordinate the owner
     * actually chose. Either way `dy:precisionMeters 500` stands beside it,
     * describing a pin the owner never typed as accurate to within half a
     * kilometre. Ruling T3-A's stated cost was that such an owner "must type
     * the second, rather than getting a silently wrong location" — which
     * assumed they are forced to notice, and nothing forces them: the outcome
     * region says saved and nothing on the form is red.
     *
     * F-A makes a half pair behave as the absence it already is, which is what
     * §9 does everywhere else — an unreadable gate, an unusable grid and
     * `insideHome` all drop rather than approximate. It may NOT be spelled as
     * the `drop` the table above defines: on an edit that deletes the pin the
     * entry already has, which is a removal the owner did not ask for either.
     * TELLING them, rather than silently dropping, is the better long-term
     * answer; it belongs in TODO.md as an open item and is not this line.
     */
    const touchedCoordinate = lat.trim() !== "" || long.trim() !== "";
    const place = placeFor(
      existing?.place,
      /* "Nothing typed" is spelled as THE GEOMETRY THE ENTRY ALREADY HAD, which
         `placeFor` carries through unchanged. It is deliberately not spelled as
         `undefined`: that is the DROP, and collapsing the two would delete a
         coordinate from the Pod every time an entry was edited without
         retyping one.

         THE PAIR-COMPLETENESS CONJUNCTS ARE RULING F-A, argued at the end of
         the docblock above: both boxes, or this is the untouched case.

         `touchedCoordinate` IS SUBSUMED BY THEM RATHER THAN LOAD-BEARING, and
         that is said out loud because this file has already carried one no-op
         defended by a comment claiming otherwise (see `placeFor`). A whole pair
         is necessarily a touched one, so the flag narrows nothing on this line.
         It stays because it names the question the docblock above argues —
         "is there a coordinate to publish at all" — and because folding the
         AND into its definition would give one name to two different rules:
         "the owner has been in these boxes", which is what that argument is
         about, and "what is in them is a point", which is this line. Ruling
         F-A fences the flag for the first reason; the second is why it would
         still be worth two names.

         THE REDUNDANCY IS CONDITIONAL ON `touchedCoordinate`'S CURRENT
         DEFINITION, NOT A PERMANENT PROPERTY OF THIS LINE: it holds only
         because a whole pair (both trims non-empty) always implies it under
         today's OR of the two trims. Any future redefinition of
         `touchedCoordinate` that is not implied by a whole pair — a third box
         added to the OR, a debounce, anything that can be false while both
         boxes hold text — changes what this conjunct does, and it would stop
         being a no-op the moment that happens. */
      touchedCoordinate && lat.trim() !== "" && long.trim() !== ""
        ? fuzzed({ lat: Number(lat), long: Number(long) })
        : existing?.place?.geo,
      /* AND THE TEXT NEEDS NO SUCH FLAG, which is the asymmetry the `placeName`
         state's note explains rather than an omission here: these three
         controls ARE seeded from the entry, so a box nobody opened already
         holds the stored value and writing it back is the untouched case. What
         `touchedCoordinate` has to reconstruct, the form carries. */
      placeTextOf({ placeName, locality, country }, language),
    );

    /**
     * `dcterms:created` AND the fields this form does not offer are carried
     * through from the entry being edited. §7.3: created "is when the record
     * came into being and datePublished is when it became public. They differ
     * by however long the draft sat." An edit that rewrites the resource
     * without them destroys them silently and permanently — the place and its
     * (already fuzzed) coordinates, the photos, the original creator.
     */
    const entry: Entry = {
      iri: `${url}#it`,
      slug: slug.trim(),
      status,
      schemaVersion: SCHEMA_VERSION,
      headline: { value: headline.trim(), language },
      articleBody: body === "" ? undefined : { value: body, language },
      trip: trip.iri,
      // WHAT THE TWO CONTROLS HOLD, concatenated and never converted — see
      // `toOffsetDateTime`. Either half may have been typed or chosen by the
      // owner, filled by a photo's EXIF (`offerTimestamp`), or left exactly as
      // the entry arrived: `offset` starts as the entry's own on an edit, so an
      // edit that never opened either control writes the timestamp back as it
      // was stored. What this line must not become is a THIRD source — §9 step
      // 3's rule for the precision, spelled for the timestamp: what the owner
      // can see is what gets published, which is also why a photo's EXIF is
      // never read here.
      occurredAt: occurred === "" ? undefined : toOffsetDateTime(occurred, offset),
      datePublished,
      travelModeFrom: mode === "" ? undefined : mode,
      place,
      /**
       * WHAT THE ENTRY ARRIVED WITH, THEN WHAT WAS PICKED HERE — and only the
       * `ready` picks, since `attached` is the filter. A failed slot reaches
       * neither the entry nor the index row: an optimistic slot saved with a
       * local preview URL would write `schema:contentUrl <blob:…>` into a
       * publicly readable resource, which 404s for every reader while the entry
       * reports itself saved.
       *
       * Pick nothing and this is `existing.photos`, unchanged and renumbered by
       * nothing — see `photosFor`.
       */
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
      /**
       * `saveEntry` reports every failure it knows about as a value, so
       * reaching here means something threw where nothing is meant to — and the
       * honest answer is that what reached the Pod is unknown, not that the
       * save failed.
       *
       * Caught for the reason the shell catches its two verbs: an unhandled
       * rejection would leave the button disabled and the screen looking as
       * though the click had done nothing at all.
       */
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
      /**
       * STEP 1 IS THE WHOLE TEST, including the two §10 outcomes where a LATER
       * step failed — an unverified ACL, a refused index. The text is on the
       * Pod in both, and keying this on "the save reported no failure" would
       * leave a stale draft behind in exactly the two cases the owner is already
       * being asked to do something about. When step 1 itself failed the draft
       * is kept, because then the form and this copy are the only ones there
       * are: §10's 412 tells the owner to reload, and the draft is what survives
       * the reload.
       *
       * `text` is this render's snapshot of the sixteen fields — the same values
       * the entry above was assembled from, because `save()` is synchronous up
       * to the await — so it is what reached the Pod. `settleDraft` compares it
       * with what is on the form now and keeps the difference.
       *
       * THE ORDER OF THESE THREE LINES IS COSMETIC RATHER THAN LOAD-BEARING:
       * `settleDraft` clears `scope` as this render closed over it, so
       * `setTarget` cannot move the key out from under it whichever way round
       * they go. It reads as though it could, which is the only reason it is
       * written this way round.
       */
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
