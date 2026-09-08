/**
 * One pick, from the file the owner chose to the `Photo` the entry carries:
 * process, upload, hold a URL, then offer the two things the EXIF said.
 * ./notes.md#what-use-photo-pipeline-is-tested-for
 */

import { useEffect, useRef } from "react";
import { createPipeline } from "@/lib/media/pipeline";
import { uploadPhoto } from "@/lib/media/upload";
import { describe } from "@/lib/pod/result";
import type { EntryForm } from "./use-entry-form";
import type { Pipeline, PipelineResult } from "@/lib/media/pipeline";
import type { Photo } from "@/lib/pod/schema";
import type { PhotoSlot } from "../state/actions";
import type { StudioSessionLike } from "@/lib/studio/session";

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
export function photosFor(carried: readonly Photo[], attached: readonly Photo[]): Photo[] {
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

/**
 * The picked photos that have URLs on the Pod, in pick order.
 *
 * `ready` ONLY. This is what the draft keeps and what the save carries, so
 * the filter is the fence: a decoding slot has no `Photo` at all and a failed
 * one must not reach either, or the entry references a photo that 404s for
 * every reader.
 */
export const attachedOf = (slots: readonly PhotoSlot[]): Photo[] =>
  slots.flatMap((slot) => (slot.state === "ready" ? [slot.photo] : []));

/* ══════════════════════════════════════════════════════════════════ inputs ══ */

export interface PhotoPipelineSeed {
  /** Its `fetch` is the only authenticated one in the browser, and a media PUT
   *  is a write: anonymously it is a 401 (invariant 4). */
  session: StudioSessionLike;
  /** The Pod's storage root, where `travel/media/` hangs (§4). */
  podRoot: string;
  /** Injected, or `undefined` for the one this hook creates lazily. OWNERSHIP
   *  FOLLOWS CREATION — see `ownPipeline`. */
  pipeline: Pipeline | undefined;
  /** §9's gate, as `offerCoordinate` asks it. */
  coordinatesLive: boolean;
  /** Arms the autosave: a settle and a fill are changes to the form like any
   *  other. ./notes.md#the-touched-ref-moved-into-the-hook-that-reads-it */
  markTouched: () => void;
  /** The four transitions a pick may dispatch, and no more. A holder of
   *  `dispatch` could invent one, which is what `state/` exists to prevent. */
  form: Pick<EntryForm, "addSlot" | "settleSlot" | "offerCoordinate" | "offerTimestamp">;
}

/* ═════════════════════════════════════════════════════════════════ the hook ══ */

export function usePhotoPipeline({
  session,
  podRoot,
  pipeline,
  coordinatesLive,
  markTouched,
  form,
}: PhotoPipelineSeed): { attachAll: (picked: readonly File[]) => void } {
  /** Slot identity, monotonic per editor. Not the file name, and not an index:
   *  see `PhotoSlot`. */
  const nextSlotKey = useRef(0);

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
    if (!coordinatesLive) return;

    const gps = metadata.gps;
    if (gps === undefined) return;
    /* AT FULL PRECISION AND AS A STRING, for the docblock's reason: a value
       rounded on the way IN is a snap the owner did not choose. The refusal
       itself is `applyPhotoCoordinate`'s, not this function's. */
    form.offerCoordinate(name, String(gps.lat), String(gps.long));
    /* A FILL IS A CHANGE TO THE FORM, and every change arms the autosave —
       unconditionally now, because whether anything filled is the
       transition's answer and not this caller's:
       ../state/notes.md#what-stayed-outside-the-reducer-and-why */
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
  return { attachAll };
}
