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

import { useMemo } from "react";
import { BUTTON } from "./field";
import { draftTextOf, useEntryDraft } from "./hooks/use-entry-draft";
import { useEntryForm } from "./hooks/use-entry-form";
import { useEntrySave } from "./hooks/use-entry-save";
import { attachedOf, usePhotoPipeline } from "./hooks/use-photo-pipeline";
import { useSettingsGate } from "./hooks/use-settings-gate";
import IdentityFields from "./fields/identity-fields";
import WhenFields from "./fields/when-fields";
import WhereFields from "./fields/where-fields";
import PhotoFields from "./fields/photo-fields";
import ClassificationFields from "./fields/classification-fields";
import type { Pipeline } from "@/lib/media/pipeline";
import type { Entry, Status as EntryStatus } from "@/lib/pod/schema";
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

/**
 * Composition, and the page's own frame. 195 code lines against the 200 bound,
 * which is why the `eslint-disable max-lines-per-function` that stood here
 * until 2026-09-08 is gone: at 195 it is an UNUSED directive and
 * `--max-warnings 0` refuses the build for that. Its own removal condition —
 * "Remove this line with the last field group" — was wrong, and Task 5 proved
 * it: after all five groups this function was still 633 lines.
 * ./hooks/notes.md#what-the-195-are-and-what-they-are-not
 */
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
   * NOT DESTRUCTURED ANY MORE: ./hooks/notes.md#the-seventeen-names-came-back-together
   */
  const tripIris = trips.map((choice) => choice.iri);
  const form = useEntryForm({ existing, tripIris });
  const values = form.values;

  /** WHAT §7.6 DECIDED, and everything downstream of it, read on mount:
   *  ./hooks/notes.md#the-gate-is-read-on-mount-and-never-again. `form.set` is
   *  memoised with `[]`, which is what keeps `onDefaultPrecision` out of the
   *  read effect's dependency loop — same file, #why-the-seed-is-built-outside-the-render-callback */
  const gate = useSettingsGate({
    settingsUrl,
    session,
    precision: values.precision,
    onDefaultPrecision: form.set.precision,
  });

  /** The picked photos that have URLs on the Pod, in pick order — `ready` only,
   *  and that filter is the fence. See `attachedOf`. */
  const attached = useMemo(() => attachedOf(values.slots), [values.slots]);

  /** The sixteen fields the FORM holds, projected out of the reducer's twenty.
   *  ONE construction, spent by both the draft and the save: two of them is how
   *  `settleDraft`'s two answers drift. */
  const text = draftTextOf(form.values, attached);

  /* ────────────────────────────────────────────────────────── §10's save ── */

  /** The four steps, the six things they can leave to say, and the three values
   *  that make the next save an update. `settle` arrives at the submit handler:
   *  ./hooks/notes.md#the-save-and-the-draft-meet-at-the-submit-handler */
  const { target, addressFixed, outcome, saving, save } = useEntrySave({
    session,
    trips,
    initial,
    values: form.values,
    text,
    attached,
    fuzzed: gate.fuzzed,
  });

  /* ────────────────────────────────────────────────────── the local draft ── */

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

  /** Process, upload, hold a `Photo` — never the `File` — and then offer §11.3's
   *  coordinate and §11.5's two time halves. ./hooks/use-photo-pipeline.ts */
  const { attachAll } = usePhotoPipeline({
    session,
    podRoot,
    pipeline,
    coordinatesLive: gate.coordinatesLive,
    markTouched,
    form,
  });

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
    form.restore(draft, { addressFixed, tripIris, presetPrecision: gate.presetPrecision });
    // Restored once. Leaving the banner up invites a second click that would
    // overwrite whatever the owner typed after the first.
    clearOffer();
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
          void save(settleDraft);
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
            tripIri={values.tripIri}
            onTripChange={form.set.tripIri}
            addressFixed={addressFixed}
            slug={values.slug}
            onSlugChange={form.set.slug}
            headline={values.headline}
            onHeadlineChange={form.set.headline}
            story={values.story}
            onStoryChange={form.set.story}
          />

          <WhenFields
            occurred={values.occurred}
            onOccurredChange={form.set.occurred}
            occurredSource={form.sources.occurred}
            offset={values.offset}
            onOffsetChange={form.set.offset}
            offsetOptions={form.offsetOptions}
            offsetGuess={values.offsetGuess}
            offsetSource={form.sources.offset}
          />

          <WhereFields
            placeName={values.placeName}
            onPlaceNameChange={form.set.placeName}
            locality={values.locality}
            onLocalityChange={form.set.locality}
            country={values.country}
            onCountryChange={form.set.country}
            lat={values.lat}
            onLatChange={form.set.lat}
            long={values.long}
            onLongChange={form.set.long}
            precision={values.precision}
            onPrecisionChange={form.set.precision}
            precisionOptions={gate.precisionOptions}
            coordinatesLive={gate.coordinatesLive}
            coordinateNote={gate.coordinateNote}
            settingsDetail={gate.settingsDetail}
            coordinateSource={form.sources.coordinate}
            hasStoredCoordinate={existing?.place?.geo !== undefined}
          />

          <PhotoFields slots={values.slots} onPicked={attachAll} />

          <ClassificationFields
            tagsText={values.tagsText}
            onTagsTextChange={form.set.tagsText}
            mode={values.mode}
            onModeChange={form.set.mode}
            status={values.status}
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
