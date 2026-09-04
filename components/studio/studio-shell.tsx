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
 */

import { useEffect, useState } from "react";
import {
  restoreSession,
  signIn,
  signOut,
  studioState,
  subscribeSessionState,
} from "@/lib/studio/session";
import EntryEditor from "./entry-editor";
import type { EditorTrip } from "./entry-editor";
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
   * The trips the owner can write an entry into, resolved server-side where the
   * Pod's layout is known — this component reads no config either.
   *
   * OPTIONAL, and empty by default, because the editor is the only thing that
   * uses it and a studio with no trips is a real state rather than a broken
   * one: entries live inside a trip (§4), and creating a trip is not in this
   * phase. With none, the owner is told so instead of being shown a form whose
   * every save would have nowhere to go.
   */
  trips?: EditorTrip[];
}

export default function StudioShell({
  session,
  ownerWebId,
  oidcIssuer,
  siteUrl,
  siteName,
  trips = [],
}: StudioShellProps) {
  const [state, setState] = useState<SessionState>({ status: "restoring" });
  const [failure, setFailure] = useState<string | null>(null);

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
  onSignIn,
  onSignOut,
}: {
  view: StudioState;
  oidcIssuer: string;
  session: StudioSessionLike;
  trips: EditorTrip[];
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
          {/* The empty-trip note is worded around the phrase "belongs to":
              that is the not-owner courtesy message's contract phrase, and
              test/studio-shell.test.tsx queries it to prove the owner is never
              shown it. */}
          {trips.length === 0 ? (
            <p className="mt-8 text-muted-foreground">
              {"No trips to write into yet. Every entry sits inside a trip (§4), so one has to " +
                "exist before there is anywhere to put an entry."}
            </p>
          ) : (
            <EntryEditor session={session} trips={trips} />
          )}
        </>
      );
  }
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
