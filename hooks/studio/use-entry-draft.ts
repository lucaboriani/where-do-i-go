/**
 * The local copy of what is being typed: the debounce that keeps it, the offer
 * that hands it back, and the settle that stops it being a trap once the Pod
 * holds the text. ./notes.md#what-use-entry-draft-is-tested-for
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { clearDraft, readDraft, writeDraft } from "@/lib/studio/drafts";
import { nowWithOffset } from "@/lib/time/offsets";
import type { EntryFormState } from "@/components/studio/entry-editor/state/actions";
import type { Photo } from "@/lib/pod/schema";
import type { Draft, StorageLike } from "@/lib/studio/drafts";

/** How long after the last change a local copy is kept. A DEBOUNCE, NOT AN
 *  INTERVAL, and exported so the suite that drives the window pins the same
 *  number: ./notes.md#the-debounce-is-exported-on-purpose */
export const DRAFT_DEBOUNCE_MS = 800;

/** The scope of a create (`lib/studio/drafts.ts`): there is no resource yet to
 *  name, so every create in this browser shares one draft. */
const NEW_DRAFT_SCOPE = "new";

/** The sixteen fields the FORM holds — `Draft` minus the stamp, which is put on
 *  at the moment of the write and never earlier (§6). It read "twelve" until
 *  2026-09-07, having missed `photos`, the three place fields and `offset`. */
export type DraftText = Omit<Draft, "savedAt">;

/** Two photo lists, by the only identity a photo has — where it lives on the
 *  Pod: ./notes.md#photos-compare-by-contenturl-text-compares-field-by-field */
const samePhotos = (a: readonly Photo[], b: readonly Photo[]) =>
  a.length === b.length && a.every((photo, at) => photo.contentUrl === b[at]?.contentUrl);

/** Have the sixteen fields moved between two snapshots? Field by field, and
 *  all sixteen: ./notes.md#photos-compare-by-contenturl-text-compares-field-by-field */
const sameText = (a: DraftText, b: DraftText) =>
  a.tripIri === b.tripIri &&
  a.slug === b.slug &&
  a.headline === b.headline &&
  a.story === b.story &&
  a.occurred === b.occurred &&
  a.offset === b.offset &&
  a.tagsText === b.tagsText &&
  a.mode === b.mode &&
  a.status === b.status &&
  a.lat === b.lat &&
  a.long === b.long &&
  a.precision === b.precision &&
  a.placeName === b.placeName &&
  a.locality === b.locality &&
  a.country === b.country &&
  samePhotos(a.photos, b.photos);

/** The browser's own storage, or `null` where there is none to be had —
 *  WRAPPED, because the property read itself can throw a SecurityError:
 *  ./notes.md#storage-access-itself-can-throw */
