// @vitest-environment jsdom
/**
 * `<TripEditor>` — Task 3.3, RED: components/studio/trip-editor/trip-editor.tsx
 * does not exist yet. Loaded through a non-literal specifier, mirroring
 * hooks/studio/use-publish.test.ts, so a missing module fails one test rather
 * than the whole file. The three deps this editor reaches past its own two
 * hooks are module-mocked, exactly as the entry editor's own tests mock
 * `@/lib/pod/save-entry` at that layer: `@/lib/pod/save-trip`,
 * `@/lib/studio/revalidate`, and `@/hooks/studio/use-photo-pipeline` (the
 * brief's own instruction — "mock it" — rather than the entry editor's real
 * pipeline + MSW rig, which exists to prove upload bytes and is not this
 * component's question).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SCHEMA_VERSION } from "@/lib/vocab";
import type { Trip } from "@/lib/pod/schema";
import type { SaveTripReport } from "@/lib/pod/save-trip";
import type { StudioSessionLike } from "@/lib/studio/session";

/* ══════════════════════════════════════════════ mock: the three dependencies ══ */

const saveTripMock = vi.hoisted(() => vi.fn());
const revalidateMock = vi.hoisted(() => vi.fn());
const usePhotoPipelineMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/pod/save-trip", () => ({ saveTrip: saveTripMock }));
vi.mock("@/lib/studio/revalidate", () => ({ revalidatePublicSite: revalidateMock }));
vi.mock("@/hooks/studio/use-photo-pipeline", () => ({ usePhotoPipeline: usePhotoPipelineMock }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ══════════════════════════════════════════════ loading the module under test ══ */

const importModule = (specifier: string): Promise<unknown> =>
  import(/* @vite-ignore */ specifier);

export interface TripEditorProps {
  session: StudioSessionLike;
  podRoot: string;
  /** Absent means CREATE. Present means EDIT — the container's slug is fixed
   *  from the moment a trip exists (§4), so the slug control is read-only. */
  initial?: { trip: Trip; etag: string | null };
}

async function loadTripEditor(): Promise<(props: TripEditorProps) => React.JSX.Element> {
  const mod = (await importModule("./trip-editor").catch((cause: unknown) => {
    throw new Error(
      "components/studio/trip-editor/trip-editor.tsx does not exist yet — this is the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as { default?: unknown };
  if (typeof mod.default !== "function") {
    throw new Error(
      "components/studio/trip-editor/trip-editor.tsx exists but has no default export — still the red step.",
    );
  }
  return mod.default as (props: TripEditorProps) => React.JSX.Element;
}

/* ══════════════════════════════════════════════════════════════════ fixtures ══ */

const POD = "https://pod.example/";

const session = {
  fetch: vi.fn(),
  info: { isLoggedIn: true, webId: "https://owner.example/profile/card#me" },
} as unknown as StudioSessionLike;

const trip = (over: Partial<Trip> = {}): Trip => ({
  iri: `${POD}travel/trips/japan-2026/trip.ttl#it`,
  slug: "japan-2026",
  status: "draft",
  schemaVersion: SCHEMA_VERSION,
  name: { value: "Japan 2026", language: "en" },
  tags: [],
  ...over,
});

const report = (over: Partial<SaveTripReport> = {}): SaveTripReport => ({
  tripUrl: `${POD}travel/trips/japan-2026/trip.ttl`,
  completed: ["container", "trip", "index", "entriesContainer"],
  recovery: "none",
  etag: '"v1"',
  ...over,
});

/** A cover pipeline that hands the test its captured `form`, so a settle can
 *  be driven from outside without knowing the editor's internal state shape. */
function mockPipeline() {
  const attachAll = vi.fn();
  let capturedForm: {
    addSlot: (sectionId: string, slot: unknown) => void;
    settleSlot: (sectionId: string, key: string, slot: unknown) => void;
  } | null = null;
  usePhotoPipelineMock.mockImplementation(
    (seed: { form: NonNullable<typeof capturedForm> }) => {
      capturedForm = seed.form;
      return { attachAll };
    },
  );
  return {
    attachAll,
    settleReady: (sectionId: string, contentUrl: string) => {
      act(() => {
        capturedForm?.settleSlot(sectionId, "cover-key", {
          key: "cover-key",
          name: "cover.jpg",
          state: "ready",
          photo: { contentUrl },
        });
      });
    },
  };
}

async function renderEditor(props: Partial<TripEditorProps> = {}) {
  const TripEditor = await loadTripEditor();
  render(<TripEditor session={session} podRoot={POD} {...props} />);
}

const saveButton = () => screen.getByRole("button", { name: /save trip/i });

/* ══════════════════════════════════════════════════════════════════ fields ══ */

describe("TripEditor — renders the fields", () => {
  it("names every control this form needs, including the cover picker", async () => {
    usePhotoPipelineMock.mockReturnValue({ attachAll: vi.fn() });
    await renderEditor();

    for (const label of [
      "Name",
      "Slug",
      "Start date",
      "End date",
      "Description",
      "Tags",
      "Status",
      "Cover photo",
    ]) {
      expect(screen.getByLabelText(label), `no control answers to "${label}"`).toBeInTheDocument();
    }
    expect(saveButton()).toBeInTheDocument();
  });
});

/* ═════════════════════════════════════════════════════════ the cover pick ══ */

describe("TripEditor — the cover, driven through use-photo-pipeline", () => {
  it("attaches a picked cover file through the pipeline, and shows it once it settles", async () => {
    const pipeline = mockPipeline();
    await renderEditor();

    const input = screen.getByLabelText("Cover photo") as HTMLInputElement;
    const file = new File(["bytes"], "fuji.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(pipeline.attachAll, "the picked file never reached the pipeline").toHaveBeenCalledTimes(1);
    const [sectionId, files] = pipeline.attachAll.mock.calls[0] as [string, File[]];
    expect(files).toEqual([file]);

    const derivativeUrl = `${POD}travel/media/6f2a1c8e/web.webp`;
    pipeline.settleReady(sectionId, derivativeUrl);

    const shown = await screen.findByRole("img", { name: /cover/i });
    expect(shown.getAttribute("src"), "the cover is not shown from the derivative the pipeline settled")
      .toBe(derivativeUrl);
  });
});

/* ══════════════════════════════════ the cover slot is replaced, never appended ══ */

describe("TripEditor — the cover slot is replaced on each pick", () => {
  it("holds exactly one slot, reflecting the latest pick — F1", async () => {
    type Seed = {
      form: { addSlot: (sectionId: string, slot: unknown) => void; settleSlot: (sectionId: string, key: string, slot: unknown) => void };
      sections: readonly { id: string; slots: readonly { key: string }[] }[];
    };
    let form!: Seed["form"];
    let sections: Seed["sections"] = [];
    usePhotoPipelineMock.mockImplementation((seed: Seed) => {
      form = seed.form;
      sections = seed.sections;
      return { attachAll: vi.fn() };
    });
    await renderEditor();

    const pick = (key: string, url: string) => {
      act(() => form.addSlot("cover", { key, name: `${key}.jpg`, state: "decoding" }));
      act(() =>
        form.settleSlot("cover", key, { key, name: `${key}.jpg`, state: "ready", photo: { contentUrl: url } }),
      );
    };
    pick("a", `${POD}travel/media/aaa/web.webp`);
    pick("b", `${POD}travel/media/bbb/web.webp`);
    pick("c", `${POD}travel/media/ccc/web.webp`);

    const cover = sections.find((section) => section.id === "cover");
    expect(cover?.slots, "an earlier pick is still occupying the cover's one slot").toHaveLength(1);
    expect(cover?.slots[0].key, "the slot does not reflect the latest pick").toBe("c");
  });
});

/* ══════════════════════════════════════════════════ the name+slug pre-flight ══ */

describe("TripEditor — blocks save until a name and a slug are present", () => {
  it("sends nothing with only a name typed, then saves once the slug is added too", async () => {
    usePhotoPipelineMock.mockReturnValue({ attachAll: vi.fn() });
    saveTripMock.mockResolvedValue(report());
    await renderEditor();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Japan 2026" } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(saveTripMock, "a name alone is not enough to save").not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "japan-2026" } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(saveTripMock).toHaveBeenCalledTimes(1));
  });
});

/* ══════════════════════════════════════════════════ the slug on an edit ══ */

describe("TripEditor — the slug on an edit", () => {
  it("is read-only, because the trip's container cannot move", async () => {
    usePhotoPipelineMock.mockReturnValue({ attachAll: vi.fn() });
    await renderEditor({ initial: { trip: trip(), etag: '"v1"' } });
    expect(screen.getByLabelText("Slug")).toBeDisabled();
  });

  it("is editable on a create — the allow-case", async () => {
    usePhotoPipelineMock.mockReturnValue({ attachAll: vi.fn() });
    await renderEditor();
    expect(screen.getByLabelText("Slug")).toBeEnabled();
  });

  it("freezes once an in-session create completes — F2", async () => {
    usePhotoPipelineMock.mockReturnValue({ attachAll: vi.fn() });
    saveTripMock.mockResolvedValue(report());
    await renderEditor();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Japan 2026" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "japan-2026" } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(saveTripMock).toHaveBeenCalledTimes(1));

    expect(
      screen.getByLabelText("Slug"),
      "the trip now exists on the Pod; its container's slug cannot move",
    ).toBeDisabled();
  });
});

/* ══════════════════════════════════════════════════ a create 412 ══ */

describe("TripEditor — a create's 412", () => {
  it("shows the slug is already taken, as an alert carrying the payload", async () => {
    usePhotoPipelineMock.mockReturnValue({ attachAll: vi.fn() });
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
    await renderEditor();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Japan 2026" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "japan-2026" } });
    await act(async () => {
      fireEvent.click(saveButton());
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "", "a zero-content alert is as good as none").not.toBe("");
    expect(alert.textContent).toMatch(/already taken/i);
  });
});
