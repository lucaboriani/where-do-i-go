import { config } from "@/lib/config";
import { allTripSlugs, getDiary, getTripIndex } from "@/lib/pod/cached";

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Built from the index resources only — the same source the public pages read,
 * so the feed cannot contain something the site would not show.
 */
export async function GET() {
  const base = config.siteUrl.replace(/\/$/, "");
  const diary = await getDiary();
  const title = diary.ok ? (diary.value.title?.value ?? config.siteName) : config.siteName;

  const items: string[] = [];
  for (const slug of await allTripSlugs()) {
    const index = await getTripIndex(slug);
    if (!index.ok) continue;
    for (const e of index.value.entries) {
      const link = `${base}/trips/${slug}/${e.slug}`;
      items.push(
        `    <item>\n` +
          `      <title>${escape(e.title.value)}</title>\n` +
          `      <link>${escape(link)}</link>\n` +
          `      <guid isPermaLink="true">${escape(link)}</guid>\n` +
          (e.occurredAt ? `      <pubDate>${new Date(e.occurredAt).toUTCString()}</pubDate>\n` : "") +
          `    </item>`,
      );
    }
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0">\n  <channel>\n` +
    `    <title>${escape(title)}</title>\n` +
    `    <link>${escape(base)}</link>\n` +
    (diary.ok && diary.value.description
      ? `    <description>${escape(diary.value.description.value)}</description>\n`
      : "") +
    `${items.join("\n")}\n` +
    `  </channel>\n</rss>\n`;

  return new Response(xml, {
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
}
