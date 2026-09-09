"use client";

/**
 * The seam between the server page and the shell: Next 16 refuses `ssr: false`
 * in a server component, so the studio is three files. THE AUTH LIBRARY IS
 * IMPORTED IN AN EFFECT AND MUST STAY THERE — at module scope Next prerenders
 * it onto the server and into the eager chunk. ./notes.md#why-this-wrapper-exists-at-all
 */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { StudioSessionLike } from "@/lib/studio/session";
import type { StudioShellProps } from "@/components/studio/studio-shell";

const StudioShell = dynamic(() => import("@/components/studio/studio-shell"), {
  ssr: false,
  loading: () => <Waiting />,
});

/** Everything the shell needs except the session, which cannot cross the
 *  server/client boundary and is constructed here instead. */
export type StudioClientProps = Omit<StudioShellProps, "session">;

export default function StudioClient(props: StudioClientProps) {
  const [session, setSession] = useState<StudioSessionLike | null>(null);

  useEffect(() => {
    let live = true;
    void import("@inrupt/solid-client-authn-browser").then(({ getDefaultSession }) => {
      if (live) setSession(getDefaultSession());
    });
    return () => {
      live = false;
    };
  }, []);

  if (session === null) return <Waiting />;
  return <StudioShell session={session} {...props} />;
}

function Waiting() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <p className="text-muted-foreground">{"Loading the studio…"}</p>
    </main>
  );
}
