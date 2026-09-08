/**
 * The local copy of what is being typed: the debounce that keeps it, the offer
 * that hands it back, and the settle that stops it being a trap once the Pod
 * holds the text. ./notes.md#what-use-entry-draft-is-tested-for
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { clearDraft, readDraft, writeDraft } from "@/lib/studio/drafts";
import { nowWithOffset } from "@/lib/studio/time/offsets";
import type { EntryFormState } from "../state/actions";
import type { Photo } from "@/lib/pod/schema";
import type { Draft, StorageLike } from "@/lib/studio/drafts";

/**
 * How long after the last change the editor waits before keeping a local copy.
 *
 * A DEBOUNCE, NOT AN INTERVAL: each change restarts the window, so a minute of
 * typing is one write rather than seventy. Exported because the studio is what
 * ships this number and a value that lives only inside the closure is one nobody
 * can change on purpose — components/studio/entry-editor/entry-editor.test.tsx drives the window and pins
 * it against this export so the two cannot drift.
 */
export const DRAFT_DEBOUNCE_MS = 800;

/** The scope of a create (`lib/studio/drafts.ts`): there is no resource yet to
 *  name, so every create in this browser shares one draft. */
const NEW_DRAFT_SCOPE = "new";

/** The sixteen fields the FORM holds — `Draft` minus the stamp, which is put on
 *  at the moment of the write and never earlier (§6). It read "twelve" until
 *  2026-09-07, having missed `photos`, the three place fields and `offset`. */
export type DraftText = Omit<Draft, "savedAt">;

/**
 * Two photo lists, compared by the only identity a photo has: where it lives on
 * the Pod.
 *
 * BY `contentUrl` RATHER THAN BY VALUE, and the difference is not laziness. The
 * URL is content-addressed — `travel/media/<sha256(source)[0..16]>/` — so two
 * entries with the same URL are the same bytes, and nothing else about a photo
 * can change without the owner picking a different file. Order matters because
 * `sortOrder` is the position, so a reordering is a change.
 */
const samePhotos = (a: readonly Photo[], b: readonly Photo[]) =>
  a.length === b.length && a.every((photo, at) => photo.contentUrl === b[at]?.contentUrl);

/**
 * Have the sixteen fields moved between two snapshots?
 *
 * Field by field rather than `JSON.stringify`, which would answer "different"
 * for the same sixteen values in a different key order. The consequence of a
 * false "different" is not cosmetic: it is a local copy written back for text
 * the Pod already holds, which is exactly the resurrected draft the clear after
 * a save exists to prevent.
 *
 * The three coordinate fields are in here for the same reason the other nine
 * are: they are what the form holds. A comparison that skipped them would call
 * a form whose only change was the latitude "unchanged" and drop that change
 * from the local copy — the one field on this screen nobody can retype from
 * memory a day later. So are the three place fields, and there the loss is the
 * one §9 leans on: near home the coordinate is dropped and the NAME is all the
 * entry has left to say where it was.
 *
 * So are the photos, and there the consequence is worse than retyping: a photo
 * attached while the Pod was answering is bytes that are already uploaded and
 * about to be referenced by nothing at all.
 *
 * And so is the offset, which is half of the timestamp: an offset corrected
 * while the Pod was answering, dropped from this comparison, would leave the
 * local copy holding the guess the owner had just replaced.
 */
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

/**
 * The browser's own storage, or `null` where there is none to be had.
 *
 * WRAPPED, BECAUSE THE ACCESS ITSELF CAN THROW — not the call, the property
 * read. Some embedded browsers and some third-party-storage settings raise a
 * SecurityError on `localStorage` before any method is reached, and an editor
 * that fell over on that would be an editor the owner cannot open at all. `null`
 * simply means no local copy is kept; nothing else about the form changes.
 */
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

