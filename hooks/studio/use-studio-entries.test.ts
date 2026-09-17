// @vitest-environment jsdom

/**
 * `use-studio-entries` — Task 4.1, RED: use-studio-entries.ts does not
 * exist. Its two deps (`@/lib/pod/write`, `@/lib/pod/read`) already exist
 * and are module-mocked; the hook loads through a non-literal specifier,
 * as `use-studio-trips.test.ts` does.
 */

/**
 * THE CHOICE PINNED HERE: entries come from the ENTRIES CONTAINER via
 * `ldp:contains` (`listContainer`), never the published-only `entries.ttl`
 * index — §4, the same fix `use-studio-trips` already applies to its own
 * entryCount. A trip whose every entry is a draft must still list them all.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { SCHEMA_VERSION } from "@/lib/vocab";
import type { PodError, Result } from "@/lib/pod/result";
import type { Entry, Status } from "@/lib/pod/schema";
import type { StudioSessionLike } from "@/lib/studio/session";

/* ══════════════════════════════════ mock: the two existing dependencies ══ */

const listContainerMock = vi.hoisted(() => vi.fn());
const readEntryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/pod/write", () => ({ listContainer: listContainerMock }));
vi.mock("@/lib/pod/read", () => ({ readEntry: readEntryMock }));

afterEach(() => {
  vi.clearAllMocks();
});

/* ══════════════════════════════════════════════ loading the module under test ══ */

const importModule = (specifier: string): Promise<unknown> =>
  import(/* @vite-ignore */ specifier);

interface StudioEntry {
  slug: string;
  title: string;
  status: Status;
}

type StudioEntriesState =
  | { status: "pending" }
  | { status: "ready"; entries: StudioEntry[] }
  | { status: "failed"; error: PodError };

interface StudioEntriesSeed {
  session: StudioSessionLike;
  podRoot: string;
  tripSlug: string;
}

async function loadUseStudioEntries(): Promise<(seed: StudioEntriesSeed) => StudioEntriesState> {
  const mod = (await importModule("@/hooks/studio/use-studio-entries").catch((cause: unknown) => {
    throw new Error(
      "hooks/studio/use-studio-entries.ts does not exist yet — this is the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as { useStudioEntries?: unknown };
  if (typeof mod.useStudioEntries !== "function") {
    throw new Error(
      "hooks/studio/use-studio-entries.ts exists but exports no useStudioEntries — still the red step.",
    );
  }
  return mod.useStudioEntries as (seed: StudioEntriesSeed) => StudioEntriesState;
}

/* ══════════════════════════════════════════════════════════════ fixtures ══ */

const POD = "https://pod.example/";
const WEB_ID = "https://owner.example/profile/card#me";
const TRIP_SLUG = "japan";
const ENTRIES_URL = `${POD}travel/trips/${TRIP_SLUG}/entries/`;

const session = {
  fetch: vi.fn(globalThis.fetch),
  info: { isLoggedIn: true, webId: WEB_ID },
} as unknown as StudioSessionLike;

function entryDoc(slug: string, title: string, status: Status): Entry {
  return {
    iri: `${ENTRIES_URL}${slug}.ttl#it`,
    slug,
    status,
    schemaVersion: SCHEMA_VERSION,
    headline: { value: title, language: "en" },
    sections: [],
    tags: [],
  };
}

/** `.ttl` members plus one stray non-`.ttl` member every listing below
 *  carries — the filter this hook must apply drops it, not read it. */
function membersOf(slugs: readonly string[]): string[] {
  return [...slugs.map((s) => `${ENTRIES_URL}${s}.ttl`), `${ENTRIES_URL}notes.md`];
}

/* ═══════════════════════════════════════════════════════════════ the read ══ */

describe("useStudioEntries", () => {
  it("starts pending, before listContainer has settled", () => {
    listContainerMock.mockReturnValue(new Promise(() => {})); // never settles
    return loadUseStudioEntries().then((useStudioEntries) => {
      const { result } = renderHook(() =>
        useStudioEntries({ session, podRoot: POD, tripSlug: TRIP_SLUG }),
      );
      expect(result.current.status).toBe("pending");
    });
  });

  it("lists the ENTRIES CONTAINER via ldp:contains, drafts and published alike, filtering to .ttl members", async () => {
    listContainerMock.mockResolvedValue({
      ok: true,
      value: membersOf(["e0", "e1"]),
    } satisfies Result<string[]>);
    readEntryMock.mockImplementation(async (url: string) => {
      if (url === `${ENTRIES_URL}e0.ttl`) {
        return { ok: true, value: entryDoc("e0", "Arrival", "published") };
      }
      if (url === `${ENTRIES_URL}e1.ttl`) {
        return { ok: true, value: entryDoc("e1", "Still drafting", "draft") };
      }
      throw new Error(`unexpected readEntry(${url})`);
    });

    const useStudioEntries = await loadUseStudioEntries();
    const { result } = renderHook(() =>
      useStudioEntries({ session, podRoot: POD, tripSlug: TRIP_SLUG }),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") return;

    expect(listContainerMock).toHaveBeenCalledWith(session.fetch, ENTRIES_URL);
    // The stray non-.ttl member was listed but never read.
    expect(readEntryMock).toHaveBeenCalledTimes(2);
    expect(readEntryMock).toHaveBeenCalledWith(`${ENTRIES_URL}e0.ttl`, { fetch: session.fetch });

    const bySlug = new Map(result.current.entries.map((e) => [e.slug, e]));
    expect(bySlug.get("e0")).toMatchObject({ title: "Arrival", status: "published" });
    expect(bySlug.get("e1")).toMatchObject({ title: "Still drafting", status: "draft" });
  });

  // The regression this hook exists to guard: a trip whose every entry is a
  // draft must still list them, not read an empty list off a published-only
  // index. `readTripIndex` is never mocked here, so calling it would break.
  it("lists a trip whose every entry is a draft, not an empty list", async () => {
    listContainerMock.mockResolvedValue({
      ok: true,
      value: membersOf(["only-draft"]),
    } satisfies Result<string[]>);
    readEntryMock.mockResolvedValue({
      ok: true,
      value: entryDoc("only-draft", "Not yet public", "draft"),
    } satisfies Result<Entry>);

    const useStudioEntries = await loadUseStudioEntries();
    const { result } = renderHook(() =>
      useStudioEntries({ session, podRoot: POD, tripSlug: TRIP_SLUG }),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") return;
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]).toMatchObject({ slug: "only-draft", status: "draft" });
  });

  it("surfaces a listContainer failure as a structured error, never a throw", async () => {
    const error: PodError = { kind: "http", url: ENTRIES_URL, status: 403 };
    listContainerMock.mockResolvedValue({ ok: false, error } satisfies Result<string[]>);

    const useStudioEntries = await loadUseStudioEntries();
    const { result } = renderHook(() =>
      useStudioEntries({ session, podRoot: POD, tripSlug: TRIP_SLUG }),
    );

    await waitFor(() => expect(result.current.status).toBe("failed"));
    if (result.current.status !== "failed") return;
    expect(result.current.error).toEqual(error);
    expect(readEntryMock).not.toHaveBeenCalled();
  });
});
