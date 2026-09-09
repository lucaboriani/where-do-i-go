"use client";

/**
 * The one component that owns the session state. IT IMPORTS NO VALUE FROM THE
 * AUTH LIBRARY AND READS NO CONFIG, and the behaviour is all
 * `lib/studio/session.ts`'s. INVARIANT 5: the owner verdict decides what is
 * RENDERED and nothing else. ./notes.md#what-the-shell-is-not-allowed-to-do
 */

import { useEffect, useRef, useState } from "react";
import { privacySettingsUrl } from "@/lib/pod/read";
import { describe as describePodError } from "@/lib/pod/result";
import { listStudioTrips } from "@/lib/studio/trips";
import {
  restoreSession,
  signIn,
  signOut,
  studioState,
  subscribeSessionState,
} from "@/lib/studio/session";
import EntryEditor from "@/components/studio/entry-editor";
import type { EditorTrip } from "@/components/studio/entry-editor";
import type { PodError } from "@/lib/pod/result";
import type { StudioTripListing } from "@/lib/studio/trips";
import type { SessionState, StudioSessionLike, StudioState } from "@/lib/studio/session";

export interface StudioShellProps {
  /** Injected, never constructed here. See note 1 above. */
  session: StudioSessionLike;
  /** The configured owner, from OWNER_WEBID via the server component. */
  ownerWebId: string;
  /** The owner's identity provider, read from their WebID document (§7.5). */
  oidcIssuer: string;
  /** The site's public origin. Passed through to signIn, never interpolated
   *  here: signIn is the single place `${origin}/studio` and
   *  `${origin}/client-id.jsonld` are derived, so the pair the browser claims
   *  cannot drift from the pair the client ID document publishes. */
  siteUrl: string;
  /** Shown on the consent screen in the dynamic-registration fallback. */
  siteName: string;
  /** The Pod's storage root, WITH A TRAILING SLASH — without it every
   *  `new URL("travel/trips/", podRoot)` resolves against the parent and 404s.
   *  A prop, like the four above: ./notes.md#podroot-needs-its-trailing-slash */
  podRoot: string;
  /** The trips the owner can write an entry into. A TEST SEAM — PRODUCTION
   *  PASSES NOTHING — and `[]` is NOT `undefined`: supplied means supplied,
   *  absent means ask the Pod.
   *  ./notes.md#trips-is-a-test-seam-and-supplied-means-supplied */
  trips?: EditorTrip[];
}

/** Where the enumeration has got to. `pending` IS A STATE, NEVER A RESULT, and
 *  `failed` is not `ready` with an empty list:
 *  ./notes.md#pending-is-a-state-never-a-result */
type ListingState =
  | { status: "pending" }
  | { status: "ready"; listing: StudioTripListing }
  | { status: "failed"; error: PodError };

export default function StudioShell({
  session,
  ownerWebId,
  oidcIssuer,
  siteUrl,
  siteName,
  podRoot,
  trips,
}: StudioShellProps) {
  const [state, setState] = useState<SessionState>({ status: "restoring" });
  const [failure, setFailure] = useState<string | null>(null);
  const [listing, setListing] = useState<ListingState>({ status: "pending" });

  useEffect(() => {
    /** Effects run twice under StrictMode, and this effect's cleanup runs in
     *  between. A promise that settles after that must not write state. */
    let live = true;
    const apply = (next: SessionState) => {
      if (live) setState(next);
    };

    // Subscribed BEFORE the restore is awaited, so a session that lapses while
    // the `prompt=none` round-trip is in flight is still noticed.
    const unsubscribe = subscribeSessionState(session, apply);

    // restoreSession is memoised synchronously, once per page load, and that is
    // what makes this safe to call on both StrictMode invocations: the second
    // one gets the first one's promise rather than a second round-trip whose
    // answer disagrees with it (docs/phase-0-spike.md, question 2). Nothing
    // here may defeat that memo.
    void restoreSession(session).then(apply);

    return () => {
      live = false;
      unsubscribe();
    };
  }, [session]);

  const view = studioState(state, ownerWebId);

  /** ENUMERATE ONLY FOR THE OWNER, AND ONLY WHEN NOBODY HANDED US A LIST. TWO
   *  BOOLEANS RATHER THAN `view`, which is a fresh object every render and would
   *  re-enter unboundedly:
   *  ./notes.md#enumerate-only-for-the-owner-and-only-when-nobody-handed-us-a-list */
  const enumerating = view.status === "owner" && trips === undefined;

  /** The in-flight listing, memoised by the root it was started for — the shape
   *  `restoreSession` documents. THE REF IS DELIBERATELY NOT CLEARED ON CLEANUP:
   *  ./notes.md#the-in-flight-listing-is-memoised-by-the-root-it-was-started-for */
  const started = useRef<{ key: string; result: Promise<ListingState> } | null>(null);

  useEffect(() => {
    if (!enumerating) return;

    let live = true;
    if (started.current?.key !== podRoot) {
      started.current = { key: podRoot, result: enumerateTrips(session, podRoot) };
    }
    void started.current.result.then((next) => {
      // Not a "setState after unmount" guard — React 19 dropped that warning —
      // but the abandoned listing must not write over a later state, and the
      // handler must not throw into a settled promise nobody is watching.
      if (live) setListing(next);
    });

    return () => {
      live = false;
    };
  }, [enumerating, podRoot, session]);

  /** login() navigates the browser away and never returns; logout() resolves.
   *  Either can reject, and an unhandled rejection would leave the shell
   *  looking as though the click did nothing. */
  const run = (work: Promise<void>, whenItFails: string) => {
    setFailure(null);
    void work.catch(() => setFailure(whenItFails));
  };

  const onSignIn = () =>
    run(
      signIn(session, { oidcIssuer, siteUrl, siteName }),
      "Could not start the sign-in redirect. Check that your Pod is reachable, then try again.",
    );

  const onSignOut = () =>
    run(signOut(session), "Signing out did not complete. Reload the page and try again.");

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl">{`${siteName} — studio`}</h1>
      <Body
        view={view}
        oidcIssuer={oidcIssuer}
        session={session}
        trips={trips}
        listing={listing}
        settingsUrl={settingsUrlFor(podRoot)}
        podRoot={podRoot}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
      />
      {failure !== null && (
        <p className="mt-4 text-muted-foreground" role="alert">
          {failure}
        </p>
      )}
    </main>
  );
}

