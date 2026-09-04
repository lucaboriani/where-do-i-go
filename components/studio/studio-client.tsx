"use client";

/**
 * The seam between the server page and the shell, and the only reason it
 * exists: Next 16 rejects `ssr: false` inside a server component outright —
 * "`ssr: false` is not allowed with `next/dynamic` in Server Components.
 * Please move it into a Client Component"
 * (node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md). So the studio
 * is three files: server page → this wrapper → the shell.
 *
 * WHY THE AUTH LIBRARY IS IMPORTED IN AN EFFECT AND NOT AT MODULE SCOPE.
 * This wrapper is a client component rendered by a server page, so Next
 * prerenders it: its module scope and its render function both run in node.
 * Only the `ssr: false` subtree is skipped. A static
 * `import { getDefaultSession } from "@inrupt/solid-client-authn-browser"` here
 * would therefore evaluate the auth library during the build — measured to work
 * on node 22, so it would not fail loudly, it would just quietly put the
 * browser session library on the server, which is the one place
 * app/(studio)/studio/page.tsx says it must never be — and it would also land
 * the whole library in the chunk `/studio` loads eagerly, defeating the lazy
 * boundary the file exists to draw.
 *
 * An `import()` inside an effect runs in the browser and nowhere else. The cost
 * is one extra render with no session, which is served as static HTML for
 * `/studio` and replaced on hydration; the shell's own `restoring` state
 * follows it immediately, so it is the same waiting screen twice, not a flash
 * of the wrong one.
 *
 * `getDefaultSession()` is the library's module-level singleton, so the two
 * StrictMode invocations of the effect hand back the same object and the second
 * `setSession` is a no-op rather than a second session.
 */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { StudioSessionLike } from "@/lib/studio/session";
import type { StudioShellProps } from "./studio-shell";

const StudioShell = dynamic(() => import("./studio-shell"), {
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
