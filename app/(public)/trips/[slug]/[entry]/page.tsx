import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { allEntryParams, getEntry } from "@/lib/pod/cached";
import { describe } from "@/lib/pod/result";

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
  return { title: e.value.headline.value, description: e.value.articleBody?.value?.slice(0, 160) };
}

/** Same shape as the trip route: params are passed down, not awaited here, so
 *  the shell is instant and the entry streams in. */
export default function EntryPage(props: {
  params: Promise<{ slug: string; entry: string }>;
}) {
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

async function EntryContent({
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
      <h1 className="text-2xl">{e.value.headline.value}</h1>
      {e.value.occurredAt && (
        <p className="mt-1 text-sm text-muted-foreground">
          <time dateTime={e.value.occurredAt}>{e.value.occurredAt}</time>
          {e.value.place?.name && <span> · {e.value.place.name.value}</span>}
        </p>
      )}
      {e.value.articleBody && (
        <div className="mt-6 whitespace-pre-line">{e.value.articleBody.value}</div>
      )}
      <p className="mt-8 text-sm text-muted-foreground">
        <a className="text-accent-bright underline" href={`/trips/${slug}`}>
          Back to the trip
        </a>
      </p>
    </>
  );
}
