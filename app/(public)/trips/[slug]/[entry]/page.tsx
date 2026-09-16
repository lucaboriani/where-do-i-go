import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { EntrySection } from "@/components/public/entry-section";
import { SiteFooter } from "@/components/public/site-footer";
import { config } from "@/lib/config";
import { allEntryParams, getEntry } from "@/lib/pod/cached";
import { precisionLabel } from "@/lib/place/precision";
import { describe } from "@/lib/pod/result";
import type { Entry } from "@/lib/pod/schema";

export async function generateStaticParams() {
  return allEntryParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; entry: string }>;
}): Promise<Metadata> {
  const { slug, entry } = await params;
  const e = await getEntry(slug, entry);
  // Same reason as the trip route: metadata runs regardless of what the body
  // renders, so a draft headline would otherwise leak into the served HTML.
  if (!e.ok || e.value.status !== "published") return { title: "Not found" };
  return {
    title: e.value.headline.value,
    description: e.value.sections.find((s) => s.text)?.text?.value?.slice(0, 160),
  };
}

/** Same shape as the trip route: params are passed down, not awaited here, so
 *  the shell is instant and the entry streams in. */
export default function EntryPage(props: { params: Promise<{ slug: string; entry: string }> }) {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <Suspense fallback={<EntrySkeleton />}>
        <EntryContent params={props.params} />
      </Suspense>
    </main>
  );
}

function EntrySkeleton() {
  return (
    <div aria-hidden className="animate-pulse">
      <div className="h-8 w-3/4 rounded-sm bg-surface" />
      <div className="mt-3 h-4 w-1/2 rounded-sm bg-surface" />
      <div className="mt-6 space-y-2">
        <div className="h-4 w-full rounded-sm bg-surface" />
        <div className="h-4 w-full rounded-sm bg-surface" />
        <div className="h-4 w-4/5 rounded-sm bg-surface" />
      </div>
    </div>
  );
}

// Exported for page.test.tsx: React's client renderer rejects an async
// function component reached through JSX (app/(public)/page.tsx makes the same
// call for DiaryContent), so the resolved path is tested by calling this
// directly rather than rendering <EntryPage>.
export async function EntryContent({
  params,
}: {
  params: Promise<{ slug: string; entry: string }>;
}) {
  const { slug, entry } = await params;

  // Second line of defence, like the trip route: this renders the right body,
  // but it cannot set the status — the shell has already been flushed
  // (decisions.md §24). The proxy does not yet check entry slugs, so a guessed
  // entry under a real trip returns 200 with this not-found body; recorded in
  // TODO.md rather than papered over.
  const known = await allEntryParams();
  if (!known.some((p) => p.slug === slug && p.entry === entry)) notFound();

  const e = await getEntry(slug, entry);

  if (!e.ok) {
    if (e.error.kind === "http" && (e.error.status === 404 || e.error.status === 401)) notFound();
    return <p className="text-muted-foreground">{describe(e.error)}</p>;
  }

  // A draft that is readable is still not published. The index would not list
  // it, but a direct URL must not render it either.
  if (e.value.status !== "published") notFound();

  return (
    <>
      <div className="wrap">
        <header className="masthead">
          <p className="breadcrumb">
            <a href={`/trips/${slug}`}>{"← Back to the trip"}</a>
          </p>
          <h1 className="display">{e.value.headline.value}</h1>
          <MetaRow entry={e.value} />
        </header>
      </div>
      {e.value.sections.map((s, i) => (
        <EntrySection key={i} section={s} />
      ))}
      <SiteFooter siteName={config.siteName} status={`${slug} · read from a pod, not a database`} />
    </>
  );
}

/** The Arrived / Where / Precision / Arrived-by row, split out to keep
 *  EntryContent under the render-function line bound. Renders only the pairs
 *  whose data is present (spec §8). */
function MetaRow({ entry }: { entry: Entry }) {
  const place = entry.place;
  return (
    <dl className="meta-row">
      {entry.occurredAt && (
        <div>
          <dt>Arrived</dt>
          <dd>
            <time className="data" dateTime={entry.occurredAt}>
              {entry.occurredAt}
            </time>
          </dd>
        </div>
      )}
      {(place?.name || place?.geo) && (
        <div>
          <dt>Where</dt>
          <dd>
            {place?.name && <>{place.name.value} </>}
            {place?.geo && (
              <span
                className={
                  place.geo.precisionMeters === undefined ? "precision exact" : "precision"
                }
              >
                {formatCoordinate(place.geo.lat, place.geo.long, place.geo.precisionMeters)}
              </span>
            )}
          </dd>
        </div>
      )}
      {place?.geo?.precisionMeters !== undefined && (
        <div>
          <dt>Precision</dt>
          <dd className="data">{precisionLabel(place.geo.precisionMeters)}</dd>
        </div>
      )}
      {entry.travelModeFrom && (
        <div>
          <dt>Arrived by</dt>
          <dd className="data">{entry.travelModeFrom}</dd>
        </div>
      )}
    </dl>
  );
}

/** `-49.33, -72.89` → `49.33°S 72.89°W`, at 4 decimals when exact (no fuzz
 *  applied) and 2 when fuzzed — the extra precision an exact reading has would
 *  otherwise imply where a fuzzed one does not (lib/place/precision.ts). */
function formatCoordinate(lat: number, long: number, precisionMeters?: number): string {
  const decimals = precisionMeters === undefined ? 4 : 2;
  const latAbs = Math.abs(lat).toFixed(decimals);
  const longAbs = Math.abs(long).toFixed(decimals);
  return `${latAbs}°${lat < 0 ? "S" : "N"} ${longAbs}°${long < 0 ? "W" : "E"}`;
}
