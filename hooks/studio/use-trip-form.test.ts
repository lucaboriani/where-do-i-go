// @vitest-environment jsdom
/**
 * `use-trip-form` — Task 3.3, RED: hooks/studio/use-trip-form.ts does not
 * exist yet. Loaded through a non-literal specifier, mirroring
 * hooks/studio/use-publish.test.ts, so a missing module fails one test rather
 * than the whole file.
 */

import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { SCHEMA_VERSION } from "@/lib/vocab";
import type { Status, Trip } from "@/lib/pod/schema";

/* ══════════════════════════════════════════════ loading the module under test ══ */

/** Opaque to vite:import-analysis by construction — the specifier is a
 *  parameter, not a literal. */
const importModule = (specifier: string): Promise<unknown> =>
  import(/* @vite-ignore */ specifier);

/**
 * THE SHAPE PINNED HERE: slug + name/dates/description/tags/cover/status, one
 * reducer, one setter per field — mirroring `use-entry-form`'s `values`/`set`
 * split. Slug is owner-typed: there is no ninth setter that derives it.
 */
export interface TripFormState {
  slug: string;
  name: string;
  startDate: string;
  endDate: string;
  description: string;
  tagsText: string;
  coverImage: string;
  status: Status;
}

export interface TripFormSetters {
  slug: (value: string) => void;
  name: (value: string) => void;
  startDate: (value: string) => void;
  endDate: (value: string) => void;
  description: (value: string) => void;
  tagsText: (value: string) => void;
  coverImage: (value: string) => void;
  status: (value: Status) => void;
}

export interface TripForm {
  values: TripFormState;
  set: TripFormSetters;
}

export interface TripFormSeed {
  existing: Trip | undefined;
}

type TripFormModule = {
  useTripForm: (seed: TripFormSeed) => TripForm;
  initialTripFormState: (seed: TripFormSeed) => TripFormState;
};

