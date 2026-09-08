"use client";

/**
 * The studio's entry editor: one form, and the §10 write sequence behind it.
 *
 * WHAT IT IS NOT ALLOWED TO DO, the same two rules the shell is held to and for
 * the same reasons:
 *
 *   1. It imports NO VALUE from @inrupt/solid-client-authn-browser. The session
 *      arrives as a prop, so every behaviour here is testable against a plain
 *      object, and the library stays inside the `ssr: false` boundary that
 *      components/studio/studio-client/studio-client.tsx draws.
 *   2. It reads NO config and NO env var. OWNER_WEBID, SITE_URL, SITE_NAME and
 *      POD_ROOT are not `NEXT_PUBLIC_`, so `lib/config.ts` throws the moment it
 *      is reached in a browser. The trips it can write into arrive as props;
 *      the owner's WebID comes off the session.
 *
 * THE WRITE ITSELF LIVES IN `lib/pod/save-entry.ts`. This file assembles an
 * `Entry`, picks the precondition, and turns the `{ completed, failed,
 * recovery }` report into something a human can act on. It reimplements none of
 * the sequence — in particular it never PUTs anything itself, so every write it
 * causes carries a precondition (§10).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COORDINATE CONTROLS, AND THE ORDER OF EVENTS THAT MAKES THEM SAFE.
 *
 * §9: "the studio applies fuzzing before the write and discards the precise
 * original", because "resources are publicly readable … anyone can fetch the
 * raw triple". So the fuzz happens HERE, before the `Entry` below is built —
 * `saveEntry` never sees a precise coordinate, and nothing downstream could
 * catch one if it did, because by then the precise value exists only in this
 * component's state and in the input the owner is looking at.
 *
 * Until 2026-09-06 this file had no coordinate input at all and said so at
 * length: fuzzing did not exist under lib/, so a latitude field would have put
 * a true coordinate on a world-readable resource — a privacy invariant broken
 * rather than a feature missing, and unfixable after the fact. `lib/pod/fuzz.ts`
 * and `readPrivacySettings` now exist, and this is their caller.
 *
 * FOUR RULES, EACH OF WHICH IS A DIFFERENT WAY TO LEAK:
 *
 *   1. What reaches `place.geo` is the `FuzzResult`, never the form state.
 *   2. A `drop` means NO `geo` AT ALL — not a coarser one. §9 step 2 explains
 *      why at length: a hundred entries "fuzzed to 2 km" resolve to one cell
 *      whose centroid is the house, and each new entry sharpens it. The place
 *      name survives; it is the geometry that is absent, not the entry.
 *   3. It FAILS CLOSED. Settings that are absent, unreadable or schema-invalid
 *      leave the three controls dead with the reason on screen and associated,
 *      rather than live and refused at save time — `sameWebId`'s posture. Valid
 *      settings with NO home region are a different fact and stay live: §7.6
 *      calls that "I have no home to protect", and reading it as a failure
 *      would silently strip the pin from every entry of everyone who never set
 *      one.
 *   4. AN UNTOUCHED COORDINATE IS NOT RE-FUZZED. A stored pair was already
 *      snapped when it was written, and it is not necessarily on today's grid —
 *      `snapToPrecision(35.6938, 139.7034, 500)` is 35.69423/139.70348, not the
 *      §7.3 fixture's own pair — so re-snapping on every save walks the pin.
 *      Leave both boxes empty and the place travels through untouched, exactly
 *      as `created` and `datePublished` do.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PHOTOS, AND WHY THE PICK IS THE UPLOAD.
 *
 * Until 2026-09-06 this file said photos were phase 3 because they need the
 * resize/EXIF pipeline. That pipeline now exists — lib/media/pipeline.ts for
 * the bytes, lib/media/upload.ts for the two PUTs — so the reason is gone and
 * the comment with it. What replaces it is the ordering decision, which is the
 * part that is easy to undo by accident:
 *
 *   A PICKED FILE IS PROCESSED AND UPLOADED IMMEDIATELY, and this component
 *   then holds URLs and JSON — a `Photo` — rather than a `File` or a `Blob`.
 *   Holding the file until Save is the obvious spelling and it breaks the
 *   autosave: `localStorage` takes strings, a Blob serialises to `{}` without
 *   throwing, and the draft would report success while restoring a photo with
 *   no URL on it. The derivatives are content-addressed (§7.3), so a re-pick of
 *   the same photo is a 412 read as reuse rather than a second copy.
 *
 *   ONLY `ready` SLOTS ARE SAVED. A file the pipeline refused is announced and
 *   left out — of the entry, and of the draft. An optimistic slot carrying a
 *   local `blob:` preview into the entry would write a photo that 404s for
 *   every reader, on a resource that reports itself saved.
 *
 *   AN EXISTING ENTRY'S PHOTOS ARE CARRIED, NEVER REPLACED. Picking a photo
 *   appends; picking none leaves `existing.photos` exactly as it arrived, the
 *   same rule the place, `created` and `datePublished` follow. The binaries
 *   have no other reference, so dropping the triple orphans the bytes.
 *
 * A PHOTO'S EXIF `DateTimeOriginal` IS STILL NOT WIRED TO THE PHOTO'S OWN
 * `schema:dateCreated`, AND AS OF 2026-09-07 IT DOES REACH THE ENTRY'S
 * TIMESTAMP — THROUGH THE FORM, exactly as the GPS below does. §6 requires a UTC
 * offset on every `xsd:dateTime`, and lib/media/exif.ts yields an offset-less
 * wall clock — EXIF has no zone and `OffsetTimeOriginal` is usually absent
 * (§11.5) — so inventing this machine's offset for a photo taken elsewhere
 * would stamp the wrong instant onto a permanent record. That argument still
 * forbids the direct write, and an existing `dateCreated` is carried through
 * untouched. What it never forbade is the pair of CONTROLS: the wall clock
 * lands in "When it happened", the half EXIF does not carry is the offset
 * select beside it, and the owner is TOLD when that half is only this machine's
 * guess instead of reading `21:38 +02:00` in which both halves look like data
 * (§11.5: "worse than not auto-dating at all, because it looks right"). See
 * `offerTimestamp`, `TimeAuthor` and `OFFSET_GUESS_ID`.
 *
 * A PHOTO'S GPS *IS* WIRED, AS OF 2026-09-07, AND IT IS WIRED TO THE FORM.
 * This paragraph used to end "neither wire is stage 1's", which was true of
 * stage 1 and is now false of the coordinate half: `derived.metadata.gps`
 * fills the two coordinate boxes when nothing else has (§11.3), and it fills
 * NOTHING ELSE.
 *
 *   IT FEEDS THE FORM, NEVER THE WRITE PATH, and that is the whole of the
 *   privacy argument. A photo's GPS arrives looking authoritative — it is a
 *   real reading, from a real receiver — and the tempting spelling puts it on
 *   `place.geo` directly, which publishes the exact spot a picture was taken.
 *   Landing it in the inputs instead means it reaches the Pod by the ONE route
 *   a typed coordinate does: `fuzzed()` at save time, §9 steps 1–4, snapped or
 *   dropped. There is no second path, and §9's guarantee is that there is not.
 *
 *   FIRST WRITER WINS, IN EVERY DIRECTION (§11.3, and ruling T3-B for the last
 *   of them). Auto-fill only ever writes into a coordinate nobody has supplied:
 *   not one the owner typed, not one an earlier photo offered, and not one the
 *   entry being edited already has — an edit's boxes are empty by design, and
 *   what they mean when empty is "the pair on the Pod stands". See
 *   `coordinateAuthor`.
 *
 *   AND IT ASKS THE SAME GATE EVERY OTHER COORDINATE WRITER ASKS. Settings that
 *   cannot be read leave the three controls dead (§9's fail-closed posture), and
 *   a photo does not get past that either — `offerCoordinate`.
 *
 *   AND IT SAYS SO ON SCREEN. A value that appeared without being typed has to
 *   name where it came from, or the owner cannot tell it from something they
 *   did yesterday — `COORDINATE_SOURCE_ID`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PLAIN CONTROLS ON PURPOSE. TODO.md keeps layout deliberately unstyled until
 * phase 7, and native `<select>`, `<input>` and `<textarea>` need no Radix on a
 * screen of sixteen controls. Every one of them has a real `<label>`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPipeline } from "@/lib/media/pipeline";
import { uploadPhoto } from "@/lib/media/upload";
import { documentUrlOf } from "@/lib/pod/entry-model";
import { describe } from "@/lib/pod/result";
import { saveEntry } from "@/lib/pod/save-entry";
import { placeFor, placeTextOf } from "@/lib/studio/place/place";
import { revalidatePublicSite } from "@/lib/studio/revalidate";
import { OFFSETS, nowWithOffset, offsetMinutes, toOffsetDateTime } from "@/lib/studio/time/offsets";
import { SCHEMA_VERSION } from "@/lib/vocab";
import { BUTTON } from "./field";
import { draftTextOf, useEntryDraft } from "./hooks/use-entry-draft";
import { useEntryForm } from "./hooks/use-entry-form";
import { useSettingsGate } from "./hooks/use-settings-gate";
import IdentityFields from "./fields/identity-fields";
import WhenFields from "./fields/when-fields";
import WhereFields from "./fields/where-fields";
import PhotoFields from "./fields/photo-fields";
import ClassificationFields from "./fields/classification-fields";
import type { Pipeline, PipelineResult } from "@/lib/media/pipeline";
import type { Entry, Photo, Status as EntryStatus } from "@/lib/pod/schema";
import type { SaveEntryReport } from "@/lib/pod/save-entry";
import type { Precondition } from "@/lib/pod/write";
import type { PhotoSlot } from "./state/actions";
import type { Draft, StorageLike } from "@/lib/studio/drafts";
import type { StudioSessionLike } from "@/lib/studio/session";

/* ═══════════════════════════════════════════════════════════════════ props ══ */

