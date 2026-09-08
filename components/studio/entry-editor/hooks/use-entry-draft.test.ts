// @vitest-environment jsdom
/** The local copy: what arms the debounce, what cancels it, what an unmount
 *  flushes, and the two refs that exist because StrictMode double-invokes.
 *  ./notes.md#what-use-entry-draft-is-tested-for */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { DRAFT_DEBOUNCE_MS, browserStorage, draftTextOf, useEntryDraft } from "./use-entry-draft";
import { initialEntryFormState } from "./use-entry-form";
import { draftKey } from "@/lib/studio/drafts";
import type { DraftText, EntryDraftSeed } from "./use-entry-draft";
import type { Photo } from "@/lib/pod/schema";
import type { StorageLike } from "@/lib/studio/drafts";

afterEach(cleanup);

const WEB_ID = "https://owner.example/profile/card#me";
const ENTRY_URL = "https://pod.example/travel/japan-2026/entries/a.ttl";

/** A storage that records, and can be made to refuse the way Safari private
 *  mode does: a zero quota, throwing on the very first `setItem`. */
function fakeStorage(over: { refuse?: boolean } = {}) {
  const map = new Map<string, string>();
  const calls: Array<{ key: string; value: string }> = [];
  const removed: string[] = [];
  const store: StorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      calls.push({ key, value });
      if (over.refuse) throw new DOMException("quota", "QuotaExceededError");
      map.set(key, value);
    },
    removeItem: (key) => {
      removed.push(key);
      map.delete(key);
    },
  };
  return { store, map, calls, removed };
}

const photo = (hash: string): Photo => ({
  contentUrl: `https://pod.example/travel/media/${hash}/web.jpg`,
  sortOrder: 1,
});

function text(over: Partial<DraftText> = {}): DraftText {
  return {
    ...draftTextOf(initialEntryFormState({ existing: undefined, tripIris: [] }), []),
    slug: "2026-04-11-morning",
    headline: "Morning in Yanaka",
    ...over,
  };
}

function seed(over: Partial<EntryDraftSeed> = {}): EntryDraftSeed {
  return {
    storage: fakeStorage().store,
    webId: WEB_ID,
    entryUrl: undefined,
    text: text(),
    ...over,
  };
}

/** Props built ONCE, outside the render callback: a fresh `text` per render
 *  restarts the debounce for ever. ./notes.md#why-the-seed-is-built-outside-the-render-callback */