async function loadUseTripForm(): Promise<TripFormModule> {
  const mod = (await importModule("@/hooks/studio/use-trip-form").catch((cause: unknown) => {
    throw new Error(
      "hooks/studio/use-trip-form.ts does not exist yet — this is the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as Partial<TripFormModule>;
  if (typeof mod.useTripForm !== "function" || typeof mod.initialTripFormState !== "function") {
    throw new Error(
      "hooks/studio/use-trip-form.ts exists but exports no useTripForm/initialTripFormState — still the red step.",
    );
  }
  return mod as TripFormModule;
}

/* ══════════════════════════════════════════════════════════════════ fixtures ══ */

const POD = "https://pod.example/";

const trip = (over: Partial<Trip> = {}): Trip => ({
  iri: `${POD}travel/trips/japan-2026/trip.ttl#it`,
  slug: "japan-2026",
  status: "draft",
  schemaVersion: SCHEMA_VERSION,
  name: { value: "Japan 2026", language: "en" },
  tags: [],
  ...over,
});

/* ═══════════════════════════════════════════════════════════════════ create ══ */

describe("initialTripFormState — a create", () => {
  it("opens every field empty, and drafts by default", async () => {
    const { initialTripFormState } = await loadUseTripForm();
    const state = initialTripFormState({ existing: undefined });
    expect(state).toEqual({
      slug: "",
      name: "",
      startDate: "",
      endDate: "",
      description: "",
      tagsText: "",
      coverImage: "",
      status: "draft",
    });
  });
});

/* ═════════════════════════════════════════════════════════════════════ edit ══ */

describe("initialTripFormState — an edit", () => {
  it("seeds every field from the existing trip", async () => {
    const { initialTripFormState } = await loadUseTripForm();
    const existing = trip({
      status: "published",
      description: { value: "Two weeks in Kansai and Kanto", language: "en" },
      startDate: "2026-04-01",
      endDate: "2026-04-14",
      tags: ["asia", "spring"],
      coverImage: `${POD}travel/media/6f2a1c8e/web.webp`,
    });

    const state = initialTripFormState({ existing });
    expect(state).toEqual({
      slug: "japan-2026",
      name: "Japan 2026",
      startDate: "2026-04-01",
      endDate: "2026-04-14",
      description: "Two weeks in Kansai and Kanto",
      tagsText: "asia, spring",
      coverImage: `${POD}travel/media/6f2a1c8e/web.webp`,
      status: "published",
    });
  });

  it("seeds every optional field as the empty string, never `undefined`", async () => {
    // A controlled input rendered from `undefined` warns and then goes
    // uncontrolled — the same reason `initialEntryFormState` never leaves a
    // text field undefined for the form to render.
    const { initialTripFormState } = await loadUseTripForm();
    const state = initialTripFormState({ existing: trip() });
    expect(state.description).toBe("");
    expect(state.startDate).toBe("");
    expect(state.endDate).toBe("");
    expect(state.coverImage).toBe("");
    expect(state.tagsText).toBe("");
  });
});

/* ═══════════════════════════════════════════════════════════════════ setters ══ */

describe("useTripForm — the setters, pinned by name", () => {
  it("exposes exactly the eight setters this form needs", async () => {
    const { useTripForm } = await loadUseTripForm();
    const { result } = renderHook(() => useTripForm({ existing: undefined }));
    expect(Object.keys(result.current.set).sort()).toEqual(
      ["coverImage", "description", "endDate", "name", "slug", "startDate", "status", "tagsText"].sort(),
    );
  });

  it("updates the named field alone", async () => {
    const { useTripForm } = await loadUseTripForm();
    const { result } = renderHook(() => useTripForm({ existing: undefined }));

    act(() => {
      result.current.set.name("Kyoto in Autumn");
      result.current.set.startDate("2026-10-01");
      result.current.set.endDate("2026-10-10");
      result.current.set.description("Leaves and temples");
      result.current.set.tagsText("autumn, kyoto");
      result.current.set.coverImage(`${POD}travel/media/aabb/web.webp`);
      result.current.set.status("published");
    });

    expect(result.current.values).toEqual({
      slug: "",
      name: "Kyoto in Autumn",
      startDate: "2026-10-01",
      endDate: "2026-10-10",
      description: "Leaves and temples",
      tagsText: "autumn, kyoto",
      coverImage: `${POD}travel/media/aabb/web.webp`,
      status: "published",
    });
  });
});

/* ═══════════════════════════════════ the slug is owner-typed, never derived ══ */

describe("useTripForm — the slug is owner-typed", () => {
  /**
   * NOT auto-derived from the name, anywhere. The `trips/<slug>/` container URL
   * depends on the slug (§4), so a control that silently slugifies the name
   * would move the address behind the owner's back the moment they retype the
   * title. This is the allow/refuse pair: name changes must never touch slug,
   * and the slug setter is the only thing that may.
   */
  it("never derives the slug from the name, in either direction", async () => {
    const { useTripForm } = await loadUseTripForm();
    const { result } = renderHook(() => useTripForm({ existing: undefined }));

    act(() => {
      result.current.set.name("Kyoto in Autumn");
    });
    expect(result.current.values.slug, "the name setter must not touch the slug").toBe("");

    act(() => {
      result.current.set.slug("kyoto-2026");
    });
    act(() => {
      result.current.set.name("Something completely different");
    });
    expect(
      result.current.values.slug,
      "an existing slug must survive further edits to the name",
    ).toBe("kyoto-2026");
  });

  it("seeds the slug from the existing trip on an edit, and the setter can still change it", async () => {
    const { useTripForm } = await loadUseTripForm();
    const { result } = renderHook(() => useTripForm({ existing: trip({ slug: "japan-2026" }) }));
    expect(result.current.values.slug).toBe("japan-2026");

    act(() => {
      result.current.set.slug("japan-2026-take-two");
    });
    expect(result.current.values.slug).toBe("japan-2026-take-two");
  });
});
