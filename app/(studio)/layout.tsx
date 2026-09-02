import "../globals.css";

/**
 * Studio root layout. Authenticated, client-side, and never server-rendered
 * with Pod credentials — there are none. The route guard this layout will grow
 * is UX, not security: all authorisation is enforced by the Pod.
 */
export const metadata = { robots: { index: false, follow: false } };

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
