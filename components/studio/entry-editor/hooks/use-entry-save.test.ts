// @vitest-environment jsdom
/** The save: what it refuses before sending anything, what it assembles, and
 *  the three values it remembers afterwards so a SECOND save is not a first.
 *  ./notes.md#what-use-entry-save-is-tested-for */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { announce, preconditionFor, useEntrySave } from "./use-entry-save";
import { draftTextOf } from "./use-entry-draft";
import { initialEntryFormState } from "./use-entry-form";
import type { EntrySaveSeed } from "./use-entry-save";
import type { EditorTrip } from "../entry-editor";
import type { EntryFormState } from "../state/actions";
import type { Entry } from "@/lib/pod/schema";
import type { SaveEntryOptions, SaveEntryReport } from "@/lib/pod/save-entry";
import type { StudioSessionLike } from "@/lib/studio/session";

const save = vi.hoisted(() => vi.fn());
const revalidate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pod/save-entry", () => ({ saveEntry: save }));
vi.mock("@/lib/studio/revalidate", () => ({ revalidatePublicSite: revalidate }));

afterEach(cleanup);

const POD = "https://pod.example";
const WEB_ID = "https://owner.example/profile/card#me";
const TRIP: EditorTrip = {
  iri: `${POD}/travel/japan-2026/trip.ttl#it`,
  slug: "japan-2026",
  name: "Japan 2026",
  indexUrl: `${POD}/travel/japan-2026/entries.ttl`,
  entriesContainer: `${POD}/travel/japan-2026/entries/`,
};
const ENTRY_URL = `${POD}/travel/japan-2026/entries/2026-04-11-morning.ttl`;

const session = { fetch: vi.fn(), info: { isLoggedIn: true, webId: WEB_ID } } as unknown as
  StudioSessionLike;

const entry = (over: Partial<Entry> = {}): Entry => ({
  iri: `${ENTRY_URL}#it`,
  slug: "2026-04-11-morning",
  status: "published",
  schemaVersion: 1,
  headline: { value: "Morning in Yanaka", language: "en" },
  trip: TRIP.iri,
  tags: [],
  photos: [],
  ...over,
});

/** A form that would save: a trip, a slug and a headline. `status` is
 *  PUBLISHED rather than the create's own default, so that the draft case below
 *  is a change from it rather than a restatement of it. */
function values(over: Partial<EntryFormState> = {}): EntryFormState {
  return {
    ...initialEntryFormState({ existing: undefined, tripIris: [TRIP.iri] }),
    tripIri: TRIP.iri,
    slug: "2026-04-11-morning",
    headline: "Morning in Yanaka",
    status: "published",
    ...over,
  };
}

const GEO = { lat: 35.69423, long: 139.70348, precisionMeters: 500 };

function seed(over: Partial<EntrySaveSeed> = {}): EntrySaveSeed {
  const v = over.values ?? values();
  return {
    session,
    trips: [TRIP],
    initial: undefined,
    values: v,
    text: draftTextOf(v, []),
    attached: [],
    fuzzed: vi.fn(() => GEO),
    ...over,
  };
}

const report = (over: Partial<SaveEntryReport> = {}): SaveEntryReport => ({
  entryUrl: ENTRY_URL,
  completed: ["entry", "access", "index", "revalidate"],
  recovery: "none",
  etag: '"v2"',
  ...over,
});

/** Props built once, outside the render callback. */
function mount(over: Partial<EntrySaveSeed> = {}) {
  const props = seed(over);
  const rendered = renderHook((p: EntrySaveSeed) => useEntrySave(p), { initialProps: props });
  return { ...rendered, props };
}

/** What actually reached `saveEntry`. */
const sent = () => save.mock.calls[0][0] as SaveEntryOptions;

beforeEach(() => {
  save.mockReset();
  revalidate.mockReset();
  save.mockResolvedValue(report());
});

