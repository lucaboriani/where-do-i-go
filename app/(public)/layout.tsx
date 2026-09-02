import type { Metadata } from "next";
import { config } from "@/lib/config";
import "../globals.css";

/**
 * Public root layout. Separate from the studio's on purpose: separate root
 * layouts are what keep the two bundles apart, and a single shared root
 * importing a session provider would undo the whole boundary in one line.
 *
 * Nothing here may import from (studio), the Solid auth library, Radix,
 * write-only Zod schemas, or image-processing code. Enforced by
 * no-restricted-imports and by the size-limit budget that fails CI.
 */
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
