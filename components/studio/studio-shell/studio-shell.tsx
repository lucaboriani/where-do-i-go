"use client";

/**
 * The studio shell — the one component that owns the session state.
 *
 * WHAT IT IS NOT ALLOWED TO DO, and both are load-bearing rather than stylistic:
 *
 *   1. It imports NO VALUE from @inrupt/solid-client-authn-browser. The session
 *      arrives as a prop, which is what lets every behaviour below be tested
 *      against a plain object instead of an OIDC round-trip, and what keeps the
 *      library inside the `ssr: false` boundary that
 *      components/studio/studio-client.tsx draws.
 *   2. It reads NO config and NO env var. OWNER_WEBID, SITE_URL and SITE_NAME
 *      are not `NEXT_PUBLIC_`, so `lib/config.ts` throws the moment it is
 *      reached in a browser; `oidcIssuer` has no env var at all by design
 *      (docs/data-model.md §7.5 — it comes out of the owner's WebID document).
 *      All five values are props, handed down by the thin server component at
 *      app/(studio)/studio/page.tsx.
 *
 * THE BEHAVIOUR ALL LIVES IN lib/studio/session.ts. This file composes those
 * five functions and renders the verdict; it deliberately reimplements none of
 * them. In particular it never compares WebIDs with `===` (studioState routes
 * through sameWebId, which compares IRIs and fails closed) and never reads
 * `session.info` on an expiry (the event is the truth; `info.isLoggedIn` is
 * still `true` at that instant).
 *
 * INVARIANT 5. The owner verdict below decides what is rendered and nothing
 * else. The Pod enforces authorisation, so the `not-owner` message is a
 * courtesy — "you are signed in as X; this diary belongs to Y" — and must not
 * be worded as though this check were the protection.
 *
 * THE ONE REQUEST THIS COMPONENT MAKES is the trips listing, and it is made
 * ONLY on the `owner` branch. An authenticated enumeration fired for a visitor
 * who is not the owner is a request that will 403 on a real Pod, and firing it
 * says the studio asked a question it had no business asking. That is not
 * invariant 5 being relied on for protection — the Pod still decides — it is
 * simply not asking.
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
  /**
   * The Pod's storage root, with a trailing slash. `config.podRoot` is the only
   * thing that normalises the slash, and every URL in `lib/studio/trips.ts` is
   * built with `new URL("travel/trips/", podRoot)` — without it that resolves
   * against the PARENT and 404s.
   *
   * A prop for the same reason the four values above are: POD_ROOT is not
   * `NEXT_PUBLIC_`, so lib/config.ts throws the moment it is reached in a
   * browser, and this component runs in the browser.
   */
  podRoot: string;
  /**
   * The trips the owner can write an entry into.
   *
   * A TEST SEAM, and it is labelled as one so that nobody later "cleans up" a
   * prop they cannot find a caller for: PRODUCTION PASSES NOTHING. The studio
   * is mounted with `ssr: false`, so nothing upstream of this component holds
   * an authenticated fetch and no server component can resolve the list. It is
   * injected here for exactly the reason the session is — twenty cases in
   * test/studio-shell.test.tsx are about what this component RENDERS given its
   * trips, and none of them wants a Pod in it.
   *
   * SUPPLIED MEANS SUPPLIED: offer exactly these and ask the Pod nothing.
   * ABSENT means ask the Pod. So `[]` and `undefined` are NOT interchangeable,
   * and a `trips = []` default in the destructuring — which is what used to be
   * here — would silently make every caller the first case and the enumeration
   * below dead code.
   */
  trips?: EditorTrip[];
}