/** One trip the owner may write into, resolved by whoever knows where the Pod
 *  is. The container and index URLs are passed rather than derived here: this
 *  component reads no config, and §4's layout is the read layer's to know. */
export interface EditorTrip {
  /** `<…/trip.ttl#it>` — what `dy:trip` points at. */
  iri: string;
  slug: string;
  /** What the owner picks from the list. */
  name: string;
  /** `<…/entries.ttl>`, the trip's index resource (§7.4). */
  indexUrl: string;
  /** `<…/entries/>`, where the entry resource goes. */
  entriesContainer: string;
  /**
   * `dy:status` of the TRIP — not of the entry, which is the control below.
   *
   * Optional because a caller that knows only where a trip is can still offer
   * it, and because the whole point of the marker is to say something extra
   * about a draft rather than to withhold a trip nobody labelled.
   *
   * It is rendered, and that is why it is here. `listStudioTrips` carries it
   * for one stated reason — "a picker that shows a draft trip and a published
   * trip identically invites the one mistake that cannot be undone from the
   * editor: writing a PUBLISHED entry into a DRAFT trip yields a public entry
   * whose trip is not public". The marker is what makes that visible before the
   * click rather than after it.
   */
  status?: EntryStatus;
}

export interface EntryEditorProps {
  /** Injected, never constructed here. Its `fetch` is the only authenticated
   *  one in the browser, and every Pod request below goes through it. */
  session: StudioSessionLike;
  trips: EditorTrip[];
  /**
   * `/travel/settings/privacy.ttl` (§7.6), resolved by whoever knows where the
   * Pod is — `privacySettingsUrl(podRoot)` in lib/pod/read.ts. It joins
   * `indexUrl` and `entriesContainer` as a URL this component is GIVEN, because
   * this component reads no config: `POD_ROOT` is not `NEXT_PUBLIC_` and
   * `lib/config.ts` throws the moment it is reached in a browser.
   *
   * **REQUIRED, AND THAT IS THE POINT.** Optional would mean a shell that
   * forgot to pass it produced an editor that failed closed for ever — no error
   * anywhere, no test red anywhere, coordinates simply never published, which
   * is indistinguishable from a Pod with no `privacy.ttl` on it. Nothing
   * renders a wire nobody passed, so tsc is the only check that covers this
   * one.
   *
   * A URL rather than the parsed settings, because THE READ FAILING IS THE CASE
   * THAT MATTERS (§9's fail-closed rule) and only a URL can 404. It is read
   * over the session's own fetch: the resource is owner-only, so an anonymous
   * GET is a 401 on a real Pod — and on ESS a 401 does not even distinguish
   * private from missing (§13).
   */
  settingsUrl: string;
  /**
   * The Pod's storage root, which is where `travel/media/` hangs (§4: media is
   * ONE global container, outside any trip, so publishing never has to move
   * binaries or rewrite references).
   *
   * REQUIRED, AND A PROP, for exactly the reasons `settingsUrl` above is both.
   * `POD_ROOT` is not `NEXT_PUBLIC_` and `lib/config.ts` throws the moment it is
   * reached in a browser, so the shell — which already holds it, since
   * `settingsUrl` is derived from it — passes it down. Optional would mean a
   * shell that forgot it uploads photos to a path built from `undefined`, and
   * nothing renders a wire nobody passed, so tsc is the only check that covers
   * the omission.
   */
  podRoot: string;
  /**
   * The resize/EXIF pipeline, injected so that a test can supply output it
   * knows byte for byte. `undefined` is what ships: one is created lazily on
   * the first pick, because a worker at mount is a thread and a chunk spent on
   * the majority of edits, which touch no photo at all.
   *
   * OWNERSHIP FOLLOWS CREATION, AND THAT IS THE WHOLE POINT OF THE SEAM. An
   * injected pipeline is disposed by whoever injected it; the unmount cleanup
   * below only ever disposes one this component created. `dispose()` is not a
   * cancel — it terminates the worker and rejects everything pending — so
   * disposing a caller's instance would break a photo it was still processing.
   */
  pipeline?: Pipeline;
  /**
   * Absent means CREATE. Present means EDIT, and `etag` is the one from THE
   * READ THAT PRODUCED THIS STATE (§10) — `null` when the server sent none,
   * which is a state this editor refuses to save over rather than papering
   * over with a blind PUT.
   */
  initial?: { entry: Entry; etag: string | null };
  /**
   * Where in-progress text is kept between visits. Defaults to the browser's
   * own `localStorage`, which is what actually ships.
   *
   * Injected rather than reached for so that the failure that matters can be
   * scripted: Safari in private mode reports a zero quota and throws on the
   * first `setItem`, and no browser global can be made to do that on demand.
   */
  storage?: StorageLike;
}

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
/* ═══════════════════════════════════════════════════════════════ the photos ══ */

