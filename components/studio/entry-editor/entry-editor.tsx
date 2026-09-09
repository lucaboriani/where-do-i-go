"use client";

/**
 * The studio's entry editor: one form, and §10's write sequence behind it. IT
 * IMPORTS NO VALUE FROM THE AUTH LIBRARY AND READS NO CONFIG. IT NEVER PUTs —
 * that is `lib/pod/save-entry.ts`'s. §9's FUZZ HAPPENS HERE, before the `Entry`
 * exists. ./notes.md#what-the-editor-is-not-allowed-to-do
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
  /** `dy:status` of the TRIP, not of the entry. Rendered, because a picker that
   *  shows a draft trip and a published one identically invites the one mistake
   *  the editor cannot undo: ./notes.md#the-trips-own-status-is-rendered */
  status?: EntryStatus;
}

export interface EntryEditorProps {
  /** Injected, never constructed here. Its `fetch` is the only authenticated
   *  one in the browser, and every Pod request below goes through it. */
  session: StudioSessionLike;
  trips: EditorTrip[];
  /** `/travel/settings/privacy.ttl` (§7.6), GIVEN rather than derived, and
   *  REQUIRED: optional would fail closed for ever with nothing red anywhere.
   *  A URL and not the settings, because THE READ FAILING IS THE CASE THAT
   *  MATTERS: ./notes.md#settingsurl-and-podroot-are-required-props */
  settingsUrl: string;
  /** The Pod's storage root, where `travel/media/` hangs (§4). REQUIRED, and a
   *  prop, for `settingsUrl`'s reasons:
   *  ./notes.md#settingsurl-and-podroot-are-required-props */
  podRoot: string;
  /** The resize/EXIF pipeline, injected so a test can supply output it knows
   *  byte for byte. OWNERSHIP FOLLOWS CREATION — `dispose()` is not a cancel:
   *  ./notes.md#the-pipeline-is-injected-and-ownership-follows-creation */
  pipeline?: Pipeline;
  /**
   * Absent means CREATE. Present means EDIT, and `etag` is the one from THE
   * READ THAT PRODUCED THIS STATE (§10) — `null` when the server sent none,
   * which is a state this editor refuses to save over rather than papering
   * over with a blind PUT.
   */
  initial?: { entry: Entry; etag: string | null };
  /** Where in-progress text is kept between visits; the browser's own by
   *  default. Injected so Safari's zero-quota throw can be scripted:
   *  ./notes.md#storage-is-injected-so-the-failure-can-be-scripted */
  storage?: StorageLike;
}

/** `2026-04-02T19:00:00+09:00` → `2026-04-02 at 19:00`, the wall clock AS IT WAS
 *  STAMPED and never shifted. Takes a `string` and stays that way (ruling
 *  2.5-A): ./notes.md#savedattext-shows-the-wall-clock-as-it-was-stamped */
const savedAtText = (savedAt: string) => `${savedAt.slice(0, 10)} at ${savedAt.slice(11, 16)}`;

/** ONE END OF THE ASSOCIATION BETWEEN THE HELD SAVE BUTTON AND THE SENTENCE
 *  THAT EXPLAINS THE HOLD, spelled once because a dangling IDREF computes to
 *  the empty string, silently: ./notes.md#the-hold-reason-id-is-spelled-once */
const HOLD_REASON_ID = "entry-draft-hold";

/* ════════════════════════════════════════════════════════════════ the form ══ */

/** Composition, and the page's own frame. 195 code lines against the 200 bound,
 *  which is why the `max-lines-per-function` exemption is gone:
 *  ./notes.md#the-exemption-went-because-the-directive-became-unused
 *  What the 195 are: ./hooks/notes.md#what-the-195-are-and-what-they-are-not */
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

  /** THE TWENTY VALUES THE FORM IS, as one reducer, with every seeding decision
   *  in `initialEntryFormState`: ./state/notes.md#guard-inside-the-transition
   *  NOT DESTRUCTURED ANY MORE: ./hooks/notes.md#the-seventeen-names-came-back-together */
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

      {/* NAMED BY `title`, NOT BY `aria-label`, AND THAT IS LOAD-BEARING: every
          ARIA naming mechanism lands in `getByLabelText` on ANY element, and the
          Status select already answers to these words — two matches against one,
          measured. ./notes.md#named-by-title-not-by-aria-label */}
      {offered !== null && (
        <section
          role="region"
          title="Unsaved draft"
          className="mt-4 border border-hairline bg-surface p-4"
        >
          {/* RULING 2.5-A: the banner still appears when `savedAt` is absent, and
              the WHOLE clause is conditional rather than just the `<time>`:
              ./notes.md#ruling-25-a-the-banner-survives-an-absent-savedat */}
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
          {/* THE HOLD, SAID OUT LOUD AND SAID HERE — the Save button NAMES this
              element, so a second copy beside the button is a text that drifts:
              ./notes.md#the-hold-is-said-in-the-banner-not-beside-the-button */}
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
        /* ONE PLACE THAT MARKS THE FORM AS TOUCHED, since React delivers
           `onChange` to ancestors. `restore()` deliberately does NOT come
           through here: ./notes.md#one-place-marks-the-form-as-touched */
        onChange={markTouched}
        onSubmit={(event) => {
          // Prevented, so jsdom and the browser both stay on this page and the
          // save is this component's to run.
          event.preventDefault();
          void save(settleDraft);
        }}
      >
        {/* HELD WHILE A DRAFT IS OFFERED — one storage slot. A `<fieldset disabled>`
            AND NOT A GUARD IN `onChange` OR IN THE AUTOSAVE: both of those lose the
            text silently. THE SAVE BUTTON IS IN HERE TOO:
            ./notes.md#held-while-a-draft-is-offered */}
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

          {/* THE SEVENTEENTH CONTROL, HELD BY THE SAME ATTRIBUTE: one unheld click
              on an EDIT deletes the draft that survived the crash. `saving` and
              `aria-busy` COMPOSE WITH THE FIELDSET RATHER THAN REPLACE IT:
              ./notes.md#the-save-button-is-the-seventeenth-control */}
          <div>
            {/* THE REASON IS ON THE BUTTON, NOT ON THE FIELDSET, AND MUST NOT BE
                TIDIED UPWARD: nothing propagates a group's description to its
                members. CONDITIONAL BOTH WAYS, and NO TEST CATCHES THE
                UNCONDITIONAL SPELLING:
                ./notes.md#the-reason-is-on-the-button-not-on-the-fieldset */}
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

      {/* `role="note"`, WHICH IS NEITHER `status` NOR `alert` AND MUST NOT BECOME
          ONE — those two belong to the save, and this changes nothing about the
          Pod: ./notes.md#the-storage-note-is-a-note-not-a-status-or-an-alert */}
      {storageRefused && (
        <p role="note" className="mt-6 text-sm text-muted-foreground">
          {"This browser is not keeping a local copy of what you type — private browsing, or " +
            "storage that is full or switched off. Saving to your Pod is unaffected, but " +
            "anything you have not saved will not survive closing this tab."}
        </p>
      )}

      {/* `status` for news, `alert` for a decision. THE TECHNICAL DETAIL IS
          DELIBERATELY OUTSIDE THE ANNOUNCED REGION — measured: inside it, keying
          the message off `recovery` alone passed the test meant to catch it.
          ./notes.md#the-outcome-region-and-why-the-detail-sits-outside-it */}
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
