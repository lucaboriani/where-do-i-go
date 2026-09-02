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

export default async function EntryPage({
  params,
}: {
  params: Promise<{ slug: string; entry: string }>;
}) {
  const { slug, entry } = await params;

  // Same reason as the trip route: reject unknown (trip, entry) pairs against
  // the cached list first, so the 404 status is set before the shell flushes.
  const known = await allEntryParams();
  if (!known.some((p) => p.slug === slug && p.entry === entry)) notFound();

  const e = await getEntry(slug, entry);

  if (!e.ok) {
    if (e.error.kind === "http" && (e.error.status === 404 || e.error.status === 401)) notFound();
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-muted-foreground">{describe(e.error)}</p>
      </main>
    );
  }

  // A draft that is readable is still not published. The index would not list
  // it, but a direct URL must not render it either.
  if (e.value.status !== "published") notFound();

  return (
    <main className="mx-auto max-w-2xl p-8">
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
    </main>
  );
}