function Body({
  view,
  oidcIssuer,
  session,
  trips,
  listing,
  settingsUrl,
  podRoot,
  onSignIn,
  onSignOut,
}: {
  view: StudioState;
  oidcIssuer: string;
  session: StudioSessionLike;
  /** Undefined means "ask the Pod" — see the prop's docblock. */
  trips: EditorTrip[] | undefined;
  listing: ListingState;
  /** §7.6's owner-only resource, for the editor. Resolved here rather than
   *  there because the editor reads no config and this is derived from
   *  `podRoot`, which arrived as a prop for exactly that reason. */
  settingsUrl: string;
  /** §4's one global `travel/media/` hangs off this, and the editor needs it for
   *  the same reason it needs `settingsUrl`: it reads no config. */
  podRoot: string;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  switch (view.status) {
    /**
     * A state, never a result. Rendering "signed out" here would flash a
     * sign-in button over a signed-in studio on every mount, and phase 0
     * measured that restore taking a network round-trip.
     */
    case "restoring":
      return <p className="mt-2 text-muted-foreground">{"Restoring your session…"}</p>;

    case "signed-out":
      return (
        <>
          <p className="mt-2 text-muted-foreground">
            {`Sign in with your Solid identity at ${oidcIssuer} to write in this diary.`}
          </p>
          <Action onClick={onSignIn}>{"Sign in"}</Action>
        </>
      );

    /**
     * Both WebIDs, because a visitor signed in with the wrong one of their
     * several — routine on Solid — otherwise has no way to see which. And no
     * "denied" / "permission" wording: the Pod is what refuses writes, this
     * screen only declines to offer them.
     */
    case "not-owner":
      return (
        <>
          <p className="mt-2">
            {`You are signed in as ${view.webId}; this diary belongs to ${view.owner}.`}
          </p>
          <p className="mt-2 text-muted-foreground">
            {"Sign out and back in with the owner's WebID to write here."}
          </p>
          <Action onClick={onSignOut}>{"Sign out"}</Action>
        </>
      );

    /** The owner UI. The `Signed in as …` line is what `e2e/solid-login.spec.ts`
     *  asserts on, and INVARIANT 5 STILL APPLIES below it:
     *  ./notes.md#the-signed-in-as-line-is-load-bearing */
    case "owner":
      return (
        <>
          <p className="mt-2 text-muted-foreground">{`Signed in as ${view.webId}.`}</p>
          <Action onClick={onSignOut}>{"Sign out"}</Action>
          <Writables
            session={session}
            trips={trips}
            listing={listing}
            settingsUrl={settingsUrl}
            podRoot={podRoot}
          />
        </>
      );
  }
}

/** What the owner may write into — one of four things, and the whole point is
 *  that they stay four: ./notes.md#four-things-and-the-whole-point-is-that-they-stay-four */
function Writables({
  session,
  trips,
  listing,
  settingsUrl,
  podRoot,
}: {
  session: StudioSessionLike;
  trips: EditorTrip[] | undefined;
  listing: ListingState;
  settingsUrl: string;
  podRoot: string;
}) {
  // Supplied means supplied: the caller has already decided, so no state of the
  // enumeration is consulted and none was ever started. See the prop docblock.
  if (trips !== undefined) {
    return (
      <Writable
        session={session}
        trips={trips}
        skipped={[]}
        settingsUrl={settingsUrl}
        podRoot={podRoot}
      />
    );
  }

  switch (listing.status) {
    /** Not a blank, and above all not the empty-state note. */
    case "pending":
      return (
        <p className="mt-8 text-muted-foreground">{"Looking for the trips on your Pod…"}</p>
      );

    /**
     * A FAILED ENUMERATION IS NOT AN EMPTY POD. `describe()` is what keeps 403
     * ("your trips container will not let you read it") and 404 ("first-run
     * setup never ran") distinguishable on the screen, rather than collapsing
     * into one sentence that fits neither.
     */
    case "failed":
      return (
        <>
          <p className="mt-8">
            {"Your Pod would not say which trips are in it, so there is nowhere to write yet. " +
              "That is not the same as having none — something went wrong reading them."}
          </p>
          <p className="mt-2 text-muted-foreground">{describePodError(listing.error)}</p>
        </>
      );

    case "ready":
      return (
        <Writable
          session={session}
          trips={listing.listing.trips}
          skipped={listing.listing.skipped}
          settingsUrl={settingsUrl}
          podRoot={podRoot}
        />
      );
  }
}

function Writable({
  session,
  trips,
  skipped,
  settingsUrl,
  podRoot,
}: {
  session: StudioSessionLike;
  trips: EditorTrip[];
  skipped: StudioTripListing["skipped"];
  settingsUrl: string;
  podRoot: string;
}) {
  return (
    <>
      <Skipped skipped={skipped} />
      {trips.length === 0 ? (
        /* Only when the Pod really is empty — with a skip in hand the note is
           false, and it avoids the not-owner message's contract phrase:
           ./notes.md#the-empty-pod-note-only-when-the-pod-really-is-empty */
        skipped.length === 0 && (
          <p className="mt-8 text-muted-foreground">
            {"No trips to write into yet. Every entry sits inside a trip (§4), so one has to " +
              "exist before there is anywhere to put an entry."}
          </p>
        )
      ) : (
        <EntryEditor
          session={session}
          trips={trips}
          settingsUrl={settingsUrl}
          podRoot={podRoot}
        />
      )}
    </>
  );
}

/** The trips the studio could not read, BY NAME — a count would not do it — and
 *  nothing at all when nothing was skipped:
 *  ./notes.md#the-trips-the-studio-could-not-read-by-name */
function Skipped({ skipped }: { skipped: StudioTripListing["skipped"] }) {
  if (skipped.length === 0) return null;
  return (
    <section className="mt-8 border border-hairline p-4">
      <h2 className="text-lg">{"Some trips could not be read"}</h2>
      <p className="mt-2 text-muted-foreground">
        {"These are on your Pod but the studio could not read them, so they are not offered " +
          "below. Check each one before writing into it."}
      </p>
      <ul className="mt-2">
        {skipped.map((skip) => (
          <li key={skip.url} className="text-muted-foreground">
            {`${skip.url} — ${skip.reason}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Deliberately plain: TODO.md keeps layout unstyled until phase 7, and a
 *  native button needs no Radix on a screen with two controls on it. */
function Action({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-6 cursor-pointer border border-hairline bg-surface px-4 py-2 hover:bg-hairline"
    >
      {children}
    </button>
  );
}

/** §7.6's owner-only resource, from the root this shell was handed. TOTAL: a
 *  malformed POD_ROOT throwing from a render takes the whole studio down, and
 *  `""` is §9's fail-closed answer:
 *  ./notes.md#settingsurlfor-is-total-and-the-empty-string-is-the-fail-closed-answer */
function settingsUrlFor(podRoot: string): string {
  try {
    return privacySettingsUrl(podRoot);
  } catch {
    return "";
  }
}

/** The enumeration itself, as a value rather than a throw. The catch IS
 *  reachable — `new URL("travel/trips/", podRoot)` throws on a malformed root:
 *  ./notes.md#the-enumeration-is-a-value-rather-than-a-throw */
async function enumerateTrips(
  session: StudioSessionLike,
  podRoot: string,
): Promise<ListingState> {
  try {
    const result = await listStudioTrips({
      // The session's own authenticated fetch, and never the ambient one. On a
      // Pod whose trips container happens to be publicly readable, anonymous
      // enumeration returns a list with every draft silently missing, which
      // looks exactly like success.
      fetch: session.fetch,
      podRoot,
    });
    return result.ok
      ? { status: "ready", listing: result.value }
      : { status: "failed", error: result.error };
  } catch (cause) {
    return {
      status: "failed",
      error: {
        kind: "network",
        url: podRoot,
        message: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }
}
