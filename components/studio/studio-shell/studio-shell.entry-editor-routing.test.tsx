// @vitest-environment jsdom
/** Task 4.2 — `newEntryTripSlug` / `editEntry` shell routing. Mirrors
 *  `studio-shell.trip-editor-routing.test.tsx`: both reads mocked, the fake
 *  session's `fetch` throws. */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { resetSessionRestore } from "@/lib/studio/session";
import { entryUrl, readEntryWithEtag, readTripWithEtag, tripUrl } from "@/lib/pod/read";
import { SCHEMA_VERSION } from "@/lib/vocab";
import StudioShell from "@/components/studio/studio-shell";
import type { Entry, Trip } from "@/lib/pod/schema";
import type { StudioSessionLike } from "@/lib/studio/session";

vi.mock("@/lib/pod/read", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pod/read")>();
  return { ...actual, readTripWithEtag: vi.fn(), readEntryWithEtag: vi.fn() };
});
const readTripWithEtagMock = vi.mocked(readTripWithEtag);
const readEntryWithEtagMock = vi.mocked(readEntryWithEtag);

const OWNER = "https://alice.example/profile/card#me";
const ISSUER = "https://login.example";
const SITE = "https://diary.example";
const SITE_NAME = "Luca's travel diary";
const POD = "https://pod.test.example/";
const TRIP_SLUG = "2026-japan";
const ENTRY_SLUG = "2026-03-29-arrival";

function tripFixture(status: Trip["status"]): Trip {
  return {
    iri: `${POD}travel/trips/${TRIP_SLUG}/trip.ttl#it`,
    slug: TRIP_SLUG,
    status,
    schemaVersion: SCHEMA_VERSION,
    name: { value: "Japan 2026", language: "en" },
    tags: [],
  };
}

function entryFixture(): Entry {
  return {
    iri: `${POD}travel/trips/${TRIP_SLUG}/entries/${ENTRY_SLUG}.ttl#it`,
    slug: ENTRY_SLUG,
    status: "draft",
    schemaVersion: SCHEMA_VERSION,
    headline: { value: "First night in Shinjuku", language: "en" },
    trip: `${POD}travel/trips/${TRIP_SLUG}/trip.ttl#it`,
    sections: [],
    tags: [],
  };
}

/** Signed in as the owner. `fetch` throws: both reads above are mocked, so
 *  nothing here may reach a host — mirrors the sibling file's own fake. */
function fakeOwnerSession(): StudioSessionLike {
  const events = new EventEmitter();
  const session = {
    info: { isLoggedIn: true, webId: OWNER },
    events,
    fetch: (async () => {
      throw new Error("nothing in this file may reach a host");
    }) as typeof globalThis.fetch,
    async handleIncomingRedirect() {
      return this.info;
    },
    async login() {},
    async logout() {
      this.info.isLoggedIn = false;
      events.emit("logout");
    },
  };
  return session as unknown as StudioSessionLike;
}

function renderShell(
  props: {
    newEntryTripSlug?: string;
    editEntry?: { tripSlug: string; entrySlug: string };
    tripsHome?: boolean;
  } = {},
) {
  return render(
    <StudioShell
      session={fakeOwnerSession()}
      ownerWebId={OWNER}
      oidcIssuer={ISSUER}
      siteUrl={SITE}
      siteName={SITE_NAME}
      podRoot={POD}
      {...props}
    />,
  );
}

beforeEach(() => {
  resetSessionRestore();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("studio shell — newEntryTripSlug mounts a preset create-mode editor", () => {
  it("loads the named trip, mounts CREATE mode preset to it, and asks readEntryWithEtag nothing", async () => {
    readTripWithEtagMock.mockResolvedValue({ ok: true, value: { trip: tripFixture("published"), etag: '"v1"' } });

    renderShell({ newEntryTripSlug: TRIP_SLUG });

    await waitFor(() => expect(screen.getByLabelText(/headline/i)).toBeInTheDocument());
    // CREATE, not EDIT: the slug control is free rather than fixed by an
    // address that already exists.
    expect(screen.getByLabelText(/slug/i)).toBeEnabled();
    expect(readTripWithEtagMock).toHaveBeenCalledWith(
      tripUrl(POD, TRIP_SLUG),
      expect.objectContaining({ fetch: expect.any(Function) }),
    );
    expect(readEntryWithEtagMock).not.toHaveBeenCalled();
  });

  /** The picker shows one trip, and the same word `IdentityFields` already
   *  uses for a draft trip in the multi-trip picker — a preset of one is
   *  still a picker, and the one mistake it must not invite is publishing an
   *  entry into a trip that looks exactly as available as a published one. */
  it("carries the trip's own draft status into the preset, the same word the multi-trip picker uses", async () => {
    readTripWithEtagMock.mockResolvedValue({ ok: true, value: { trip: tripFixture("draft"), etag: '"v1"' } });

    renderShell({ newEntryTripSlug: TRIP_SLUG });

    await waitFor(() => expect(screen.getByLabelText(/headline/i)).toBeInTheDocument());
    expect(screen.getByText(/japan 2026.*\(draft\)/i)).toBeInTheDocument();
  });

  it("wins over tripsHome, which studio-client.tsx always sets too", async () => {
    readTripWithEtagMock.mockResolvedValue({ ok: true, value: { trip: tripFixture("published"), etag: '"v1"' } });

    renderShell({ newEntryTripSlug: TRIP_SLUG, tripsHome: true });

    await waitFor(() => expect(screen.getByLabelText(/headline/i)).toBeInTheDocument());
    expect(screen.queryByText(/no trips to write into/i)).not.toBeInTheDocument();
  });

  it("says what went wrong, not blank, when the named trip cannot be read", async () => {
    readTripWithEtagMock.mockResolvedValue({
      ok: false,
      error: { kind: "http", url: tripUrl(POD, TRIP_SLUG), status: 404 },
    });

    renderShell({ newEntryTripSlug: TRIP_SLUG });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/404/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/headline/i)).not.toBeInTheDocument();
  });
});

