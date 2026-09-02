import type { Metadata } from "next";
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
  title: process.env.SITE_NAME ?? "Travel diary",
  description: "A travel diary that stores its own data in a Solid Pod.",
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
