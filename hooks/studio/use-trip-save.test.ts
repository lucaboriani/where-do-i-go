// @vitest-environment jsdom
/**
 * `use-trip-save` — Task 3.3, RED: hooks/studio/use-trip-save.ts does not
 * exist yet. Its two deps (`@/lib/pod/save-trip`, `@/lib/studio/revalidate`)
 * already exist and are module-mocked, exactly as `use-publish.test.ts` mocks
 * them; the hook loads through a non-literal specifier so a missing module
 * fails one test, not the whole file.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { SCHEMA_VERSION } from "@/lib/vocab";
import type { SaveTripReport } from "@/lib/pod/save-trip";
import type { Trip } from "@/lib/pod/schema";
import type { StudioSessionLike } from "@/lib/studio/session";
import type { TripFormState } from "./use-trip-form";

/* ══════════════════════════════════════════════ mock: the two dependencies ══ */

const saveTripMock = vi.hoisted(() => vi.fn());
const revalidateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/pod/save-trip", () => ({ saveTrip: saveTripMock }));
vi.mock("@/lib/studio/revalidate", () => ({ revalidatePublicSite: revalidateMock }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ══════════════════════════════════════════════ loading the module under test ══ */

const importModule = (specifier: string): Promise<unknown> =>
  import(/* @vite-ignore */ specifier);

/**
 * THE SHAPE PINNED HERE. `target`/`addressFixed` mirror `use-entry-save`'s own
 * pair — once a create completes, the slug is fixed, exactly like an entry's
 * address (§10). `saved` is what makes a completed save reportable: the
 * caller (the `/studio/trips/new` route) needs the slug to navigate to.
 */
export type TripSaveTarget = { url: string; etag: string | null };
export type TripSaveOutcome = { tone: "ok" | "problem"; text: string; detail?: string };

export interface TripSaveSeed {
  session: StudioSessionLike;
  podRoot: string;
  /** Absent means CREATE. Present means EDIT, from THE READ THAT PRODUCED
   *  THIS STATE (§10) — `null` when the server sent no ETag. */
  initial?: { trip: Trip; etag: string | null };
  values: TripFormState;
}

export interface TripSave {
  target: TripSaveTarget | null;
  addressFixed: boolean;
  outcome: TripSaveOutcome | null;
  saving: boolean;
  saved: Trip | null;
  save: () => Promise<void>;
}

async function loadUseTripSave(): Promise<(seed: TripSaveSeed) => TripSave> {
  const mod = (await importModule("@/hooks/studio/use-trip-save").catch((cause: unknown) => {
    throw new Error(
      "hooks/studio/use-trip-save.ts does not exist yet — this is the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as { useTripSave?: unknown };
  if (typeof mod.useTripSave !== "function") {
    throw new Error(
      "hooks/studio/use-trip-save.ts exists but exports no useTripSave — still the red step.",
    );
  }
  return mod.useTripSave as (seed: TripSaveSeed) => TripSave;
}

/* ══════════════════════════════════════════════════════════════════ fixtures ══ */

const POD = "https://pod.example/";
const WEB_ID = "https://owner.example/profile/card#me";

const session = {
  fetch: vi.fn(),
  info: { isLoggedIn: true, webId: WEB_ID },
} as unknown as StudioSessionLike;

/** A form that would save: a name and a slug. Everything else is the reducer's
 *  own empty default — save must not require them. */
function values(over: Partial<TripFormState> = {}): TripFormState {
  return {
    slug: "japan-2026",
    name: "Japan 2026",
    startDate: "",
    endDate: "",
    description: "",
    tagsText: "",
    coverImage: "",
    status: "draft",
    ...over,
  };
}

const trip = (over: Partial<Trip> = {}): Trip => ({
  iri: `${POD}travel/trips/japan-2026/trip.ttl#it`,
  slug: "japan-2026",
  status: "draft",
  schemaVersion: SCHEMA_VERSION,
  name: { value: "Japan 2026", language: "en" },
  tags: [],
  ...over,
});

function seed(over: Partial<TripSaveSeed> = {}): TripSaveSeed {
  return { session, podRoot: POD, initial: undefined, values: values(), ...over };
}

const report = (over: Partial<SaveTripReport> = {}): SaveTripReport => ({
  tripUrl: `${POD}travel/trips/japan-2026/trip.ttl`,
  completed: ["container", "trip", "index", "entriesContainer"],
  recovery: "none",
  etag: '"v1"',
  ...over,
});

function mount(over: Partial<TripSaveSeed> = {}) {
  const props = seed(over);
  const useTripSaveP = loadUseTripSave();
  return useTripSaveP.then((useTripSave) => {
    const rendered = renderHook((p: TripSaveSeed) => useTripSave(p), { initialProps: props });
    return { ...rendered, props };
  });
}

/** What actually reached `saveTrip`. */
const sent = () => saveTripMock.mock.calls[0][0] as { trip: Trip; etag?: string; podRoot: string };

/* ══════════════════════════════════════════ what it refuses before sending ══ */

describe("useTripSave — what it refuses before anything is sent", () => {
  it("names a missing name and slug, and sends nothing", async () => {
    saveTripMock.mockResolvedValue(report());
    const { result } = await mount({ values: values({ name: "", slug: "" }) });
    await act(async () => {
      await result.current.save();
    });
    expect(saveTripMock).not.toHaveBeenCalled();
    expect(result.current.outcome?.tone).toBe("problem");
    expect(result.current.outcome?.text).toMatch(/a name/i);
    expect(result.current.outcome?.text).toMatch(/a slug/i);
    expect(result.current.outcome?.text).toMatch(/nothing has been sent/i);
  });

  it("saves once both a name and a slug are present — the allow-case", async () => {
    saveTripMock.mockResolvedValue(report());
    const { result } = await mount();
    await act(async () => {
      await result.current.save();
    });
    expect(saveTripMock).toHaveBeenCalled();
  });

  it("refuses an existing trip with no ETag rather than saving blind", async () => {
    saveTripMock.mockResolvedValue(report());
    const { result } = await mount({ initial: { trip: trip(), etag: null } });
    await act(async () => {
      await result.current.save();
    });
    expect(saveTripMock).not.toHaveBeenCalled();
    expect(result.current.outcome?.text).toMatch(/did not return a version tag/i);
  });
});

/* ══════════════════════════════════════════════════ create vs update ══ */

describe("useTripSave — create vs update", () => {
  it("creates when there is no initial trip: no etag on the request, `addressFixed` false beforehand", async () => {
    saveTripMock.mockResolvedValue(report());
    const { result } = await mount();
    expect(result.current.addressFixed, "nothing saved yet, so the slug is still free to change").toBe(
      false,
    );

    await act(async () => {
      await result.current.save();
    });

    expect(sent().etag, "a create must never carry a stale etag").toBeUndefined();
    expect(sent().trip.slug).toBe("japan-2026");
    expect(sent().podRoot).toBe(POD);
  });

  it("updates with the loaded etag when editing an existing trip", async () => {
    saveTripMock.mockResolvedValue(report({ etag: '"v2"' }));
    const { result } = await mount({ initial: { trip: trip(), etag: '"v1"' } });
    expect(result.current.addressFixed, "an existing trip's container cannot move").toBe(true);

    await act(async () => {
      await result.current.save();
    });

    expect(sent().etag).toBe('"v1"');
  });

  it("moves the target and reports the saved trip once step 1 completes", async () => {
    saveTripMock.mockResolvedValue(report({ etag: '"v2"' }));
    const { result } = await mount();
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.target).toEqual({
      url: `${POD}travel/trips/japan-2026/trip.ttl`,
      etag: '"v2"',
    });
    expect(result.current.addressFixed, "the slug is fixed the moment the trip exists").toBe(true);
    expect(result.current.saved?.slug).toBe("japan-2026");
    expect(result.current.outcome?.tone).toBe("ok");
  });

  it("carries the etag forward, so a SECOND save is an update rather than a second create", async () => {
    saveTripMock.mockResolvedValue(report({ etag: '"v2"' }));
    const { result } = await mount();
    await act(async () => {
      await result.current.save();
    });
    saveTripMock.mockClear();
    saveTripMock.mockResolvedValue(report({ etag: '"v3"' }));
    await act(async () => {
      await result.current.save();
    });
    expect(sent().etag, "the second save must carry the etag the first one returned").toBe('"v2"');
  });
});

/* ══════════════════════════════════════ the two different meanings of 412 ══ */

describe("useTripSave — a 412 means something different on each path", () => {
  it("on a CREATE, a 412 reads as the slug already being taken", async () => {
    saveTripMock.mockResolvedValue(
      report({
        completed: [],
        failed: {
          step: "trip",
          error: { kind: "http", url: `${POD}travel/trips/japan-2026/trip.ttl`, status: 412 },
        },
        recovery: "refetch",
      }),
    );
    const { result } = await mount();
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.outcome?.tone).toBe("problem");
    expect(result.current.outcome?.text).toMatch(/already taken/i);
    expect(result.current.outcome?.text).toMatch(/slug/i);
    // Not the update wording — the two must read as different situations.
    expect(result.current.outcome?.text).not.toMatch(/no longer what you started from/i);
    expect(result.current.saved, "a failed create saved nothing").toBeNull();
  });

  it("on an UPDATE, a 412 reads as stale — refetch, not 'slug taken'", async () => {
    saveTripMock.mockResolvedValue(
      report({
        completed: [],
        failed: {
          step: "trip",
          error: { kind: "http", url: `${POD}travel/trips/japan-2026/trip.ttl`, status: 412 },
        },
        recovery: "refetch",
      }),
    );
    const { result } = await mount({ initial: { trip: trip(), etag: '"v1"' } });
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.outcome?.text).toMatch(/no longer what you started from/i);
    expect(
      result.current.outcome?.text,
      "the update path must not claim a slug collision — nothing about this trip's slug changed",
    ).not.toMatch(/already taken/i);
  });
});

/* ══════════════════════════════════════════════════════════ in-flight state ══ */

describe("useTripSave — `saving`, and what survives a throw", () => {
  it("reports `saving` while in flight and clears it even when saveTrip throws", async () => {
    let release: (r: SaveTripReport) => void = () => {};
    saveTripMock.mockReturnValue(
      new Promise<SaveTripReport>((resolve) => {
        release = resolve;
      }),
    );
    const { result } = await mount();
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = result.current.save();
    });
    expect(result.current.saving).toBe(true);
    await act(async () => {
      release(report());
      await pending;
    });
    expect(result.current.saving).toBe(false);

    saveTripMock.mockRejectedValue(new Error("the fetch blew up"));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.saving).toBe(false);
    expect(result.current.outcome?.tone).toBe("problem");
    expect(result.current.outcome?.detail).toBe("the fetch blew up");
  });

  it("passes the injected revalidatePublicSite through by identity", async () => {
    saveTripMock.mockResolvedValue(report());
    const { result } = await mount({ initial: { trip: trip(), etag: '"v1"' } });
    await act(async () => {
      await result.current.save();
    });
    expect(saveTripMock.mock.calls[0][0].revalidate).toBe(revalidateMock);
  });
});