export function browserStorage(): StorageLike | null {
  try {
    // `?? null` is not belt and braces: outside a browser there is no
    // `localStorage` at all — node has one only behind a flag — so this is
    // `undefined` rather than absent, and `undefined` would sail past every
    // `=== null` guard below and be called as if it were a storage.
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** `EntryFormState` → the sixteen fields a draft is, with the READY photos.
 *  SPELLED OUT RATHER THAN SPREAD: `slots`, the three credits and `offsetGuess`
 *  are the reducer's, and a slot holds no `Photo` until it settles. `Draft`
 *  requires all sixteen, so an omission here is a type error rather than a
 *  field silently absent from every local copy. */
export function draftTextOf(values: EntryFormState, photos: readonly Photo[]): DraftText {
  return {
    tripIri: values.tripIri,
    slug: values.slug,
    headline: values.headline,
    story: values.story,
    occurred: values.occurred,
    // The offset the owner chose, beside the wall clock rather than folded into
    // it: the control they type the time into has none, and a draft that kept
    // only the wall clock would hand back the machine's guess.
    offset: values.offset,
    tagsText: values.tagsText,
    mode: values.mode,
    status: values.status,
    lat: values.lat,
    long: values.long,
    precision: values.precision,
    // Where the owner was, in words. Kept for the reason §9 makes sharpest: a
    // crash near home would otherwise leave an entry with no coordinate AND no
    // name, which is a placeless entry rather than a coarse one.
    placeName: values.placeName,
    locality: values.locality,
    country: values.country,
    /**
     * THE PHOTOS, AS `Photo` OBJECTS — which is only possible because the pick
     * uploaded them. A `File` here would serialise to `{}` without throwing,
     * and the draft would report success while restoring a photo with no URL.
     */
    photos: [...photos],
  };
}

/* ══════════════════════════════════════════════════════════════════ inputs ══ */

/**
 * What actually reached the Pod, and where the entry now lives. Called by
 * `useEntrySave` at the one moment §10 step 1 has completed.
 */
export type SettleDraft = (sent: DraftText, nextScope: string) => void;

export interface EntryDraftSeed {
  /** Where in-progress text is kept. `undefined` is what ships, and means the
   *  browser's own — see `browserStorage`. */
  storage: StorageLike | undefined;
  /** Off the session and nowhere else, exactly like `dcterms:creator`. Absent
   *  means nobody is signed in, and nobody's draft is anybody's. */
  webId: string | undefined;
  /**
   * The entry's own document URL from the moment one exists, `undefined` on a
   * create — i.e. `target?.url`, DERIVED FROM THE THING THAT MOVES.
   * ./notes.md#the-scope-follows-the-target-and-that-was-once-argued-backwards
   */
  entryUrl: string | undefined;
  /** The sixteen fields AS THEY ARE RIGHT NOW, from `draftTextOf` — and the
   *  same value the save is given, because `settleDraft` compares the two and
   *  two constructions is how the answers drift. */
  text: DraftText;
}

/** The banner, the quiet note, and the four verbs the editor and the save
 *  between them spend. */
export interface EntryDraft {
  offered: Draft | null;
  storageRefused: boolean;
  /** Arm the autosave: somebody has typed. ./notes.md#the-touched-ref-moved-into-the-hook-that-reads-it */
  markTouched: () => void;
  settleDraft: SettleDraft;
  discard: () => void;
  /** The owner RESTORED, so the banner is answered and storage is left alone.
   *  `discard` is the other answer, and it clears the key. */
  clearOffer: () => void;
}

/* ═════════════════════════════════════════════════════════════════ the hook ══ */

/** 142 code lines against the 200 bound, over the 130 tendency and staying
 *  there: 52 of them are the same sixteen fields written out three times, and
 *  the one split that would get under 130 lends two refs to another file:
 *  ./notes.md#task-7-measured-the-142-and-it-stays */
export function useEntryDraft({ storage, webId, entryUrl, text }: EntryDraftSeed): EntryDraft {
  /** HAS ANYBODY ACTUALLY TYPED? Without this the autosave's mount run would
   *  store what the editor opened with: ./notes.md#what-the-touched-ref-guards
   *  Its stale layout paragraph: ./notes.md#the-touched-ref-moved-into-the-hook-that-reads-it */
  const touched = useRef(false);

  /** WHICH draft this editor owns, derived from the thing that MOVES — a
   *  create's key is not its entry's:
   *  ./notes.md#the-scope-follows-the-target-and-that-was-once-argued-backwards */
  const scope = entryUrl ?? NEW_DRAFT_SCOPE;
  const store = useMemo(() => storage ?? browserStorage(), [storage]);

  /** A stored draft the owner has not yet accepted or thrown away. The form is
   *  untouched while this is up — restoring on mount would silently overwrite
   *  whatever they opened the editor with. */
  const [offered, setOffered] = useState<Draft | null>(null);
  const [storageRefused, setStorageRefused] = useState(false);
  /** The debounce in flight, held so a save can cancel it — and so the unmount
   *  below can tell a window that never fired from one that did. See
   *  `settleDraft`. */
  const pendingWrite = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** ONE LOOK PER EDITOR, and this ref is what makes it one — including under
   *  StrictMode: ./notes.md#one-look-per-editor */
  const draftRead = useRef(false);

  /** THE FORM AS IT IS RIGHT NOW, for the two paths that read it from outside
   *  a render: ./notes.md#the-live-ref-is-refreshed-after-every-render */
  const live = useRef({ store, webId, scope, text });
  useEffect(() => {
    live.current = { store, webId, scope, text };
  });

  /** Destructured for ONE reason: the autosave's dependency array is these
   *  sixteen values and not the object holding them, which is fresh on every
   *  render. ./notes.md#why-the-autosave-still-depends-on-sixteen-values */
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
    photos,
  } = text;

  /** ON MOUNT, IN AN EFFECT, NEVER DURING RENDER — and a one-shot read rather
   *  than `useSyncExternalStore`:
   *  ./notes.md#the-draft-read-is-a-one-shot-not-a-subscription */
  useEffect(() => {
    if (store === null || webId === undefined || draftRead.current) return;
    draftRead.current = true;
    setOffered(readDraft(store, { webId, scope }));
  }, [store, webId, scope]);

  /** THE AUTOSAVE, keyed on the form values so the typing coalesces into one
   *  write. Seventeen fields go in, three are deliberately left out:
   *  ./notes.md#what-goes-into-the-autosave-and-what-is-left-out */
  useEffect(() => {
    if (store === null || webId === undefined) return;
    if (!touched.current) return;

    const handle = setTimeout(() => {
      pendingWrite.current = null;
      const kept = writeDraft(
        store,
        { webId, scope },
        // The caller stamps the moment; the store holds no clock, so this is the
        // same spelling every other timestamp in this file gets (§6).
        {
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
          photos,
          savedAt: nowWithOffset(),
        },
      );
      /** IT KEEPS TRYING ON LATER WINDOWS, deliberately — a quota condition can
       *  clear: ./notes.md#a-refused-write-keeps-trying */
      if (!kept) setStorageRefused(true);
    }, DRAFT_DEBOUNCE_MS);

    pendingWrite.current = handle;
    /** THE TIMER IS CANCELLED HERE; THE REF IS NOT CLEARED HERE, and that
     *  asymmetry is what the unmount flush reads:
     *  ./notes.md#the-timer-is-cleared-and-the-ref-is-not */
    return () => {
      clearTimeout(handle);
    };
  }, [
    store,
    webId,
    scope,
    tripIri,
    slug,
    headline,
    story,
    occurred,
    // Changing the offset alone has to arm a window: it is not typing, and this
    // is the dependency that makes the state change reach the debounce.
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
    // The ready photos, so attaching one arms a window like any other change.
    // Its identity moves on every slot transition, not only on a settle, so a
    // photo in flight restarts the window — which is what a debounce is for.
    photos,
  ]);

  /** AN UNMOUNT IS NOT A REASON TO THROW THE LAST 800ms AWAY — and not in the
   *  effect above's cleanup, which runs per keystroke: ./notes.md#the-unmount-flush */
  useEffect(() => {
    return () => {
      const at = live.current;
      if (at.store === null || at.webId === undefined) return;
      /**
       * Nothing outstanding: the last window either fired or was cancelled by a
       * save that succeeded. Writing here would resurrect a draft the Pod has
       * already made redundant — the trap `settleDraft` exists to avoid.
       */
      if (pendingWrite.current === null) return;
      // Belt and braces: the cleanup above may or may not have run first, and
      // `clearTimeout` on a handle already cleared is a no-op either way.
      clearTimeout(pendingWrite.current);
      pendingWrite.current = null;
      writeDraft(
        at.store,
        { webId: at.webId, scope: at.scope },
        { ...at.text, savedAt: nowWithOffset() },
      );
    };
  }, []);

  /** THE MOMENT THE POD HOLDS THE TEXT the local copy becomes a trap. Cancel
   *  first, clear the OLD key, re-keep what was typed meanwhile:
   *  ./notes.md#what-settledraft-gets-right */
  function settleDraft(sent: DraftText, nextScope: string) {
    if (store === null || webId === undefined) return;
    if (pendingWrite.current !== null) {
      clearTimeout(pendingWrite.current);
      pendingWrite.current = null;
    }
    clearDraft(store, { webId, scope });
    setOffered(null);

    const typed = live.current.text;
    if (sameText(typed, sent)) {
      // The Pod holds exactly what is on the screen. Nothing to back up until
      // the owner types again.
      touched.current = false;
      return;
    }

    // Still dirty, so the next keystroke must restart a window rather than be
    // the first thing that arms one.
    touched.current = true;
    const kept = writeDraft(
      store,
      { webId, scope: nextScope },
      { ...typed, savedAt: nowWithOffset() },
    );
    // Same reasoning as the debounced write: the note appears once, and the
    // attempts behind it continue.
    if (!kept) setStorageRefused(true);
  }

  /** The owner saying "that is not what I want", so the draft has to be GONE
   *  rather than hidden — a banner dismissed without clearing storage comes back
   *  on the next mount. The form is left exactly as it is: this throws away the
   *  STORED draft, not the text on the screen. */
  function discard() {
    if (store !== null && webId !== undefined) clearDraft(store, { webId, scope });
    setOffered(null);
  }

  return {
    offered,
    storageRefused,
    markTouched: () => {
      touched.current = true;
    },
    settleDraft,
    discard,
    clearOffer: () => {
      setOffered(null);
    },
  };
}
