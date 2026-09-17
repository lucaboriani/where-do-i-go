// @vitest-environment jsdom
/** `newTrip` / `editTripSlug` — Task 3.3's shell routing, flagged untested
 *  when Task 3.2 landed. `readTripWithEtag` is mocked; `tripUrl` stays real. */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { resetSessionRestore } from "@/lib/studio/session";
import { readTripWithEtag, tripUrl } from "@/lib/pod/read";
import { SCHEMA_VERSION } from "@/lib/vocab";
import StudioShell from "@/components/studio/studio-shell";
import type { Trip } from "@/lib/pod/schema";
import type { StudioSessionLike } from "@/lib/studio/session";

vi.mock("@/lib/pod/read", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pod/read")>();
  return { ...actual, readTripWithEtag: vi.fn() };
});
const readTripWithEtagMock = vi.mocked(readTripWithEtag);

const OWNER = "https://alice.example/profile/card#me";
const ISSUER = "https://login.example";
const SITE = "https://diary.example";
const SITE_NAME = "Luca's travel diary";
const POD = "https://pod.test.example/";

const trip: Trip = {
  iri: `${POD}travel/trips/japan-2026/trip.ttl#it`,
  slug: "japan-2026",
  status: "draft",
  schemaVersion: SCHEMA_VERSION,
  name: { value: "Japan 2026", language: "en" },
  tags: [],
};

/** Signed in as the owner. `fetch` throws: `readTripWithEtag` is mocked above,
 *  so nothing here may reach it for real — mirrors `studio-shell.test.tsx`'s
 *  own fake, which makes the same claim for the same reason. */
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

function renderShell(props: { newTrip?: boolean; editTripSlug?: string; tripsHome?: boolean } = {}) {
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

describe("studio shell — newTrip mounts a blank editor", () => {
  it("renders the trip editor in CREATE mode, and asks the Pod nothing", async () => {
    renderShell({ newTrip: true });

    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
    expect(screen.getByLabelText("Slug")).toBeEnabled();
    expect(readTripWithEtagMock).not.toHaveBeenCalled();
  });

  /** The bug this step exists to close: `studio-client.tsx` sets `tripsHome`
   *  unconditionally, so a create/edit route reaches the shell with BOTH
   *  props set. Without a priority, `/studio/trips/new` renders the trips
   *  list instead of the editor. */
  it("wins over tripsHome, which studio-client.tsx always sets too", async () => {
    renderShell({ newTrip: true, tripsHome: true });

    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
    expect(screen.queryByText(/no trips to write into/i)).not.toBeInTheDocument();
  });
});

describe("studio shell — editTripSlug loads, then edits", () => {
  it("says it is loading, not the editor, before the trip arrives", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof readTripWithEtag>>) => void;
    readTripWithEtagMock.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );

    renderShell({ editTripSlug: "japan-2026" });

    await waitFor(() => expect(screen.getByText(/looking for this trip/i)).toBeInTheDocument());
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

    await act(async () => {
      resolve({ ok: true, value: { trip, etag: '"v1"' } });
    });
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
  });

  it("loads the named trip, and disables the slug because the container cannot move", async () => {
    readTripWithEtagMock.mockResolvedValue({ ok: true, value: { trip, etag: '"v1"' } });

    renderShell({ editTripSlug: "japan-2026" });

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Japan 2026"));
    expect(screen.getByLabelText("Slug")).toBeDisabled();
    expect(readTripWithEtagMock).toHaveBeenCalledWith(
      tripUrl(POD, "japan-2026"),
      expect.objectContaining({ fetch: expect.any(Function) }),
    );
  });

  it("says what went wrong, not blank, when the named trip cannot be read", async () => {
    readTripWithEtagMock.mockResolvedValue({
      ok: false,
      error: { kind: "http", url: tripUrl(POD, "missing"), status: 404 },
    });

    renderShell({ editTripSlug: "missing" });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/404/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });
});

/**
 * Task 4.1 review, deferred minor #B: `TripEditorRoute` keys nothing to
 * `editTripSlug`, so navigating from one trip's edit page to another shows
 * trip A's `load` state until the new `readTripWithEtag` settles — a stale
 * row. `rerender` reuses the SAME session, so only the trip load is exercised.
 */
describe("studio shell — editTripSlug does not leave a stale-row window on navigation", () => {
  const second: Trip = { ...trip, slug: "iceland-2025", name: { value: "Iceland 2025", language: "en" } };

  it("shows loading rather than the previous trip's data the instant editTripSlug changes", async () => {
    readTripWithEtagMock.mockImplementation(async (url) => {
      if (url === tripUrl(POD, "japan-2026")) return { ok: true, value: { trip, etag: '"v1"' } };
      if (url === tripUrl(POD, "iceland-2025")) return { ok: true, value: { trip: second, etag: '"v1"' } };
      throw new Error(`unexpected url: ${url}`);
    });
    const session = fakeOwnerSession();

    const { rerender } = render(
      <StudioShell
        session={session}
        ownerWebId={OWNER}
        oidcIssuer={ISSUER}
        siteUrl={SITE}
        siteName={SITE_NAME}
        podRoot={POD}
        editTripSlug="japan-2026"
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Japan 2026"));

    rerender(
      <StudioShell
        session={session}
        ownerWebId={OWNER}
        oidcIssuer={ISSUER}
        siteUrl={SITE}
        siteName={SITE_NAME}
        podRoot={POD}
        editTripSlug="iceland-2025"
      />,
    );

    // NO `await` in front of this query: the defect is what is on screen the
    // instant React commits the prop change, before the new trip's promise has
    // any chance to settle. A `waitFor` here would let the window this test
    // exists to catch close on its own and report green regardless.
    expect(
      screen.queryByDisplayValue("Japan 2026"),
      "trip A's name is still on screen after the route moved to trip B — the component was not reset",
    ).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Iceland 2025"));
  });
});