describe("studio shell — editEntry loads the trip and the entry, then edits", () => {
  it("says it is loading, not the editor, before both arrive", async () => {
    let resolveTrip!: (v: Awaited<ReturnType<typeof readTripWithEtag>>) => void;
    let resolveEntry!: (v: Awaited<ReturnType<typeof readEntryWithEtag>>) => void;
    readTripWithEtagMock.mockReturnValue(new Promise((res) => (resolveTrip = res)));
    readEntryWithEtagMock.mockReturnValue(new Promise((res) => (resolveEntry = res)));

    renderShell({ editEntry: { tripSlug: TRIP_SLUG, entrySlug: ENTRY_SLUG } });

    await waitFor(() => expect(screen.getByText(/looking for/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/headline/i)).not.toBeInTheDocument();

    await act(async () => {
      resolveTrip({ ok: true, value: { trip: tripFixture("published"), etag: '"t1"' } });
      resolveEntry({ ok: true, value: { entry: entryFixture(), etag: '"e1"' } });
    });
    await waitFor(() => expect(screen.getByLabelText(/headline/i)).toBeInTheDocument());
  });

  it("reads the entry with the owner's own session, and seeds the editor from it via `initial`", async () => {
    readTripWithEtagMock.mockResolvedValue({ ok: true, value: { trip: tripFixture("published"), etag: '"t1"' } });
    readEntryWithEtagMock.mockResolvedValue({ ok: true, value: { entry: entryFixture(), etag: '"e1"' } });

    renderShell({ editEntry: { tripSlug: TRIP_SLUG, entrySlug: ENTRY_SLUG } });

    await waitFor(() =>
      expect(screen.getByLabelText(/headline/i)).toHaveValue("First night in Shinjuku"),
    );
    // EDIT, not CREATE: the address is fixed once the resource exists (§10).
    expect(screen.getByLabelText(/slug/i)).toBeDisabled();
    expect(readEntryWithEtagMock).toHaveBeenCalledWith(
      entryUrl(POD, TRIP_SLUG, ENTRY_SLUG),
      expect.objectContaining({ fetch: expect.any(Function) }),
    );
  });

  it("enables the publish control when the entry's trip is published", async () => {
    readTripWithEtagMock.mockResolvedValue({ ok: true, value: { trip: tripFixture("published"), etag: '"t1"' } });
    readEntryWithEtagMock.mockResolvedValue({ ok: true, value: { entry: entryFixture(), etag: '"e1"' } });

    renderShell({ editEntry: { tripSlug: TRIP_SLUG, entrySlug: ENTRY_SLUG } });

    const button = await screen.findByRole("button", { name: /^publish$/i });
    expect(button).not.toBeDisabled();
  });

  it("disables the publish control, with a reason, when the entry's trip is a draft", async () => {
    readTripWithEtagMock.mockResolvedValue({ ok: true, value: { trip: tripFixture("draft"), etag: '"t1"' } });
    readEntryWithEtagMock.mockResolvedValue({ ok: true, value: { entry: entryFixture(), etag: '"e1"' } });

    renderShell({ editEntry: { tripSlug: TRIP_SLUG, entrySlug: ENTRY_SLUG } });

    const button = await screen.findByRole("button", { name: /^publish$/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/not published yet/i)).toBeInTheDocument();
  });

  it("wins over tripsHome, which studio-client.tsx always sets too", async () => {
    readTripWithEtagMock.mockResolvedValue({ ok: true, value: { trip: tripFixture("published"), etag: '"t1"' } });
    readEntryWithEtagMock.mockResolvedValue({ ok: true, value: { entry: entryFixture(), etag: '"e1"' } });

    renderShell({ editEntry: { tripSlug: TRIP_SLUG, entrySlug: ENTRY_SLUG }, tripsHome: true });

    await waitFor(() => expect(screen.getByLabelText(/headline/i)).toBeInTheDocument());
    expect(screen.queryByText(/no trips to write into/i)).not.toBeInTheDocument();
  });

  it("says what went wrong, not blank, when the named entry cannot be read", async () => {
    readTripWithEtagMock.mockResolvedValue({ ok: true, value: { trip: tripFixture("published"), etag: '"t1"' } });
    readEntryWithEtagMock.mockResolvedValue({
      ok: false,
      error: { kind: "http", url: entryUrl(POD, TRIP_SLUG, ENTRY_SLUG), status: 404 },
    });

    renderShell({ editEntry: { tripSlug: TRIP_SLUG, entrySlug: ENTRY_SLUG } });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/404/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/headline/i)).not.toBeInTheDocument();
  });
});