describe("preconditionFor", () => {
  it("creates with `If-None-Match: *` and updates with the ETag it holds", () => {
    expect(preconditionFor(null)).toEqual({ create: true });
    expect(preconditionFor({ url: ENTRY_URL, etag: '"v1"' })).toEqual({ etag: '"v1"' });
  });

  it("answers `null` for an existing resource with no ETag — there is no third option", () => {
    // Reusing `{ create: true }` is a guaranteed 412 on a resource this editor
    // just wrote, and a blind PUT is a bug (§10).
    expect(preconditionFor({ url: ENTRY_URL, etag: null })).toBeNull();
  });
});

describe("announce — six outcomes, keyed on WHICH STEP failed", () => {
  it("says nothing about the public site on a clean save", () => {
    // Measured: with "and the public site has been refreshed" here, a hook that
    // checked `res.ok` and never read the body passed the test meant to catch it.
    const ok = announce(report(), "published");
    expect(ok.tone).toBe("ok");
    expect(ok.text).toMatch(/refreshed/i);
    const draft = announce(report(), "draft");
    expect(draft.text).toMatch(/readable only by you/i);
    expect(draft.text, "no row appears in the index for a draft").toMatch(/no row/i);
  });

  it("distinguishes a 412 from a write that simply did not arrive", () => {
    const stale = announce(
      report({
        completed: [],
        failed: { step: "entry", error: { kind: "http", url: ENTRY_URL, status: 412 } },
        recovery: "refetch",
      }),
      "published",
    );
    expect(stale.text).toMatch(/no longer what you started from/i);
    expect(stale.text, "'try again' is wrong advice: the same request fails the same").not.toMatch(
      /try again/i,
    );

    const gone = announce(
      report({
        completed: [],
        failed: { step: "entry", error: { kind: "network", url: ENTRY_URL, message: "offline" } },
        recovery: "retry",
      }),
      "published",
    );
    expect(gone.text).toMatch(/try again/i);
  });

  it("separates the two `rebuildIndex` outcomes, which differ in readability", () => {
    const access = announce(
      report({
        completed: ["entry"],
        failed: {
          step: "access",
          error: { kind: "accessUnverified", url: ENTRY_URL, expected: "read", found: "none" },
        },
        recovery: "rebuildIndex",
      }),
      "published",
    );
    const index = announce(
      report({
        completed: ["entry", "access"],
        failed: { step: "index", error: { kind: "http", url: TRIP.indexUrl, status: 412 } },
        recovery: "rebuildIndex",
      }),
      "published",
    );
    expect(access.text).toMatch(/may not be able to read it/i);
    expect(index.text, "invisible, not corrupt").toMatch(/right access/i);
    expect(access.text).not.toBe(index.text);
  });

  it("separates the two `retry` outcomes, which are opposite situations", () => {
    const cache = announce(
      report({
        completed: ["entry", "access", "index"],
        failed: { step: "revalidate", error: { kind: "network", url: "/api/x", message: "no" } },
        recovery: "retry",
      }),
      "published",
    );
    expect(cache.text, "everything written; only the cache is behind").toMatch(/cache/i);
    expect(cache.detail, "the technical detail is carried underneath").toBeDefined();
  });
});