/**
 * The photos the entry will carry: the ones it arrived with, then the ones
 * picked in this editor, in the order they were picked.
 *
 * PICKING APPENDS; IT NEVER REPLACES. An edit that rewrites the resource
 * without the photos it arrived with destroys them silently — and for photos it
 * destroys the binaries' only reference too, since nothing else on the Pod
 * points at `travel/media/<hash>/`. Pick nothing and `carried` travels through
 * exactly as it arrived, which is the treatment `created`, `datePublished` and
 * the place already get.
 *
 * ONCE EACH, HOWEVER MANY TIMES IT IS PICKED. The media path is
 * content-addressed, so re-picking a photo the entry already carries uploads
 * nothing new — `putGuarded` answers 412 and `uploadPhoto` reads that as reuse —
 * and returns the SAME `contentUrl`. Appending it blindly would write two
 * `#photo-N` fragments pointing at one binary: the same picture twice on the
 * public listing, and, with no removal control in this editor, nothing the owner
 * can do about it except abandon the edit. The `Set` covers both ways in, since
 * the same file picked twice in one session is the same defect on a create,
 * where there is nothing carried to compare against.
 *
 * `sortOrder` IS THE POSITION AT SAVE TIME, NOT AT PICK TIME, so a file the
 * pipeline refused leaves no gap in the sequence — and the CARRIED photos keep
 * the numbers they were stored with, because renumbering them would rewrite
 * §7.3 data the owner never touched.
 *
 * WHICH NUMBER IS FREE IS NOT `carried.length`, AND THAT IS MEASURED RATHER
 * THAN ARGUED. lib/pod/entry-model.ts writes `photo.sortOrder ?? i + 1` — a
 * carried photo with no number of its own is serialised with its ONE-BASED
 * POSITION, not left unwritten — so a list of one unnumbered photo is written as
 * `dy:sortOrder 1`, and `carried.length` is 1: the collision, in the very case
 * the fallback exists for. So the seed is what the serialiser will actually
 * write, and the sequence is one-based like every other `dy:sortOrder` in §7.3
 * (`#photo-1` carries 1). The `0` seed is what makes a first photo on a create
 * come out as 1 rather than 0.
 */
function photosFor(carried: readonly Photo[], attached: readonly Photo[]): Photo[] {
  const already = new Set(carried.map((photo) => photo.contentUrl));
  const fresh: Photo[] = [];
  for (const photo of attached) {
    if (already.has(photo.contentUrl)) continue;
    already.add(photo.contentUrl);
    fresh.push(photo);
  }

  const highest = carried.reduce((best, photo, at) => Math.max(best, photo.sortOrder ?? at + 1), 0);
  return [...carried, ...fresh.map((photo, at) => ({ ...photo, sortOrder: highest + 1 + at }))];
}

/* ══════════════════════════════════════════════════ what the owner is told ══ */

/**
 * The result of a save, in the two roles that ANNOUNCE it: `status` for news,
 * `alert` for something needing a decision. Text dropped into a plain <div> is
 * text a screen-reader user never hears, and the result of a save arrives long
 * after focus has moved on.
 */
