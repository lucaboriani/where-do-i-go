import type { Metadata } from "next";
import { config } from "@/lib/config";
import "../globals.css";

/** Public root layout, separate from the studio's on purpose: separate root
 *  layouts are what keep the two bundles apart, and one shared root importing a
 *  session provider would undo the whole boundary in one line. NOTHING HERE MAY
 *  IMPORT FROM (studio), the Solid auth library, Radix, write-only Zod schemas or
 *  image code — enforced by no-restricted-imports and the CI bundle budget. */
export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  title: { default: config.siteName, template: `%s · ${config.siteName}` },
  description: "A travel diary that stores its own data in a Solid Pod.",
  alternates: { types: { "application/rss+xml": "/rss.xml" } },
  openGraph: { type: "website", siteName: config.siteName },
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
