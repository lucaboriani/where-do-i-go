// @vitest-environment jsdom

/**
 * `use-publish` — Task 3.1, RED: use-publish.ts does not exist. Its two
 * deps (`@/lib/pod/save-trip`, `@/lib/studio/revalidate`) already exist and
 * are module-mocked; the hook loads through a non-literal specifier so a
 * missing module fails one test, not the whole file.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { SCHEMA_VERSION } from "@/lib/vocab";
import type { PublishTripReport } from "@/lib/pod/save-trip";
import type { Status, Trip } from "@/lib/pod/schema";
import type { StudioSessionLike } from "@/lib/studio/session";

/* ══════════════════════════════════════════════ mock: the two dependencies ══ */

const publishTripMock = vi.hoisted(() => vi.fn());
const unpublishTripMock = vi.hoisted(() => vi.fn());
const revalidateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/pod/save-trip", () => ({
  publishTrip: publishTripMock,
  unpublishTrip: unpublishTripMock,
}));
vi.mock("@/lib/studio/revalidate", () => ({ revalidatePublicSite: revalidateMock }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ══════════════════════════════════════════════ loading the module under test ══ */

/** Opaque to vite:import-analysis by construction — the specifier is a
 *  parameter, not a literal. */
const importModule = (specifier: string): Promise<unknown> =>
  import(/* @vite-ignore */ specifier);

/**
 * THE SHAPE PINNED HERE: one hook, `publish`/`unpublish`, for a trip OR an
 * entry. A trip is never guarded. An entry is guarded on §5 (may not publish
 * while its trip is not `"published"`; `undefined` reads as NOT published).
 * `write` is injected — Stage 4 (the entry editor) does not exist yet.
 */
type PublishTarget =
  | { kind: "trip"; trip: Trip; podRoot: string; etag: string }
  | {
      kind: "entry";
      tripStatus: Status | undefined;
      write: (next: Status) => Promise<{ ok: boolean; error?: string }>;
    };

interface PublishSeed {
  session: StudioSessionLike;
  target: PublishTarget;
}

interface Publish {
  pending: boolean;
  error: string | null;
  canPublish: boolean;
  reason: string | null;
  publish: () => Promise<void>;
  unpublish: () => Promise<void>;
}

async function loadUsePublish(): Promise<(seed: PublishSeed) => Publish> {
  const mod = (await importModule("@/hooks/studio/use-publish").catch((cause: unknown) => {
    throw new Error(
      "hooks/studio/use-publish.ts does not exist yet — this is the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as { usePublish?: unknown };
  if (typeof mod.usePublish !== "function") {
    throw new Error(
      "hooks/studio/use-publish.ts exists but exports no usePublish — still the red step.",
    );
  }
  return mod.usePublish as (seed: PublishSeed) => Publish;
}

/* ══════════════════════════════════════════════════════════════ fixtures ══ */

const POD = "https://pod.example/";
const WEB_ID = "https://owner.example/profile/card#me";

const session = {
  fetch: vi.fn(globalThis.fetch),
  info: { isLoggedIn: true, webId: WEB_ID },
} as unknown as StudioSessionLike;

function trip(status: Status): Trip {
  return {
    iri: `${POD}travel/trips/japan-2026/trip.ttl#it`,
    slug: "japan-2026",
    status,
    schemaVersion: SCHEMA_VERSION,
    name: { value: "Japan 2026", language: "en" },
    tags: [],
  };
}

const REPORT_OK: PublishTripReport = {
  tripUrl: `${POD}travel/trips/japan-2026/trip.ttl`,
  completed: ["trip", "acl", "diary", "revalidate"],
  recovery: "none",
  etag: '"v2"',
};

const REPORT_FAILED: PublishTripReport = {
  tripUrl: `${POD}travel/trips/japan-2026/trip.ttl`,
  completed: ["trip"],
  failed: { step: "acl", error: { kind: "http", url: `${POD}x`, status: 500 } },
  recovery: "retry",
  etag: '"v2"',
};

/* ══════════════════════════════════════════════════════════════ TRIP kind ══ */

describe("usePublish — a trip target", () => {
  it("publish() calls publishTrip with the session's fetch, the trip, podRoot, etag and the injected revalidate hook", async () => {
    publishTripMock.mockResolvedValue(REPORT_OK);
    const usePublish = await loadUsePublish();
    const { result } = renderHook(() =>
      usePublish({
        session,
        target: { kind: "trip", trip: trip("draft"), podRoot: POD, etag: '"v1"' },
      }),
    );

    await act(async () => {
      await result.current.publish();
    });

    expect(publishTripMock).toHaveBeenCalledTimes(1);
    expect(unpublishTripMock).not.toHaveBeenCalled();
    const call = publishTripMock.mock.calls[0][0];
    expect(call.fetch).toBe(session.fetch);
    expect(call.trip.slug).toBe("japan-2026");
    expect(call.podRoot).toBe(POD);
    expect(call.etag).toBe('"v1"');
    // Identity: `revalidate` really is the app's own hook, not a stand-in.
    expect(call.revalidate).toBe(revalidateMock);
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("unpublish() calls unpublishTrip and never publishTrip", async () => {
    unpublishTripMock.mockResolvedValue(REPORT_OK);
    const usePublish = await loadUsePublish();
    const { result } = renderHook(() =>
      usePublish({
        session,
        target: { kind: "trip", trip: trip("published"), podRoot: POD, etag: '"v1"' },
      }),
    );

    await act(async () => {
      await result.current.unpublish();
    });

    expect(unpublishTripMock).toHaveBeenCalledTimes(1);
    expect(publishTripMock).not.toHaveBeenCalled();
  });

  it("pending is true while publishTrip is in flight and false once it settles", async () => {
    let settle!: (report: PublishTripReport) => void;
    publishTripMock.mockReturnValue(
      new Promise<PublishTripReport>((resolve) => {
        settle = resolve;
      }),
    );
    const usePublish = await loadUsePublish();
    const { result } = renderHook(() =>
      usePublish({
        session,
        target: { kind: "trip", trip: trip("draft"), podRoot: POD, etag: '"v1"' },
      }),
    );

    let inFlight!: Promise<void>;
    act(() => {
      inFlight = result.current.publish();
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      settle(REPORT_OK);
      await inFlight;
    });
    expect(result.current.pending).toBe(false);
  });

  it("a failed publishTrip report surfaces a structured error rather than throwing", async () => {
    publishTripMock.mockResolvedValue(REPORT_FAILED);
    const usePublish = await loadUsePublish();
    const { result } = renderHook(() =>
      usePublish({
        session,
        target: { kind: "trip", trip: trip("draft"), podRoot: POD, etag: '"v1"' },
      }),
    );

    await act(async () => {
      await result.current.publish();
    });

    expect(result.current.pending).toBe(false);
    expect(result.current.error).not.toBeNull();
  });

  it("a trip target is never guarded, whatever the trip's own current status", async () => {
    const usePublish = await loadUsePublish();
    for (const status of ["draft", "published"] as const) {
      const { result, unmount } = renderHook(() =>
        usePublish({
          session,
          target: { kind: "trip", trip: trip(status), podRoot: POD, etag: '"v1"' },
        }),
      );
      expect(result.current.canPublish).toBe(true);
      expect(result.current.reason).toBeNull();
      unmount();
    }
  });
});

/* ═══════════════════════════════════════════════════════════ ENTRY kind ══ */

describe("usePublish — an entry target, guarded by its trip's status (§5)", () => {
  it("refuses to publish an entry under a DRAFT trip: disabled, a reason, and the write is never called", async () => {
    const write = vi.fn().mockResolvedValue({ ok: true });
    const usePublish = await loadUsePublish();
    const { result } = renderHook(() =>
      usePublish({ session, target: { kind: "entry", tripStatus: "draft", write } }),
    );

    expect(result.current.canPublish).toBe(false);
    expect(result.current.reason).toEqual(expect.any(String));
    expect(result.current.reason).not.toBe("");

    await act(async () => {
      await result.current.publish();
    });
    expect(write).not.toHaveBeenCalled();
  });

  // `tripStatus: undefined` must read as NOT published — a naive
  // `!== "draft"` guard reads it as "allowed", which this test would catch.
  it("treats an unknown (undefined) trip status exactly like a draft trip, never as 'allowed'", async () => {
    const write = vi.fn().mockResolvedValue({ ok: true });
    const usePublish = await loadUsePublish();
    const { result } = renderHook(() =>
      usePublish({ session, target: { kind: "entry", tripStatus: undefined, write } }),
    );

    expect(result.current.canPublish).toBe(false);
    expect(result.current.reason).toEqual(expect.any(String));

    await act(async () => {
      await result.current.publish();
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("allows publishing an entry once its trip is PUBLISHED, and calls the injected write", async () => {
    const write = vi.fn().mockResolvedValue({ ok: true });
    const usePublish = await loadUsePublish();
    const { result } = renderHook(() =>
      usePublish({ session, target: { kind: "entry", tripStatus: "published", write } }),
    );

    expect(result.current.canPublish).toBe(true);
    expect(result.current.reason).toBeNull();

    await act(async () => {
      await result.current.publish();
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("published");
  });

  // The allow-case for the asymmetry: unpublish carries none of §5's guard.
  it("never guards unpublish, even for an entry whose trip is a draft", async () => {
    const write = vi.fn().mockResolvedValue({ ok: true });
    const usePublish = await loadUsePublish();
    const { result } = renderHook(() =>
      usePublish({ session, target: { kind: "entry", tripStatus: "draft", write } }),
    );

    await act(async () => {
      await result.current.unpublish();
    });
    expect(write).toHaveBeenCalledWith("draft");
  });
});