function mount(over: Partial<EntryDraftSeed> = {}, options: { strict?: boolean } = {}) {
  const props = seed(over);
  const rendered = renderHook((p: EntryDraftSeed) => useEntryDraft(p), {
    initialProps: props,
    ...(options.strict === true ? { wrapper: StrictMode } : {}),
  });
  let held = props;
  return {
    ...rendered,
    /** SOMEBODY TYPED: the ref armed AND the form moved, in one event, because
     *  it has to be both. ./notes.md#marktouched-alone-arms-nothing */
    type(over2: Partial<DraftText>) {
      act(() => {
        rendered.result.current.markTouched();
      });
      held = { ...held, text: { ...held.text, ...over2 } };
      rendered.rerender(held);
    },
    /** The props as they stand, for a `rerender` that changes nothing else. */
    held: () => held,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("draftTextOf", () => {
  it("carries the sixteen fields and nothing the reducer holds beyond them", () => {
    const values = initialEntryFormState({ existing: undefined, tripIris: [] });
    const projected = draftTextOf(values, [photo("aa")]);
    expect(Object.keys(projected).sort()).toEqual(
      [
        "country",
        "headline",
        "lat",
        "locality",
        "long",
        "mode",
        "occurred",
        "offset",
        "photos",
        "placeName",
        "precision",
        "slug",
        "status",
        "story",
        "tagsText",
        "tripIri",
      ].sort(),
    );
    // `slots` and the three credits are the reducer's and must not reach a
    // stored draft: a slot holds no URL until it settles.
    expect(projected).not.toHaveProperty("slots");
    expect(projected).not.toHaveProperty("coordinateAuthor");
    expect(projected).not.toHaveProperty("offsetGuess");
  });

  it("takes the photos from the READY list rather than from the slots", () => {
    const values = initialEntryFormState({ existing: undefined, tripIris: [] });
    expect(
      draftTextOf({ ...values, slots: [{ key: "photo-0", name: "a.jpg", state: "decoding" }] }, [])
        .photos,
    ).toEqual([]);
  });
});

describe("useEntryDraft — the debounce", () => {
  it("writes nothing until the form has been touched, however long it waits", async () => {
    const storage = fakeStorage();
    const editor = mount({ storage: storage.store });
    // The form MOVES — the editor is being read, not typed into — and the ref
    // is what keeps the window shut.
    editor.rerender({ ...editor.held(), text: text({ headline: "Loaded" }) });
    await act(async () => {
      vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS * 5);
    });
    // The effect fires on mount, so without the `touched` guard the editor
    // would store a copy of whatever it opened with — and offer it back.
    expect(storage.calls).toHaveLength(0);
  });

  it("writes nothing before the interval elapses, and exactly one draft after it", async () => {
    const storage = fakeStorage();
    const editor = mount({ storage: storage.store });
    editor.type({ headline: "Morning in Yanaka, again" });
    await act(async () => {
      vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS - 1);
    });
    expect(storage.calls, "not before the window closes").toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(storage.calls, "and exactly one after it").toHaveLength(1);
  });

  it("stamps `savedAt` with an offset, and writes under the CREATE key", async () => {
    const storage = fakeStorage();
    const editor = mount({ storage: storage.store });
    editor.type({ headline: "Typed" });
    await act(async () => {
      vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS);
    });
    expect(storage.calls[0].key).toBe(draftKey({ webId: WEB_ID, scope: "new" }));
    const stamped = JSON.parse(storage.calls[0].value) as { savedAt: string };
    expect(stamped.savedAt).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it("keys on the entry's own URL from the moment there is one", async () => {
    const storage = fakeStorage();
    const editor = mount({ storage: storage.store, entryUrl: ENTRY_URL });
    editor.type({ headline: "Typed" });
    await act(async () => {
      vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS);
    });
    expect(storage.calls[0].key).toBe(draftKey({ webId: WEB_ID, scope: ENTRY_URL }));
  });

  it("keeps trying on later windows after storage refuses once", async () => {
    const storage = fakeStorage({ refuse: true });
    const editor = mount({ storage: storage.store });
    editor.type({ headline: "One" });
    await act(async () => {
      vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS);
    });
    expect(editor.result.current.storageRefused).toBe(true);
    editor.type({ headline: "Two" });
    await act(async () => {
      vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS);
    });
    expect(storage.calls.length, "the note appears once; the attempts continue").toBe(2);
  });

  it("does nothing at all with nobody signed in — nobody's draft is anybody's", async () => {
    const storage = fakeStorage();
    const editor = mount({ storage: storage.store, webId: undefined });
    editor.type({ headline: "Typed" });
    await act(async () => {
      vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS);
    });
    expect(storage.calls).toHaveLength(0);
    expect(editor.result.current.offered).toBeNull();
    expect(editor.result.current.storageRefused).toBe(false);
  });

  it("answers `null` when the `localStorage` PROPERTY READ itself throws", () => {
    // Not the call — the property read. Some embedded browsers raise a
    // SecurityError before any method is reached, and an editor that fell over
    // on that would be one the owner cannot open at all.
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      expect(browserStorage()).toBeNull();
    } finally {
      if (original !== undefined) Object.defineProperty(globalThis, "localStorage", original);
    }
  });
});

describe("useEntryDraft — the offer", () => {
  const stored = (over: Partial<DraftText> = {}) =>
    JSON.stringify({ ...text(over), savedAt: "2026-04-11T07:05:00+09:00" });

  it("offers what the browser kept, once, and only from an effect", () => {
    const storage = fakeStorage();
    storage.map.set(draftKey({ webId: WEB_ID, scope: "new" }), stored({ headline: "Kept" }));
    const { result } = mount({ storage: storage.store });
    expect(result.current.offered?.headline).toBe("Kept");
  });

  it("reads storage ONCE under StrictMode, which invokes the effect twice", () => {
    const storage = fakeStorage();
    const key = draftKey({ webId: WEB_ID, scope: "new" });
    storage.map.set(key, stored());
    const reads: string[] = [];
    const spied: StorageLike = {
      ...storage.store,
      getItem: (k) => {
        reads.push(k);
        return storage.store.getItem(k);
      },
    };
    mount({ storage: spied }, { strict: true });
    // The ref is what makes it one look. Without it a re-offer reads, from the
    // owner's side, as a dismissal that does not work.
    expect(reads.filter((k) => k === key)).toHaveLength(1);
  });

  it("does not re-offer after the owner discards, even on a re-render", () => {
    const storage = fakeStorage();
    const key = draftKey({ webId: WEB_ID, scope: "new" });
    storage.map.set(key, stored());
    const props = seed({ storage: storage.store });
    const { result, rerender } = renderHook((p: EntryDraftSeed) => useEntryDraft(p), {
      initialProps: props,
    });
    expect(result.current.offered).not.toBeNull();
    act(() => {
      result.current.discard();
    });
    expect(result.current.offered).toBeNull();
    expect(storage.removed, "GONE rather than hidden — a hidden one comes back").toContain(key);
    rerender(props);
    expect(result.current.offered).toBeNull();
  });

  it("clears the banner without clearing storage when the owner RESTORES", () => {
    const storage = fakeStorage();
    const key = draftKey({ webId: WEB_ID, scope: "new" });
    storage.map.set(key, stored());
    const { result } = mount({ storage: storage.store });
    act(() => {
      result.current.clearOffer();
    });
    expect(result.current.offered).toBeNull();
    expect(storage.removed).not.toContain(key);
  });
});

