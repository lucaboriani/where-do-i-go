// @vitest-environment jsdom

/**
 * `use-studio-trips` — Task 3.2, RED: use-studio-trips.ts does not exist.
 * Its three deps (`@/lib/studio/trips`, `@/lib/pod/read`,
 * `@/lib/pod/bootstrap`) already exist and are module-mocked; the hook
 * loads through a non-literal specifier, as `use-publish.test.ts` does.
 */

/**
 * TWO CHOICES PINNED HERE: entryCount comes from
 * `readTripIndex(trip.indexUrl).entryCount` (§7.4), one read per trip; and
 * `ensurePodInitialised` runs from HERE, once, before `listStudioTrips` —
 * FINDING #3: `saveTrip` skips it, so a blank Pod needs it done first.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { PodError, Result } from "@/lib/pod/result";
import type { StudioTrip, StudioTripListing } from "@/lib/studio/trips";
import type { TripIndex } from "@/lib/pod/schema";
import type { StudioSessionLike } from "@/lib/studio/session";

/* ══════════════════════════════════ mock: the three existing dependencies ══ */

const listStudioTripsMock = vi.hoisted(() => vi.fn());
const readTripIndexMock = vi.hoisted(() => vi.fn());
const ensurePodInitialisedMock = vi.hoisted(() => vi.fn());
/** Call order across the three mocks — what pins "bootstrap before listing"
 *  without a timing-sensitive assertion. */