/**
 * Where the enumeration has got to.
 *
 * `pending` IS A STATE, NEVER A RESULT — the same rule `restoring` is held to
 * one level up, and for the same reason. "No trips to write into yet" asserts
 * that the owner's Pod has no trips, and that is false while the request is
 * still in flight; rendering it there tells the owner something untrue about
 * their own data.
 *
 * `failed` is likewise not `ready` with an empty list. `listStudioTrips` keeps
 * "your Pod has none" and "your Pod would not answer" apart deliberately, and
 * flattening them here would send an owner whose container is closed or absent
 * off to write a first trip, which is the one thing that will not help.
 */
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

  /**
   * ENUMERATE ONLY FOR THE OWNER, AND ONLY WHEN NOBODY HANDED US A LIST.
   *
   * Two booleans rather than `view` itself, and that is load-bearing:
   * `studioState` returns a FRESH OBJECT on every render, so a listing keyed on
   * it would re-enter on its own result — not a doubled request but an
   * unbounded one. Everything in the dependency list below is either a
   * primitive or the injected session, which the shell already treats as stable.
   */
  const enumerating = view.status === "owner" && trips === undefined;

  /**
   * The in-flight listing, memoised by the root it was started for.
   *
   * The same defence `restoreSession` documents, one level up and for the same
   * reason: StrictMode invokes an effect twice, with the cleanup in between, so
   * the naive shape starts two enumerations and throws the first one's result
   * away. Sharing the promise means the second invocation attaches a second
   * `.then` to the first request rather than making a second one — a `return`
   * on the second invocation would instead abandon the only result there is,
   * because the cleanup has already set the first `live` to false.
   *
   * The ref is deliberately NOT cleared on cleanup. A real unmount discards the
   * whole fiber and the next mount gets a fresh one; clearing it here would
   * only re-open the StrictMode hole above.
   */
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

    /**
     * The owner UI: the sign-out control, and the editor.
     *
     * The `Signed in as …` line is load-bearing beyond courtesy —
     * e2e/solid-login.spec.ts asserts on it as the thing that distinguishes
     * this branch from `not-owner` after a real login round trip, and its
     * argument is that the absence of the not-owner wording alone would be a
     * weak assertion.
     *
     * INVARIANT 5 STILL APPLIES to everything below it. Rendering the editor is
     * not permission to write: the session's own fetch carries the credential,
     * and the Pod is what accepts or refuses every request it makes.
     */
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

/**
 * What the owner may write into — one of four things, and the whole point of
 * this component is that they stay four.
 *
 * A lazier version renders the editor when there is a list and the "no trips"
 * note otherwise, which silently says "your Pod has no trips" to an owner whose
 * request is still in flight, whose container is closed, and whose container is
 * not there at all. Three different problems, three different next actions, one
 * apology.
 */
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
        /**
         * Only when the Pod really is empty. With a skip in hand the note would
         * be false in the same way as rendering it mid-request: there IS a trip
         * up there, it just could not be read, and `Skipped` above has already
         * said so by name.
         *
         * The wording avoids the phrase "belongs to" on purpose: that is the
         * not-owner courtesy message's contract phrase, and
         * test/studio-shell.test.tsx queries it to prove the owner is never
         * shown it.
         */
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

/**
 * The trips the studio could not read, BY NAME.
 *
 * `listStudioTrips` skips one unreadable member rather than failing the lot —
 * `rebuildIndex`'s rule, "a single bad resource must not make the whole trip
 * unrecoverable". The other half of that bargain is this: a trip the studio
 * cannot read is a trip the owner cannot write into, and saying nothing leaves
 * them wondering where it went. A count would not do it — the owner needs to
 * know WHICH one to go and look at.
 *
 * Renders nothing at all when nothing was skipped. A permanent "0 trips could
 * not be read" is noise, and noise is how a real skip goes unnoticed.
 */
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

/**
 * §7.6's owner-only resource, from the root this shell was handed.
 *
 * TOTAL, FOR THE REASON `enumerateTrips` BELOW CATCHES: `privacySettingsUrl`
 * builds `new URL("travel/settings/privacy.ttl", podRoot)`, and a malformed
 * POD_ROOT makes that throw synchronously. Thrown from a render rather than
 * from an effect, it would take the whole studio down — a blank screen where
 * the trips listing is already prepared to say what went wrong.
 *
 * The empty string is a URL that can only fail to read, and failing to read is
 * §9's fail-closed answer: the coordinate controls stay dead and say so, while
 * everything else on the form still works. A configuration that reaches here is
 * already showing the owner a failed enumeration.
 */
function settingsUrlFor(podRoot: string): string {
  try {
    return privacySettingsUrl(podRoot);
  } catch {
    return "";
  }
}

/**
 * The enumeration itself, as a value rather than a throw.
 *
 * `listStudioTrips` promises to return a `Result` and never to reject, so the
 * catch below is not defensive padding around a working function: it is
 * reachable, because `tripsContainerUrl` builds `new URL("travel/trips/",
 * podRoot)` and a malformed POD_ROOT makes that throw synchronously — turned
 * into a rejection by the `async` keyword. An unhandled rejection in a React
 * effect is a studio that renders "Looking for the trips…" for ever with the
 * reason only in the console.
 */
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