describe("useEntrySave — what it refuses before anything is sent", () => {
  it("names every missing field, and sends nothing", async () => {
    const { result } = mount({ values: values({ tripIri: "", slug: "", headline: "" }) });
    await act(async () => {
      await result.current.save(vi.fn());
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.outcome?.text).toMatch(/a trip, a slug, a headline/);
    expect(result.current.outcome?.text).toMatch(/Nothing has been sent/i);
  });

  it("refuses an existing resource with no ETag rather than saving blind", async () => {
    const { result } = mount({ initial: { entry: entry(), etag: null } });
    await act(async () => {
      await result.current.save(vi.fn());
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.outcome?.text).toMatch(/did not return a version tag/i);
  });
});

describe("useEntrySave — what it assembles", () => {
  it("addresses a create from the trip's container and the slug", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.save(vi.fn());
    });
    expect(sent().entry.iri).toBe(`${ENTRY_URL}#it`);
    expect(sent().precondition).toEqual({ create: true });
    expect(sent().indexUrl).toBe(TRIP.indexUrl);
    expect(sent().webId).toBe(WEB_ID);
  });

  it("shares ONE instant with the index, and invents `created` only on a create", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.save(vi.fn());
    });
    const stamp = sent().now?.();
    expect(stamp).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(sent().entry.created).toBe(stamp);
    expect(sent().entry.datePublished, "published, so it became public now").toBe(stamp);
  });

  it("never gives an older entry a `created` it does not have", async () => {
    const { result } = mount({ initial: { entry: entry({ created: undefined }), etag: '"v1"' } });
    await act(async () => {
      await result.current.save(vi.fn());
    });
    expect(sent().entry.created, "that would claim the record came into being today").toBe(
      undefined,
    );
  });

  it("leaves `datePublished` unset while the entry is a draft", async () => {
    const { result } = mount({ values: values({ status: "draft" }) });
    await act(async () => {
      await result.current.save(vi.fn());
    });
    expect(sent().entry.datePublished).toBeUndefined();
  });

  it("concatenates the two time controls, and writes no timestamp for an empty clock", async () => {
    const { result } = mount({
      values: values({ occurred: "2026-04-11T07:05", offset: "+09:00" }),
    });
    await act(async () => {
      await result.current.save(vi.fn());
    });
    expect(sent().entry.occurredAt).toBe("2026-04-11T07:05:00+09:00");

    save.mockClear();
    const empty = mount({ values: values({ occurred: "", offset: "+09:00" }) });
    await act(async () => {
      await empty.result.current.save(vi.fn());
    });
    expect(sent().entry.occurredAt).toBeUndefined();
  });

  it("fuzzes a WHOLE pair, and treats half a pair as nothing typed (ruling F-A)", async () => {
    const fuzzed = vi.fn(() => GEO);
    const whole = mount({ values: values({ lat: "35.6938", long: "139.7034" }), fuzzed });
    await act(async () => {
      await whole.result.current.save(vi.fn());
    });
    expect(fuzzed).toHaveBeenCalledWith({ lat: 35.6938, long: 139.7034 });
    expect(sent().entry.place?.geo).toEqual(GEO);

    // `Number("")` is 0, so one typed latitude composes a point that is finite,
    // in range, and therefore published — inland France, on land.
    save.mockClear();
    const half = vi.fn(() => GEO);
    const one = mount({ values: values({ lat: "35.6938", long: "" }), fuzzed: half });
    await act(async () => {
      await one.result.current.save(vi.fn());
    });
    expect(half).not.toHaveBeenCalled();
    expect(sent().entry.place?.geo).toBeUndefined();
  });

  it("carries the STORED geometry through when neither box was typed in", async () => {
    const pinned = entry({ place: { name: { value: "Yanaka", language: "en" }, geo: GEO } });
    const fuzzed = vi.fn(() => undefined);
    const { result } = mount({ initial: { entry: pinned, etag: '"v1"' }, fuzzed });
    await act(async () => {
      await result.current.save(vi.fn());
    });
    // Re-snapping a stored pair walks the pin on every save.
    expect(fuzzed).not.toHaveBeenCalled();
    expect(sent().entry.place?.geo).toEqual(GEO);
  });

  it("appends the picked photos to the ones the entry arrived with", async () => {
    const carried = { contentUrl: `${POD}/travel/media/old/web.jpg`, sortOrder: 1 };
    const picked = { contentUrl: `${POD}/travel/media/new/web.jpg`, sortOrder: 1 };
    const { result } = mount({
      initial: { entry: entry({ photos: [carried] }), etag: '"v1"' },
      attached: [picked],
    });
    await act(async () => {
      await result.current.save(vi.fn());
    });
    expect(sent().entry.photos.map((p) => p.contentUrl)).toEqual([
      carried.contentUrl,
      picked.contentUrl,
    ]);
  });

  it("parses the tags, drops an empty story, and carries the original creator", async () => {
    const older = entry({ creator: "https://someone.example/card#me" });
    const { result } = mount({
      initial: { entry: older, etag: '"v1"' },
      values: values({ tagsText: " walking , morning ,, ", story: "   " }),
    });
    await act(async () => {
      await result.current.save(vi.fn());
    });
    expect(sent().entry.tags).toEqual(["walking", "morning"]);
    expect(sent().entry.articleBody).toBeUndefined();
    expect(sent().entry.creator).toBe("https://someone.example/card#me");
  });
});

