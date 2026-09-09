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

/** The photos the entry will carry. PICKING APPENDS AND NEVER REPLACES, once
 *  each, and the free `sortOrder` is NOT `carried.length` — measured:
 *  ./notes.md#picking-appends-once-each-and-sortorder-is-measured */
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

/** The picked photos that have URLs on the Pod, in pick order. `ready` ONLY,
 *  and that filter is the fence:
 *  ./notes.md#attachedof-is-the-fence-between-a-slot-and-a-photo */
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

  /** THE ONE THIS COMPONENT CREATED, AND NOTHING ELSE EVER GOES IN HERE —
   *  `dispose()` is not a cancel, so whoever creates disposes:
   *  ./notes.md#whoever-creates-the-pipeline-disposes-it */
  const ownPipeline = useRef<Pipeline | null>(null);

  /** Lazily, on the first pick. A worker at mount costs a thread and a chunk on
   *  every edit, and most edits touch no photo at all. */
  function pipelineFor(): Pipeline {
    if (pipeline !== undefined) return pipeline;
    if (ownPipeline.current === null) ownPipeline.current = createPipeline();
    return ownPipeline.current;
  }

  useEffect(() => {
    /** DISPOSAL, NOT TIDINESS: a 50 MP decode is ~200 MB, and UNMOUNT IS THE
     *  ONLY CORRECT CALLER TODAY: ./notes.md#disposal-is-not-tidiness */
    return () => {
      ownPipeline.current?.dispose();
      ownPipeline.current = null;
    };
  }, []);

  /**
   * §11.3's OFFER, AND THE TWO GUARDS THAT ARE NOT THE TRANSITION'S — the §9
   * gate, and the tag's own absence. `gps` IS OPTIONAL AND THE GUARD IS NOT
   * DECORATION: `String(undefined)` in a `type="number"` box reads as empty.
   * ./notes.md#the-coordinate-offers-two-guards
   */
  function offerCoordinate(name: string, metadata: PipelineResult["metadata"]) {
    /**
     * §9 FAILS CLOSED, AND A PHOTO IS NOT AN EXCEPTION TO IT. DELETING THIS
     * LINE DELETES A STORED `#geo` ON AN EDIT — `fuzzed()` answers `undefined`
     * for a gate that is not `ready` and `placeFor` reads that as a REMOVAL.
     * ./notes.md#the-gate-is-asked-again-for-a-photo-and-fails-closed
     */
    if (!coordinatesLive) return;

    const gps = metadata.gps;
    if (gps === undefined) return;
    /* AT FULL PRECISION AND AS A STRING: a value rounded on the way IN is a snap
       the owner did not choose. The refusal itself is `applyPhotoCoordinate`'s,
       not this function's. ./notes.md#the-coordinate-offers-two-guards */
    form.offerCoordinate(name, String(gps.lat), String(gps.long));
    /* A FILL IS A CHANGE TO THE FORM, and every change arms the autosave —
       unconditionally now, because whether anything filled is the
       transition's answer and not this caller's:
       ../state/notes.md#what-stayed-outside-the-reducer-and-why */
    markTouched();
  }

  /** §11.5's offer, made twice, and BOTH OF ITS REFUSALS ARE THE TRANSITION'S:
   *  ./notes.md#the-timestamp-offers-refusals-are-the-transitions */
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

  /** PROCESS, UPLOAD, THEN HOLD A `Photo` — never the `File` — and NOTHING
   *  THROWS OUT OF HERE: ./notes.md#process-upload-then-hold-a-photo */
  async function attach(file: File) {
    const key = `photo-${nextSlotKey.current++}`;
    const name = file.name;
    const move = (next: PhotoSlot) => {
      /** A SETTLE IS A CHANGE TO THE FORM AND HAS TO ARM THE AUTOSAVE: a save
       *  landing between pick and settle orphans the photo silently. `ready`
       *  ONLY: ./notes.md#a-settle-must-arm-the-autosave */
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
      /** ON `ready`, AND NOT A LINE EARLIER — a coordinate offered for a photo
       *  whose PUT then fails has nothing on screen to explain it:
       *  ./notes.md#the-offers-are-made-on-ready-and-not-a-line-earlier */
      offerCoordinate(name, derived.metadata);
      /* THE TWO OFFERS ARE INDEPENDENT AND BOTH ARE MADE, in either order, and
         the `key` goes in beside the name because that is photo identity here:
         ./notes.md#the-offers-are-made-on-ready-and-not-a-line-earlier */
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