type Announcement = { tone: "ok" | "problem"; text: string; detail?: string };

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
function announce(report: SaveEntryReport, status: EntryStatus): Announcement {
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
type Target = { url: string; etag: string | null };

/**
 * The precondition for the next write, or `null` when there is none to be had.
 *
 * `If-None-Match: *` creates; `If-Match: <etag>` updates. There is no third
 * option, and both wrong answers here are silent: reusing `{ create: true }`
 * after a create is a guaranteed 412 on a resource this editor just wrote, and
 * reusing the ETag from before the last write is a 412 the owner cannot act on
 * because the retry they try next fails identically. A blind PUT is a bug (§10).
 */
function preconditionFor(target: Target | null): Precondition | null {
  if (target === null) return { create: true };
  return target.etag === null ? null : { etag: target.etag };
}

/**
 * `2026-04-02T19:00:00+09:00` → `2026-04-02 at 19:00`.
 *
 * The wall clock AS IT WAS STAMPED, never shifted into whatever zone the browser
 * is in now — the same rule `wallClockOf` follows and for the same reason. The
 * machine-readable instant is on the `<time dateTime>` beside it, offset and
 * all, which is what the offset requirement on `savedAt` exists for.
 *
 * TAKES A `string`, NOT `string | undefined`, AND STAYS THAT WAY (task 2.5):
 * `lib/studio/drafts.ts`'s `Draft.savedAt` became `.optional()`, but this
 * function's one caller only reaches it inside an `offered.savedAt !==
 * undefined` check (ruling 2.5-A, below), so the absent case never arrives
 * here at all rather than arriving and being handled.
 */
const savedAtText = (savedAt: string) => `${savedAt.slice(0, 10)} at ${savedAt.slice(11, 16)}`;

/**
 * THE ONE END OF THE ASSOCIATION BETWEEN THE HELD SAVE BUTTON AND THE SENTENCE
 * THAT EXPLAINS THE HOLD, spelled once because both ends have to agree and
 * neither of them says so when they stop agreeing.
 *
 * An `aria-describedby` naming an id nothing renders computes to the empty
 * string — no error, no warning, nothing on screen different, and a screen
 * reader back to announcing "Save entry, button, unavailable" and no reason.
 * That is the silent way this breaks, so the id is a constant rather than two
 * string literals thirty lines apart.
 */
const HOLD_REASON_ID = "entry-draft-hold";

/* ════════════════════════════════════════════════════════════════ the form ══ */

/* eslint-disable-next-line max-lines-per-function --
   941 lines against a 200 bound. Stage B decomposes this into hooks, a reducer and
   field groups; see docs/superpowers/specs/2026-09-08-code-structure-conventions-design.md §5.
   Remove this line with the last field group. */
export default function EntryEditor({
  session,
  trips,
  settingsUrl,
  podRoot,
  pipeline,
  initial,
  storage,
}: EntryEditorProps) {
  const existing = initial?.entry;

  /**
   * THE TWENTY VALUES THE FORM IS, as one reducer, and the transitions that
   * may change them. Every seeding decision that used to be a `useState`
   * initialiser is now in `initialEntryFormState`, verbatim, and the three
   * credits that used to be a ref-and-state pair are fields of the same value:
   * ./state/notes.md#guard-inside-the-transition
   *
   * DESTRUCTURED, so that `save()`, the draft text and the effects below read
   * exactly as they did. The names are `Draft`'s (spec §5).
   */
  const form = useEntryForm({ existing, tripIris: trips.map((choice) => choice.iri) });
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
    precision,
    placeName,
    locality,
    country,
    slots,
    offsetGuess,
  } = form.values;
  /** Slot identity, monotonic per editor. Not the file name, and not an index:
   *  see `PhotoSlot`. */
  const nextSlotKey = useRef(0);

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
  /* ─────────────────────────────────────────────── §7.6, read on mount ─── */

  /** WHAT §7.6 DECIDED, and everything downstream of it, read on mount:
   *  ./hooks/notes.md#the-gate-is-read-on-mount-and-never-again. `form.set` is
   *  memoised with `[]`, which is what keeps `onDefaultPrecision` out of the
   *  read effect's dependency loop — same file, #why-the-seed-is-built-outside-the-render-callback */
  const gate = useSettingsGate({
    settingsUrl,
    session,
    precision,
    onDefaultPrecision: form.set.precision,
  });

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
    all.add(offset);
    return [...all].sort((a, b) => offsetMinutes(a) - offsetMinutes(b));
  }, [offset]);
  const trip = trips.find((t) => t.iri === tripIri);
  /** The address is fixed once the resource exists: this editor writes, and
   *  moving a resource is a copy and a delete it does not do. */
  const addressFixed = target !== null;

  /**
   * The picked photos that have URLs on the Pod, in pick order.
   *
   * `ready` ONLY. This is what the draft keeps and what the save carries, so
   * the filter is the fence: a decoding slot has no `Photo` at all and a failed
   * one must not reach either, or the entry references a photo that 404s for
   * every reader.
   */
  const attached = useMemo(
    () => slots.flatMap((slot) => (slot.state === "ready" ? [slot.photo] : [])),
    [slots],
  );

  /* ────────────────────────────────────────────────────── the local draft ── */

  /** The sixteen fields the FORM holds, projected out of the reducer's twenty.
   *  ONE construction, spent by both the draft and the save: two of them is how
   *  `settleDraft`'s two answers drift. */
  const text = draftTextOf(form.values, attached);
  /** What the browser kept, the debounce that keeps it, and the settle that
   *  stops it being a trap. `entryUrl` is `target`'s, which is the thing that
   *  moves: ./hooks/notes.md#the-scope-follows-the-target-and-that-was-once-argued-backwards */
  const { offered, storageRefused, markTouched, settleDraft, discard, clearOffer } = useEntryDraft({
    storage,
    webId: session.info.webId,
    entryUrl: target?.url,
    text,
  });

  /* ─────────────────────────────────────────────────── the photo pipeline ── */

  /**
   * THE ONE THIS COMPONENT CREATED, AND NOTHING ELSE EVER GOES IN HERE.
   *
   * That is what makes the cleanup below safe. `Pipeline.dispose()` is not a
   * cancel: it terminates the worker and rejects everything already pending, so
   * calling it on an instance a caller injected would break a photo that caller
   * is still processing. Whoever creates, disposes — so an injected `pipeline`
   * is returned as it is and never stored here.
   */
  const ownPipeline = useRef<Pipeline | null>(null);

  /** Lazily, on the first pick. A worker at mount costs a thread and a chunk on
   *  every edit, and most edits touch no photo at all. */
  function pipelineFor(): Pipeline {
    if (pipeline !== undefined) return pipeline;
    if (ownPipeline.current === null) ownPipeline.current = createPipeline();
    return ownPipeline.current;
  }

  useEffect(() => {
    /**
     * DISPOSAL, NOT TIDINESS: the worker holds a decoded bitmap, which for a
     * 50 MP photo is on the order of 200 MB, and an editor closed mid-decode
     * would otherwise leak it for the life of the tab.
     *
     * UNMOUNT IS THE ONLY CORRECT CALLER TODAY, and `Pipeline.dispose()`'s own
     * docblock says why: a photo queued but not yet pending is not in the map
     * to reject, so its send still runs, re-spawns a worker, and can resolve
     * after this returns. Harmless here — the component is going away — and a
     * defect anywhere else. A cancel button needs a generation counter first.
     *
     * `ownPipeline.current` is null under StrictMode's first cleanup unless a
     * photo was picked between the two effect invocations, so the double-invoke
     * is a no-op rather than a disposed pipeline the second mount inherits.
     */
    return () => {
      ownPipeline.current?.dispose();
      ownPipeline.current = null;
    };
  }, []);

  /**
   * §11.3's OFFER, AND THE TWO GUARDS THAT ARE NOT THE TRANSITION'S. Its whole
   * argument — the form and not `place.geo`, at full precision, and why the
   * refusal is one record for the pair — is `applyPhotoCoordinate`'s, in
   * `./state/apply-photo-offer.ts`. What is left here is the §9 gate, which
   * reads state this reducer does not hold, and the tag's own absence.
   *
   * `gps` IS OPTIONAL AND THE GUARD IS NOT DECORATION. `readMetadata` returns
   * `{}` for a file it cannot read at all — screenshots, scans, location
   * services off — which is the case this meets most often. The obvious
   * `setLat(String(metadata.gps?.lat))` writes the string "undefined" into a
   * `type="number"` box, which a browser then shows as empty: a coordinate
   * silently cleared by attaching a scan.
   */
  function offerCoordinate(name: string, metadata: PipelineResult["metadata"]) {
    /**
     * §9 FAILS CLOSED, AND A PHOTO IS NOT AN EXCEPTION TO IT. This is the same
     * gate the two boxes wear as `disabled={!coordinatesLive}`, asked by the
     * one writer that does not arrive as a keystroke.
     *
     * WITHOUT IT THE EDITOR CONTRADICTS ITSELF IN ONE ACCESSIBLE DESCRIPTION.
     * The controls are dead and already say "This entry will be saved without a
     * map pin: your privacy settings could not be read", and the note would
     * compose a second sentence into that same description telling the owner to
     * type in a box the browser will not let them type in.
     *
     * AND IT IS A MECHANISM, NOT ONLY A CONTRADICTION. `fuzzed()` returns
     * `undefined` for any gate that is not `ready`, and `placeFor` reads
     * `undefined` as a REMOVAL — so on an EDIT this fill would delete the
     * entry's stored `#geo` by the fail-closed branch, which was harmless
     * before the picker existed only because these boxes could not become
     * non-empty. That is the sort of safety that stops being safety without
     * anything changing where it was written.
     *
     * THE GATE IS READ FROM THE RENDER THAT STARTED THE PICK, and unlike
     * `coordinateAuthor` that needs no ref: `gate` goes `checking` → `ready` or
     * `closed` exactly once, on mount, and never back. So a stale read can only
     * be `checking` where the truth is now `ready` — a refusal where a fill was
     * permissible, which is the direction §9 says to err in.
     */
    if (!gate.coordinatesLive) return;

    const gps = metadata.gps;
    if (gps === undefined) return;
    /* AT FULL PRECISION AND AS A STRING, for the docblock's reason: a value
       rounded on the way IN is a snap the owner did not choose. The refusal
       itself is `applyPhotoCoordinate`'s, not this function's. */
    form.offerCoordinate(name, String(gps.lat), String(gps.long));
    /* A FILL IS A CHANGE TO THE FORM, and every change arms the autosave —
       unconditionally now, because whether anything filled is the
       transition's answer and not this caller's:
       ./state/notes.md#what-stayed-outside-the-reducer-and-why */
    markTouched();
  }

  /**
   * §11.5's offer, made twice, and BOTH OF ITS REFUSALS ARE THE TRANSITION'S.
   * `applyPhotoTimestamp` carries the whole argument — first writer wins per
   * half, the cross-half guard on `key` and not on `name`, and the two ways an
   * offset can be shape-valid and impossible. This function reads the two tags
   * and says who is offering them.
   */
  function offerTimestamp(key: string, name: string, metadata: PipelineResult["metadata"]) {
    form.offerTimestamp({
      key,
      name,
      wall: metadata.dateTimeOriginal,
      offset: metadata.offsetTimeOriginal,
    });
    /* Armed unconditionally, for the reason `offerCoordinate` gives: whether a
       half filled is no longer knowable here. */
    markTouched();
  }

  /**
   * PROCESS, UPLOAD, THEN HOLD A `Photo` — never the `File`.
   *
   * The order is the decision recorded at the top of this file: by the time
   * this resolves the bytes are on the Pod and this component holds URLs and
   * JSON, which is what keeps the autosaved draft restorable. The source
   * ArrayBuffer is read here rather than in the worker because the container
   * path is `sha256(ORIGINAL)[0..16]` — the derivative's hash would defeat the
   * re-pick idempotence that makes a retry free.
   *
   * NOTHING THROWS OUT OF HERE. `uploadPhoto` reports its failures as a
   * `Result`, but the pipeline REJECTS (that is `createPipeline`'s contract),
   * and an unhandled rejection would leave a slot decoding for ever with
   * nothing on screen saying why.
   */
  async function attach(file: File) {
    const key = `photo-${nextSlotKey.current++}`;
    const name = file.name;
    const move = (next: PhotoSlot) => {
      /**
       * A SETTLE IS A CHANGE TO THE FORM, AND HAS TO ARM THE AUTOSAVE LIKE ANY
       * OTHER ONE.
       *
       * The pick itself already set `touched` — the file input's `change` event
       * bubbles to the `<form>` handler below — but a save can land between the
       * pick and the settle and put it back to `false`. `settleDraft` does that
       * legitimately: at the moment it runs, the Pod holds exactly what the form
       * holds, because a slot still `decoding` contributes nothing to `attached`
       * and `sameText` is therefore true.
       *
       * Then the photo settles. `attached` gains a `Photo`, the autosave effect
       * re-runs — and returns at `if (!touched.current)` having armed nothing.
       * The row says "is attached to this entry" and the binaries really are on
       * the Pod, but the entry resource does not reference them and nothing is
       * in `localStorage` either. Close the tab and the photo is orphaned and
       * silently absent, with no surface anywhere that says so.
       *
       * Reachable by ordinary use, not by a race that needs help: Save is only
       * `disabled={saving}`, so picking a photo, typing the headline and
       * pressing Save before the decode finishes is a sequence the UI invites.
       *
       * `ready` ONLY. `uploading` and `failed` leave `attached` unchanged, so
       * there is nothing new to back up and arming on them would re-open the
       * window over text the Pod already has. The narrower race — a settle
       * DURING the round trip — is handled by `live.current.text` and
       * `samePhotos` inside `save()`, and is not this.
       */
      if (next.state === "ready") markTouched();
      form.settleSlot(key, next);
    };

    form.addSlot({ key, name, state: "decoding" });
    try {
      const source = await file.arrayBuffer();
      const derived = await pipelineFor().process(file);
      move({ key, name, state: "uploading" });
      const stored = await uploadPhoto({
        // The visitor's own authenticated fetch, never the ambient one
        // (invariant 4): a media PUT is a write, and anonymously it is a 401.
        fetch: session.fetch,
        podRoot,
        // The ORIGINAL bytes, hashed for the path and never uploaded — the
        // derivatives are what go up, and the re-encode is what strips the EXIF.
        source,
        derivatives: { web: derived.web, thumb: derived.thumb },
        blurDataUrl: derived.blurDataUrl,
        // `derived.metadata` is not uploaded, and that is what stripping means:
        // the derivatives are re-encoded without it. Its GPS and its two time
        // tags are READ below, into the form and nowhere else: `DateTimeOriginal`
        // has no UTC offset and §6 requires one, so the offset comes from the
        // control beside the clock — the photo's own when it carried one, and
        // otherwise a guess the owner is told about (`offerTimestamp`).
      });
      if (!stored.ok) {
        move({ key, name, state: "failed", message: describe(stored.error) });
        return;
      }
      move({ key, name, state: "ready", photo: stored.value });
      /**
       * ON `ready`, AND NOT A LINE EARLIER. The metadata has been in hand since
       * the decode, so filling from it before the upload is spelled in one line
       * fewer — and it offers the owner a coordinate for a photo that is about
       * to fail its PUT and be announced as not attached. A coordinate from a
       * photo that is not on the entry has nothing on screen to explain it,
       * and its note names a file the form no longer holds.
       */
      offerCoordinate(name, derived.metadata);
      /* THE TWO OFFERS ARE INDEPENDENT AND BOTH ARE MADE, in either order: a
         photo may carry GPS and no clock, a clock and no GPS, both or neither
         (lib/media/exif.ts reads them from different IFDs and guards each
         separately), and neither half may stand in for the other or clear it.

         THE `key` GOES IN BESIDE THE NAME because that is photo identity here
         and the name is not — see `TimeAuthor`. `offerCoordinate` takes the
         name alone on purpose: it displays it and never compares it. */
      offerTimestamp(key, name, derived.metadata);
    } catch (cause) {
      move({
        key,
        name,
        state: "failed",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  /** Every file from one pick, all started at once — the picker is `multiple`
   *  and lib/media/pipeline.ts serialises the decodes. */
  const attachAll = (picked: readonly File[]) => {
    for (const file of picked) void attach(file);
  };

  /**
   * The owner accepting the draft. It fills the fields that are TEXT and stops
   * there: `target`, `provenance` and the ETag are untouched, because a restored
   * draft must not resurrect a precondition. What conditions the next write is
   * still the ETag from the read that produced this state (§10).
   */
  function restore(draft: Draft) {
    /* THIRTEEN SETTERS AND A CREDIT CALL, AS ONE ACTION. Their whole argument
       travelled to `applyRestore`, and the ordering hazard that made this the
       reducer's first justification travelled with it (spec §5). What the
       transition cannot read, it is given: */
    form.restore(draft, {
      addressFixed,
      tripIris: trips.map((choice) => choice.iri),
      presetPrecision: gate.presetPrecision,
    });
    // Restored once. Leaving the banner up invites a second click that would
    // overwrite whatever the owner typed after the first.
    clearOffer();
  }

  async function save() {
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
        ? gate.fuzzed({ lat: Number(lat), long: Number(long) })
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
      settleDraft(text, report.entryUrl);
      setTarget({ url: report.entryUrl, etag: report.etag ?? null });
      // What the Pod now holds, so the next save carries it rather than
      // dropping it. See the note on `provenance`.
      setProvenance({ created, datePublished });
    }
    setOutcome(announce(report, status));
  }

  return (
    <section className="mt-8 border-t border-hairline pt-6">
      <h2 className="text-xl">{initial === undefined ? "New entry" : "Edit entry"}</h2>

      {/*
        NAMED BY `title`, NOT BY `aria-label`, AND THAT IS LOAD-BEARING.

        The name has to say "draft" — that is what tells the owner what this is —
        and every ARIA naming mechanism puts the named element into
        @testing-library's `getByLabelText` results: it matches `aria-label` and
        `aria-labelledby` on ANY element, not only on form controls. This screen
        already has a control whose label matches the same words, the Status
        select, so an `aria-label` here makes `getByLabelText(/status|draft/)`
        ambiguous and every test that fills the form while the banner is up fails
        on "found multiple elements" rather than on anything real. Measured with
        a throwaway probe: `aria-label` yields two matches, `title` one.

        `role="region"` is explicit for the same probe's other half — a bare
        `<section>` named only by `title` is not given the region role, so it
        would be unfindable as the landmark it is. The name still resolves from
        `title` in the accessible-name computation, which is where a tooltip
        belongs in that algorithm.
      */}
      {offered !== null && (
        <section
          role="region"
          title="Unsaved draft"
          className="mt-4 border border-hairline bg-surface p-4"
        >
          {/*
            RULING 2.5-A (task 2.5): the banner still appears when `savedAt`
            is absent; only the `<time>` goes away. `lib/studio/drafts.ts`
            made the field `.optional()` for a payload written by another
            build or hand-edited in devtools — never one this editor wrote,
            since `nowWithOffset()` stamps every write site here — and such a
            payload must not crash the mount effect that offers it back.

            THE SPELLING CHOSEN: the whole ", from <time>…</time>" clause is
            conditional on `offered.savedAt !== undefined`, not just the
            `<time>` tag, so the sentence reads as a complete claim either
            way — "kept what you were writing here" rather than a comma
            trailing into nothing. An empty `<time>` was rejected: a `<time>`
            with no `dateTime` to point at is markup with nothing to say.
            An invented timestamp was rejected too: it would tell the owner a
            moment that never happened, which is worse than omitting the
            nicety this field is.
          */}
          <p>
            {"This browser kept what you were writing here"}
            {offered.savedAt !== undefined && (
              <>
                {", from "}
                <time dateTime={offered.savedAt}>{savedAtText(offered.savedAt)}</time>
              </>
            )}
            {". Nothing on this form has been changed."}
          </p>
          {/*
            THE HOLD, SAID OUT LOUD AND SAID HERE.

            The sentence above explains the DRAFT and stops there — it kept your
            text, the form is untouched — which accounts for the banner but not
            for the seventeen controls underneath it going dead. Someone who reads
            only that sentence has been told what happened and not what is now
            being withheld, and the fieldset does not announce itself.

            IT LIVES IN THE BANNER RATHER THAN NEXT TO THE BUTTON, and the
            difference is not layout. The Save button names this element (see
            the note on the button), so what a screen reader reads out as the
            reason is this text and not a paraphrase of it: a second copy parked
            beside the button is a text that drifts from the one it duplicates,
            and the copy nobody edits is the copy the owner hears. Keeping it
            inside also makes the hold explanation structural — it cannot
            outlive the offer, because it is rendered by the same condition.
          */}
          <p id={HOLD_REASON_ID} className="mt-2">
            {"Restore it or discard it to carry on: while it is waiting, the form below is " +
              "held and cannot be saved, so that one storage slot is not written by two hands."}
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" className={BUTTON} onClick={() => restore(offered)}>
              {"Restore"}
            </button>
            <button type="button" className={BUTTON} onClick={discard}>
              {"Discard"}
            </button>
          </div>
        </section>
      )}

      <form
        className="mt-4"
        /*
          ONE PLACE THAT MARKS THE FORM AS TOUCHED, rather than a line in each of
          sixteen handlers. React's `onChange` is delivered to ancestors, so this
          catches every control on the form including ones added later — and a
          field whose handler forgot the line would be a field whose typing is
          silently not backed up. `restore()` deliberately does NOT come through
          here: it sets state without a DOM event, and what it puts on the form
          is what storage already holds.
        */
        onChange={markTouched}
        onSubmit={(event) => {
          // Prevented, so jsdom and the browser both stay on this page and the
          // save is this component's to run.
          event.preventDefault();
          void save();
        }}
      >
        {/*
          HELD WHILE A DRAFT IS OFFERED — one storage slot, so only one of the
          two may hold the pen.

          THE LOSS IT PREVENTS. The banner and the autosave share a key. A draft
          survives a crash; the next day the owner opens the studio, sees the
          banner, decides to deal with it later and starts typing something
          else. 800ms later the autosave puts the near-empty new form at that
          key and the old text is gone from storage — `offered` still holds it
          in memory, so Restore works for as long as this tab lives, and a
          reload, a session expiry or a second crash loses the long entry
          `docs/decisions.md` §10 names as the reason this feature exists.
          Restore or Discard unlocks the form; the cost is one click.

          A `<fieldset disabled>`, NOT A GUARD IN `onChange` OR IN THE AUTOSAVE
          EFFECT, and the difference is what the owner is shown. A guard that
          refuses the CHANGE leaves them typing into a form that silently drops
          the keystroke, with nothing on screen saying anything is being
          withheld. A guard that refuses only the WRITE is worse in the other
          direction: the text appears and nothing is backing it up, which is the
          silent half of the same loss. The fieldset stops the keystroke where a
          browser stops it, and says so through the controls' own appearance and
          to a screen reader.

          THE SAVE BUTTON IS IN HERE TOO — the seventeenth control and the last
          one, held by the same attribute for the same reason. See the note on
          the button itself for the one click that closes. It said "the ninth"
          from the day the fieldset landed until 2026-09-07, by which point the
          picker, the three place fields and the UTC offset had made it wrong by
          eight: sixteen `Field`s are the fieldset's grid children now, and the
          button is what follows them.

          `grid gap-4` MOVED HERE FROM THE FORM, when there were eight fields
          and they were the form's direct grid children; a wrapper around them
          is otherwise the
          grid's only item, every field collapses into one cell and the gaps
          disappear. `display: contents` would have kept the form as the grid,
          and is declined: `fieldset` is the one element where browser support
          for it has historically differed, and a plain grid box behaves the
          same everywhere. `min-w-0` because a fieldset's UA
          `min-inline-size: min-content` is not among the things Tailwind's
          preflight resets (checked in node_modules/tailwindcss/preflight.css,
          which names no fieldset rule at all), and with `w-full` controls
          inside it that floor can stop the textarea shrinking.
        */}
        <fieldset disabled={offered !== null} className="grid min-w-0 gap-4">
          <IdentityFields
            trips={trips}
            tripIri={tripIri}
            onTripChange={form.set.tripIri}
            addressFixed={addressFixed}
            slug={slug}
            onSlugChange={form.set.slug}
            headline={headline}
            onHeadlineChange={form.set.headline}
            story={story}
            onStoryChange={form.set.story}
          />

          <WhenFields
            occurred={occurred}
            onOccurredChange={form.set.occurred}
            occurredSource={form.sources.occurred}
            offset={offset}
            onOffsetChange={form.set.offset}
            offsetOptions={offsetOptions}
            offsetGuess={offsetGuess}
            offsetSource={form.sources.offset}
          />

          <WhereFields
            placeName={placeName}
            onPlaceNameChange={form.set.placeName}
            locality={locality}
            onLocalityChange={form.set.locality}
            country={country}
            onCountryChange={form.set.country}
            lat={lat}
            onLatChange={form.set.lat}
            long={long}
            onLongChange={form.set.long}
            precision={precision}
            onPrecisionChange={form.set.precision}
            precisionOptions={gate.precisionOptions}
            coordinatesLive={gate.coordinatesLive}
            coordinateNote={gate.coordinateNote}
            settingsDetail={gate.settingsDetail}
            coordinateSource={form.sources.coordinate}
            hasStoredCoordinate={existing?.place?.geo !== undefined}
          />

          <PhotoFields slots={slots} onPicked={attachAll} />

          <ClassificationFields
            tagsText={tagsText}
            onTagsTextChange={form.set.tagsText}
            mode={mode}
            onModeChange={form.set.mode}
            status={status}
            onStatusChange={form.set.status}
          />

          {/*
            THE SEVENTEENTH CONTROL, HELD WITH THE OTHER SIXTEEN AND BY THE
            SAME ATTRIBUTE. It carries no margin of its own: the fieldset is the
            grid, so this row takes its gap from `gap-4` like every field above
            it, and the `mt-4` it wore while it stood outside would now be a
            second gap on top of that one. The wrapper `<div>` stays, bare —
            the grid stretches its items, so a button promoted to a direct child
            of the fieldset becomes a full-width bar.

            THE LOSS IT CLOSES, which is why it moved. The fields of the day shipped
            held and this button did not, and that left exactly one click
            between an unanswered banner and the text it was offering. On a
            CREATE the click is harmless — the form behind the banner is empty
            and `save()`'s pre-flight guard refuses it. On an EDIT it is not:
            the form is already full of the entry that was opened, so the save
            writes it as it stands, `settleDraft` clears the key, and the copy
            that survived the crash is deleted before the owner has read the
            sentence offering it. One unprompted click, nothing typed, no way
            back — the same loss the fieldset exists to prevent, reached by a
            shorter route.

            THE HOLD IS REAL RATHER THAN COSMETIC, AND THAT IS THE MEASUREMENT
            (jsdom 30.0.1, @testing-library/react 16.3.3, throwaway probe).
            Inside a `<fieldset disabled>` an <input> still takes
            `fireEvent.change` and a <button> still receives the click event —
            but jsdom refuses the button's ACTIVATION behaviour, because
            "actually disabled" walks up to the fieldset. The probe measured 0
            submissions held against 1 free. So from behind the banner this
            button dispatches no `submit` at all, which is what lets section 8e
            assert the consequence — nothing to the Pod, the draft still on
            disk — instead of an attribute. The same measurement once read as
            the reason the button could not live here: section 8c used to fill
            the held form with `fireEvent` and save, which only passed because
            `fireEvent` ignores disabled state. It now clicks Restore first,
            which is the path the owner actually has, and all six §10 scenarios
            still reach the Pod.

            `disabled={saving}` AND `aria-busy={saving}` STAY, AND THEY COMPOSE
            WITH THE FIELDSET RATHER THAN BEING REPLACED BY IT. Two different
            conditions on one control: the fieldset says "answer the banner
            first", `saving` says "this one is in flight". Respelling the hold
            as `disabled={offered !== null}` here would pass every assertion
            about the banner and re-open the double submit this button has been
            guarded against since it was written — 8g and the last test of 8e
            pin `saving` at the one moment it is true. `aria-busy` in particular
            keeps meaning `saving` and nothing else: a form waiting for a person
            to answer a banner is not busy, and the fieldset must not become the
            thing that reports busy-ness.
          */}
          <div>
            {/*
              THE REASON IS ON THE BUTTON, NOT ON THE FIELDSET THAT DOES THE
              HOLDING, AND IT MUST NOT BE TIDIED UPWARD. It reads as though it
              belongs there — one element holds seventeen controls, so one element
              should carry the reason once — and that spelling is heard by
              nobody. Measured (jsdom 30.0.1, dom-accessibility-api 0.5.16;
              it is the ARIA computation rather than a jsdom quirk):

                <fieldset disabled aria-describedby="reason"><button>   ""
                <fieldset disabled><button aria-describedby="reason">   "…"

              A `<legend>` names a group; nothing propagates a group's
              DESCRIPTION to its members. Moving this attribute up therefore
              deletes the explanation while leaving markup that reads as if it
              were still there — the accessibility-shaped version of a rule
              exercised at a path it does not cover.

              THIS BUTTON ALONE, not all seventeen. The banner sits directly
              above the sixteen fields and its own sentence is about them; Save
              is the one whose refusal has a consequence the owner will go
              looking for. And one reason attached to seventeen controls is that
              reason announced seventeen times to anyone reading the form
              linearly.

              CONDITIONAL, BOTH WAYS. With no offer the element it would name is
              not rendered, and a dangling IDREF computes to "" — so the honest
              spelling is no attribute at all. It would also be wrong if it did
              resolve: a description carried permanently is a hold announced on
              every encounter with the button, including the encounters where
              nothing is holding it.

              THE TEST DOES NOT CATCH THE UNCONDITIONAL SPELLING, and this
              comment is where that is written down. Measured: with
              `aria-describedby={HOLD_REASON_ID}` unconditional, 8e-bis still
              passes end to end, because with no offer the banner is not
              rendered, the IDREF dangles and the description computes to ""
              anyway. The allow-case is structural, exactly as that docblock
              says. The condition is kept because a live attribute pointing at
              nothing is a lie in the markup that the next reader has to
              disprove.

              `disabled={saving}` and `aria-busy={saving}` are a DIFFERENT
              condition and stay exactly as they are — see the block above.
            */}
            <button
              type="submit"
              disabled={saving}
              aria-busy={saving}
              aria-describedby={offered === null ? undefined : HOLD_REASON_ID}
              className={BUTTON}
            >
              {"Save entry"}
            </button>
          </div>
        </fieldset>
      </form>

      {/*
        `role="note"`, WHICH IS NEITHER `status` NOR `alert` AND MUST NOT BECOME
        ONE. Those two belong to the save, and a browser that will not keep a
        local copy has no bearing on the Pod at all: the entry saves exactly as
        it would otherwise. An assertive announcement would interrupt a screen
        reader mid-sentence to report something that changed nothing.

        It has to be said, though — quietly is not silently. The whole value of
        this feature is the belief that the text is safe, and a backup that is
        not happening while the owner believes it is is worse than no backup at
        all. Once it appears it stays; the attempts behind it continue.
      */}
      {storageRefused && (
        <p role="note" className="mt-6 text-sm text-muted-foreground">
          {"This browser is not keeping a local copy of what you type — private browsing, or " +
            "storage that is full or switched off. Saving to your Pod is unaffected, but " +
            "anything you have not saved will not survive closing this tab."}
        </p>
      )}

      {/*
        `status` for news, `alert` for something needing a decision: `alert` is
        assertive and interrupts a screen reader mid-sentence, which a save that
        worked has not earned.

        THE TECHNICAL DETAIL IS DELIBERATELY OUTSIDE THE ANNOUNCED REGION. It is
        the failure as `describe()` renders it — a URL and a status code — and
        an alert should carry the sentence a person can act on, not read out a
        Pod URL character by character. Keeping it out also keeps the six §10
        outcomes distinguishable BY THEIR WORDING: inside the region, a
        per-scenario URL would make any two identically worded outcomes look
        different to a test reading that region, which is exactly the
        distinction components/studio/entry-editor/entry-editor.test.tsx exists to hold. Measured, not
        supposed — with the detail inside, keying the message off `recovery`
        alone still passed that test.
      */}
      {outcome !== null &&
        (outcome.tone === "ok" ? (
          <p role="status" className="mt-6">
            {outcome.text}
          </p>
        ) : (
          <>
            <p role="alert" className="mt-6">
              {outcome.text}
            </p>
            {outcome.detail !== undefined && (
              <p className="mt-2 text-sm text-muted-foreground">{outcome.detail}</p>
            )}
          </>
        ))}
    </section>
  );
}