describe("useEntryDraft — settling, once the Pod holds the text", () => {
  it("cancels the window in flight, so no timer resurrects the draft", async () => {
    const storage = fakeStorage();
    const editor = mount({ storage: storage.store });
    editor.type({ headline: "In flight" });
    const sent = editor.held().text;
    act(() => {
      editor.result.current.settleDraft(sent, ENTRY_URL);
    });
    await act(async () => {
      vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS * 3);
    });
    expect(storage.calls, "a debounce left running writes it straight back").toHaveLength(0);
    expect(storage.removed).toContain(draftKey({ webId: WEB_ID, scope: "new" }));
  });

  it("re-keeps what was typed WHILE the Pod was answering, under the new key", async () => {
    const storage = fakeStorage();
    const sent = text({ headline: "As sent" });
    const { result, rerender } = renderHook((p: EntryDraftSeed) => useEntryDraft(p), {
      initialProps: seed({ storage: storage.store, text: sent }),
    });
    // The round trip happened, and a keystroke landed inside it.
    const typed = text({ headline: "Typed during the save" });
    rerender(seed({ storage: storage.store, text: typed }));
    act(() => {
      result.current.settleDraft(sent, ENTRY_URL);
    });
    const written = storage.calls.at(-1);
    expect(written?.key, "the key this editor owns from here on").toBe(
      draftKey({ webId: WEB_ID, scope: ENTRY_URL }),
    );
    expect(JSON.parse(written?.value ?? "{}")).toMatchObject({
      headline: "Typed during the save",
    });
  });

  it("keeps nothing when the form still equals what was sent", () => {
    const storage = fakeStorage();
    const sent = text();
    const { result } = renderHook((p: EntryDraftSeed) => useEntryDraft(p), {
      initialProps: seed({ storage: storage.store, text: sent }),
    });
    act(() => {
      result.current.settleDraft({ ...sent }, ENTRY_URL);
    });
    expect(storage.calls, "the Pod holds exactly what is on the screen").toHaveLength(0);
  });

  it("counts a photo attached during the round trip as a difference", () => {
    const storage = fakeStorage();
    const sent = text({ photos: [] });
    const { result, rerender } = renderHook((p: EntryDraftSeed) => useEntryDraft(p), {
      initialProps: seed({ storage: storage.store, text: sent }),
    });
    rerender(seed({ storage: storage.store, text: text({ photos: [photo("bb")] }) }));
    act(() => {
      result.current.settleDraft(sent, ENTRY_URL);
    });
    // Bytes already on the Pod, about to be referenced by nothing at all.
    expect(storage.calls).toHaveLength(1);
  });
});

describe("useEntryDraft — the unmount flush", () => {
  it("keeps the last window's typing when the editor goes away mid-debounce", () => {
    const storage = fakeStorage();
    const editor = mount({ storage: storage.store });
    editor.type({ headline: "Half a sentence" });
    editor.unmount();
    expect(JSON.parse(storage.calls.at(-1)?.value ?? "{}")).toMatchObject({
      headline: "Half a sentence",
    });
  });

  it("writes nothing when no window was outstanding", () => {
    const storage = fakeStorage();
    const editor = mount({ storage: storage.store });
    editor.unmount();
    // Writing here resurrects a draft the Pod has already made redundant.
    expect(storage.calls).toHaveLength(0);
  });

  it("flushes what is on the form NOW, not what it mounted with", async () => {
    const storage = fakeStorage();
    const editor = mount({ storage: storage.store, text: text({ headline: "At mount" }) });
    editor.type({ headline: "Typed once" });
    editor.rerender({ ...editor.held(), text: text({ headline: "Typed later" }) });
    editor.unmount();
    expect(JSON.parse(storage.calls.at(-1)?.value ?? "{}")).toMatchObject({
      headline: "Typed later",
    });
  });
});
