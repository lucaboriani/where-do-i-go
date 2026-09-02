import Link from "next/link";

/**
 * Rendered by notFound() and by the proxy's 404 rewrite. Deliberately plain —
 * the design brief is applied in phase 7 — but it must not be blank: the proxy
 * previously returned an empty body, which is a worse experience than Next's
 * stock page it replaced.
 */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl">Not found</h1>
      <p className="mt-2 text-muted-foreground">
        There is no trip or entry at this address. It may have been unpublished, or the link may be
        wrong.
      </p>
      <p className="mt-6">
        <Link className="text-accent-bright underline" href="/">
          Back to the diary
        </Link>
      </p>
    </main>
  );
}
