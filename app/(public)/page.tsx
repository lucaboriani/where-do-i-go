import Link from "next/link";
import { getDiary, publishedTripSlugs } from "@/lib/pod/cached";
import { describe } from "@/lib/pod/result";

export default async function Home() {
  const diary = await getDiary();

  if (!diary.ok) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl">{"This diary is unavailable"}</h1>
        <p className="mt-2 text-muted-foreground">{describe(diary.error)}</p>
      </main>
    );
  }

  // Not diary.value.trips: that lists drafts too, because trips have no index
  // acting as a publication boundary the way entries do.
  const published = await publishedTripSlugs();
  const slugs = published.ok ? published.value : [];

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl">{diary.value.title?.value ?? "Travel diary"}</h1>
      {diary.value.description && (
        <p className="mt-2 text-muted-foreground">{diary.value.description.value}</p>
      )}
      <ul className="mt-8 space-y-2">
        {slugs.map((slug) => (
          <li key={slug}>
            <Link className="text-accent-bright underline" href={`/trips/${slug}`}>
              {slug}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