const order = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/studio/trips", () => ({
  listStudioTrips: (...args: unknown[]) => {
    order.push("listStudioTrips");
    return listStudioTripsMock(...args);
  },
}));
vi.mock("@/lib/pod/read", () => ({
  readTripIndex: (...args: unknown[]) => {
    order.push("readTripIndex");
    return readTripIndexMock(...args);
  },
}));
vi.mock("@/lib/pod/bootstrap", () => ({
  ensurePodInitialised: (...args: unknown[]) => {
    order.push("ensurePodInitialised");
    return ensurePodInitialisedMock(...args);
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  order.length = 0;
});

/* ══════════════════════════════════════════════ loading the module under test ══ */

const importModule = (specifier: string): Promise<unknown> =>
  import(/* @vite-ignore */ specifier);

type StudioTripRow = StudioTrip & { entryCount: number };

type StudioTripsState =
  | { status: "pending" }
  | { status: "ready"; trips: StudioTripRow[]; skipped: StudioTripListing["skipped"] }
  | { status: "failed"; error: PodError };

interface StudioTripsSeed {
  session: StudioSessionLike;
  podRoot: string;
}

async function loadUseStudioTrips(): Promise<(seed: StudioTripsSeed) => StudioTripsState> {
  const mod = (await importModule("@/hooks/studio/use-studio-trips").catch((cause: unknown) => {
    throw new Error(
      "hooks/studio/use-studio-trips.ts does not exist yet — this is the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as { useStudioTrips?: unknown };
  if (typeof mod.useStudioTrips !== "function") {
    throw new Error(
      "hooks/studio/use-studio-trips.ts exists but exports no useStudioTrips — still the red step.",
    );
  }
  return mod.useStudioTrips as (seed: StudioTripsSeed) => StudioTripsState;
}

/* ══════════════════════════════════════════════════════════════ fixtures ══ */

const POD = "https://pod.example/";
const WEB_ID = "https://owner.example/profile/card#me";
const TRIPS_URL = `${POD}travel/trips/`;

const session = {
  fetch: vi.fn(globalThis.fetch),
  info: { isLoggedIn: true, webId: WEB_ID },
} as unknown as StudioSessionLike;

function studioTrip(slug: string, status: "draft" | "published"): StudioTrip {
  return {
    iri: `${POD}travel/trips/${slug}/trip.ttl#it`,
    slug,
    name: slug,
    indexUrl: `${POD}travel/trips/${slug}/entries.ttl`,
    entriesContainer: `${POD}travel/trips/${slug}/entries/`,
    status,
  };
}

const JAPAN = studioTrip("japan", "published");
const PATAGONIA = studioTrip("patagonia", "draft");

function tripIndex(url: string, entryCount: number): TripIndex {
  return { iri: `${url}#it`, schemaVersion: 2, entryCount, entries: [] };
}

/** `ensurePodInitialised` succeeds unless a test overrides it. */
function okBootstrap() {
  ensurePodInitialisedMock.mockResolvedValue({ ok: true, value: undefined } satisfies Result<void>);
}

/* ═══════════════════════════════════════════════════════════════ the read ══ */

describe("useStudioTrips", () => {
  it("starts pending, before listStudioTrips has settled", () => {
    okBootstrap();
    listStudioTripsMock.mockReturnValue(new Promise(() => {})); // never settles
    return loadUseStudioTrips().then((useStudioTrips) => {
      const { result } = renderHook(() => useStudioTrips({ session, podRoot: POD }));
      expect(result.current.status).toBe("pending");
    });
  });

  it("resolves to ready with each trip's status carried through and its entryCount read from its own index", async () => {
    okBootstrap();
    listStudioTripsMock.mockResolvedValue({
      ok: true,
      value: { trips: [JAPAN, PATAGONIA], skipped: [] },
    } satisfies Result<StudioTripListing>);
    readTripIndexMock.mockImplementation(async (url: string) => {
      const count = url === JAPAN.indexUrl ? 3 : 0;
      return { ok: true, value: tripIndex(url, count) };
    });

    const useStudioTrips = await loadUseStudioTrips();
    const { result } = renderHook(() => useStudioTrips({ session, podRoot: POD }));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") return;

    const japan = result.current.trips.find((t) => t.slug === "japan");
    const patagonia = result.current.trips.find((t) => t.slug === "patagonia");
    expect(japan).toMatchObject({ status: "published", entryCount: 3 });
    expect(patagonia).toMatchObject({ status: "draft", entryCount: 0 });
  });

  it("surfaces a listStudioTrips failure as a structured error, never a throw", async () => {
    okBootstrap();
    const error: PodError = { kind: "http", url: TRIPS_URL, status: 403 };
    listStudioTripsMock.mockResolvedValue({ ok: false, error } satisfies Result<StudioTripListing>);

    const useStudioTrips = await loadUseStudioTrips();
    const { result } = renderHook(() => useStudioTrips({ session, podRoot: POD }));

    await waitFor(() => expect(result.current.status).toBe("failed"));
    if (result.current.status !== "failed") return;
    expect(result.current.error).toEqual(error);
    expect(readTripIndexMock).not.toHaveBeenCalled();
  });

  // One trip's own index is unreadable; the whole list must not go red for it.
  it("still lists a trip whose own index could not be read, with entryCount 0 rather than failing the list", async () => {
    okBootstrap();
    listStudioTripsMock.mockResolvedValue({
      ok: true,
      value: { trips: [JAPAN, PATAGONIA], skipped: [] },
    } satisfies Result<StudioTripListing>);
    readTripIndexMock.mockImplementation(async (url: string) => {
      if (url === JAPAN.indexUrl) {
        return { ok: false, error: { kind: "http", url, status: 404 } };
      }
      return { ok: true, value: tripIndex(url, 0) };
    });

    const useStudioTrips = await loadUseStudioTrips();
    const { result } = renderHook(() => useStudioTrips({ session, podRoot: POD }));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") return;
    expect(result.current.trips.map((t) => t.slug).sort()).toEqual(["japan", "patagonia"]);
    expect(result.current.trips.find((t) => t.slug === "japan")?.entryCount).toBe(0);
  });

  /* ═══════════════════════════════════ first-login bootstrap (finding #3) ══ */

  it("calls ensurePodInitialised exactly once, before listStudioTrips, even under React StrictMode", async () => {
    okBootstrap();
    listStudioTripsMock.mockResolvedValue({
      ok: true,
      value: { trips: [], skipped: [] },
    } satisfies Result<StudioTripListing>);

    const useStudioTrips = await loadUseStudioTrips();
    const { result } = renderHook(() => useStudioTrips({ session, podRoot: POD }), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(ensurePodInitialisedMock).toHaveBeenCalledTimes(1);
    expect(ensurePodInitialisedMock).toHaveBeenCalledWith(
      expect.objectContaining({ fetch: session.fetch, podRoot: POD, webId: WEB_ID }),
    );
    expect(order.indexOf("ensurePodInitialised")).toBeLessThan(order.indexOf("listStudioTrips"));
  });

  it("when ensurePodInitialised fails, reports the failure and never calls listStudioTrips", async () => {
    const error: PodError = { kind: "http", url: `${POD}travel/`, status: 500 };
    ensurePodInitialisedMock.mockResolvedValue({ ok: false, error } satisfies Result<void>);

    const useStudioTrips = await loadUseStudioTrips();
    const { result } = renderHook(() => useStudioTrips({ session, podRoot: POD }));

    await waitFor(() => expect(result.current.status).toBe("failed"));
    if (result.current.status !== "failed") return;
    expect(result.current.error).toEqual(error);
    expect(listStudioTripsMock).not.toHaveBeenCalled();
  });
});
