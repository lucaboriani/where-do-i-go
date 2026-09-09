import Link from "next/link";
import "./globals.css";

/** Root not-found, for paths that match no route group at all. It renders its
 *  own <html>/<body> because there is no root layout to wrap it — separate root
 *  layouts per group are what keep the bundles apart — and without it unrouted
 *  paths fall back to Next's stock 404 and the site has two 404 designs. */
export default function RootNotFound() {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto max-w-2xl p-8">
          <h1 className="text-2xl">Not found</h1>
          <p className="mt-2 text-muted-foreground">
            There is nothing at this address.
          </p>
          <p className="mt-6">
            <Link className="text-accent-bright underline" href="/">
              Back to the diary
            </Link>
          </p>
        </main>
      </body>
    </html>
  );
}