describe("useEntrySave — what it remembers afterwards", () => {
  it("settles the draft and moves the target the moment STEP 1 completed", async () => {
    const settle = vi.fn();
    const { result, props } = mount();
    await act(async () => {
      await result.current.save(settle);
    });
    expect(settle).toHaveBeenCalledWith(props.text, ENTRY_URL);
    expect(result.current.target).toEqual({ url: ENTRY_URL, etag: '"v2"' });
    expect(result.current.addressFixed).toBe(true);
  });

  it("settles it even when a LATER step failed, because the text is on the Pod", async () => {
    save.mockResolvedValue(
      report({
        completed: ["entry"],
        failed: { step: "index", error: { kind: "http", url: TRIP.indexUrl, status: 412 } },
        recovery: "rebuildIndex",
      }),
    );
    const settle = vi.fn();
    const { result } = mount();
    await act(async () => {
      await result.current.save(settle);
    });
    expect(settle).toHaveBeenCalled();
  });

  it("keeps the draft when step 1 itself failed — it is what survives the reload", async () => {
    save.mockResolvedValue(
      report({
        completed: [],
        failed: { step: "entry", error: { kind: "http", url: ENTRY_URL, status: 412 } },
        recovery: "refetch",
      }),
    );
    const settle = vi.fn();
    const { result } = mount();
    await act(async () => {
      await result.current.save(settle);
    });
    expect(settle).not.toHaveBeenCalled();
    expect(result.current.target, "nothing reached the Pod, so nothing moved").toBeNull();
  });

  it("carries `created` and `datePublished` into the SECOND save of one create", async () => {
    // Measured with a throwaway probe before `provenance` existed: the second
    // PUT carried no `dcterms:created` at all.
    const { result } = mount();
    await act(async () => {
      await result.current.save(vi.fn());
    });
    const first = sent().entry;
    save.mockClear();
    save.mockResolvedValue(report());
    await act(async () => {
      await result.current.save(vi.fn());
    });
    expect(sent().entry.created).toBe(first.created);
    expect(sent().entry.datePublished).toBe(first.datePublished);
    expect(sent().precondition, "an update now, with the ETag that came back").toEqual({
      etag: '"v2"',
    });
  });

  it("reports `saving` while it is in flight and clears it even on a throw", async () => {
    let release: (r: SaveEntryReport) => void = () => {};
    save.mockReturnValue(
      new Promise<SaveEntryReport>((resolve) => {
        release = resolve;
      }),
    );
    const { result } = mount();
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = result.current.save(vi.fn());
    });
    expect(result.current.saving).toBe(true);
    await act(async () => {
      release(report());
      await pending;
    });
    expect(result.current.saving).toBe(false);

    save.mockRejectedValue(new Error("the fetch blew up"));
    await act(async () => {
      await result.current.save(vi.fn());
    });
    expect(result.current.saving).toBe(false);
    expect(result.current.outcome?.text, "what reached your Pod is UNKNOWN").toMatch(
      /stopped unexpectedly/i,
    );
    expect(result.current.outcome?.detail).toBe("the fetch blew up");
  });
});