export function useEntryDraft({ storage, webId, entryUrl, text }: EntryDraftSeed): EntryDraft {
  /**
   * HAS ANYBODY ACTUALLY TYPED? A ref, not state: it changes nothing on screen
   * and re-rendering for it would be noise.
   *
   * The autosave effect further down is keyed on the form values, so it fires
   * once on mount — and without this guard the editor would store a copy of
   * whatever it opened with. Opening an entry to read it and navigating away
   * would then leave an "Unsaved draft" banner waiting next time, offering to
   * restore exactly what is already on the Pod; once that banner appears for
   * entries nobody edited it stops meaning anything and gets clicked away by
   * reflex.
   *
   * DECLARED HERE, ABOVE `attach`, AND NOT DOWN IN THE DRAFT SECTION WHERE THE
   * REST OF ITS MACHINERY LIVES — because `attach` arms it when a slot settles,
   * and `react-hooks/immutability` refuses a `.current` write inside a function
   * that closes over a `useRef` declared BELOW it. Measured rather than
   * reasoned about: with the declaration left in the draft section, `npm run
   * lint` reported two errors, and neither was on the new line — it flagged the
   * PRE-EXISTING writes in `settleDraft` and in the form's `onChange`, both of
   * which had been clean for the life of the file. Moving this one line up made
   * all three legal again. `nextSlotKey` is the same kind of ref mutated from
   * the same `attach`, and is declared just above for the same reason.
   */
  const touched = useRef(false);

  /**
   * WHICH draft this editor owns: the shared create key until a resource
   * exists, and the entry's own document URL from the moment one does.
   *
   * DERIVED FROM `target`, WHICH IS THE THING THAT MOVES — and this comment
   * used to argue the exact opposite, so it is worth saying plainly why that
   * was wrong. It claimed that keying on `target` "would clear a key nothing
   * was ever stored under and leave the real draft behind". On an EDIT that is
   * false: `target.url` starts life as `documentUrlOf(initial.entry.iri)`,
   * which is the expression this line used to be, so the two derivations agree
   * — everywhere except in one place.
   *
   * That one place was the defect. `target` is set the moment §10 step 1
   * completes; with the scope left on `new`, everything typed after a
   * successful create was autosaved under the CREATE key while carrying the
   * created entry's slug. Close the tab, open a fresh create form tomorrow,
   * Restore, Save — `If-None-Match: *` against a URL that now exists, a 412,
   * and the owner is told the entry "changed elsewhere, or in another tab",
   * which is not what happened and is not something they can act on.
   *
   * What the old comment was right about is that the SAVE must clear the key it
   * had been WRITING under rather than the one it is moving to. That is
   * `settleDraft`'s job, and it is spelled out there.
   */
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
  /**
   * ONE LOOK PER EDITOR, and the ref is what makes it one.
   *
   * The effect below is a snapshot, not a subscription: it asks storage what was
   * left behind, offers it, and never asks again. Without this guard the effect
   * would run again whenever its dependencies changed identity — a caller that
   * builds `storage={{ getItem… }}` inline gets a fresh object on every render —
   * and each run would re-offer a banner the owner had just discarded, which
   * from the owner's side is a dismissal that does not work.
   *
   * It is also what keeps the read out of StrictMode's second invocation.
   */
  const draftRead = useRef(false);

  /**
   * THE FORM AS IT IS RIGHT NOW, for the two paths that have to read it from
   * OUTSIDE a render: the unmount flush below, and the save's check for text
   * typed while the Pod was answering.
   *
   * Both of those run after later renders have happened, and a closure made
   * during a render holds that render's values for ever — which is precisely
   * the bug in each case: "flush whatever was on the form when the editor
   * mounted", and "assume the form still equals what was sent".
   *
   * Refreshed in an effect with NO dependency array, which is how "after every
   * render" is spelled. Writing to a ref during the render itself is the thing
   * that is not allowed; writing to one in an effect is ordinary.
   */
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

  /**
   * ON MOUNT, IN AN EFFECT, NEVER DURING RENDER. Storage is a browser thing and
   * reading it while rendering would make this component's output depend on
   * something React cannot see. `readDraft` answers `null` for everything
   * unusable rather than throwing, so a value truncated by a tab killed
   * mid-write cannot stop the editor from opening.
   *
   * A ONE-SHOT READ IS NOT A SUBSCRIPTION, which is why this is not
   * `useSyncExternalStore` — the shape react-hooks/set-state-in-effect points at
   * for external data. Its `getSnapshot` is re-read on every render, so the
   * banner would reappear the instant the autosave below wrote, offering to
   * restore the very text the owner is in the middle of typing. What is wanted
   * is the draft AS IT WAS WHEN THE EDITOR OPENED, held until the owner answers
   * it, and that is state.
   */
  useEffect(() => {
    if (store === null || webId === undefined || draftRead.current) return;
    draftRead.current = true;
    setOffered(readDraft(store, { webId, scope }));
  }, [store, webId, scope]);

  /**
   * THE AUTOSAVE. Keyed on the form values, so every change restarts the window
   * and the typing coalesces into one write.
   *
   * What goes in is the seventeen fields of `Draft` and nothing else — the
   * sixteen the form holds, plus the `savedAt` stamp put on below. The ETag, the
   * `dcterms:created` and the `schema:datePublished` this component is holding
   * right now are deliberately absent: they come from the read that produced
   * this state (§10), a draft outlives that read by however long the browser was
   * closed, and `lib/studio/drafts.ts` strips them even if they are handed in.
   */
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
      /**
       * IT KEEPS TRYING ON LATER WINDOWS, and that is deliberate rather than an
       * oversight. A quota condition can clear — a tab closed, a cache evicted —
       * and switching the backup off for the rest of the session because one
       * write failed is worse than a cheap throw every 800ms. The note below
       * appears once and stays; the attempts continue.
       */
      if (!kept) setStorageRefused(true);
    }, DRAFT_DEBOUNCE_MS);

    pendingWrite.current = handle;
    /**
     * THE TIMER IS CANCELLED HERE; THE REF IS NOT CLEARED HERE, AND THAT
     * ASYMMETRY IS WHAT THE UNMOUNT FLUSH BELOW READS.
     *
     * React runs this cleanup on every dependency change — every keystroke —
     * and the body re-arms immediately afterwards, so a stale handle in the ref
     * lives for the width of one re-render and is then overwritten. On an
     * UNMOUNT the body does not re-run, and a ref that is still non-null means
     * exactly one thing: a window was scheduled and never fired. Nulling it
     * here would erase that distinction, and the flush would have nothing left
     * to test — an unmount would look identical whether the last window had
     * fired or not.
     *
     * `pendingWrite.current = null` therefore belongs to the two places where a
     * window genuinely stops being outstanding: the timer firing, and
     * `settleDraft` cancelling it after the Pod took the text.
     */
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

  /**
   * AN UNMOUNT IS NOT A REASON TO THROW THE LAST 800ms AWAY.
   *
   * Routine rather than exotic: components/studio/studio-shell/studio-shell.tsx flips
   * `view.status` when the Solid session expires and stops rendering the
   * editor, so an expiring token would otherwise take the sentence in progress
   * with it — the loss `docs/decisions.md` §10 names as the whole reason this
   * feature exists.
   *
   * WHY NOT IN THE EFFECT ABOVE'S CLEANUP, which is where it looks as though it
   * belongs: React runs that cleanup on every dependency change, and the
   * dependencies are the form's own fields. Flushing there would write once per
   * keystroke — the debounce deleted, and the autosave turned into the thing it
   * was deliberately written not to be.
   *
   * `[]`, so this cleanup runs only when the component really goes away, and it
   * reads `live.current` rather than its own closure, which is from the first
   * render and knows nothing that has been typed since.
   *
   * DELIBERATELY NOT `pagehide`/`visibilitychange`. Closing a tab does not
   * unmount a React tree, so that half stays open by decision: a tab close
   * costs at most one window of typing, and a listener that fires on every tab
   * switch is a different feature with different failure modes.
   *
   * IT SETS NO STATE. `writeDraft` can report a refusal and there is nowhere
   * left to show it — the component is being destroyed and its `role="note"`
   * line with it. What that line says is that the Pod save is unaffected, which
   * remains true.
   */
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

  /**
   * THE MOMENT THE POD HOLDS THE TEXT, the local copy stops being a backup and
   * becomes a trap: it is now older than the resource, and restoring it later
   * silently reverts an entry that was saved correctly.
   *
   * THE PENDING WINDOW IS CANCELLED FIRST, and that ordering is the whole point
   * of holding the timer in a ref. A save typically finishes well inside 800ms,
   * so a debounce left running would fire just after this clear and write the
   * draft straight back — a draft resurrected from a timer, under the key the
   * next mount reads, offering to restore text the Pod already has.
   *
   * `scope` HERE IS THE KEY THIS EDITOR HAS BEEN WRITING UNDER, NOT THE ONE IT
   * IS ABOUT TO OWN, and on a create those differ. This runs inside the save,
   * so `scope` is the value the render that started the save closed over —
   * `new` — while `nextScope` is where the entry now lives. Clearing
   * `nextScope` instead would remove a key nothing was ever stored under and
   * strand the create's draft under `new` for ever, which is the offer a fresh
   * create form would then get tomorrow.
   *
   * AND WHAT WAS TYPED WHILE THE POD WAS ANSWERING SURVIVES. `save()` snapshots
   * the form before it awaits, so `sent` is what actually reached the Pod;
   * anything typed during the round trip is in neither the Pod nor — once this
   * clear lands — storage, and with `touched` reset nothing would be armed
   * again until the next keystroke. Close the tab on that sentence and it never
   * existed. So when the form has moved on, it is re-kept at once, under the
   * key this editor owns from here on.
   */
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
