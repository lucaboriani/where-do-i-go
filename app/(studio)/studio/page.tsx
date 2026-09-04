/**
 * Studio entry point. Phase 2 replaces this with a thin server component whose
 * `"use client"` wrapper dynamically imports the shell with `ssr: false` — the
 * Solid session lives in the visitor's browser and must never be constructed on
 * the server. The `ssr: false` cannot sit in this file: Next 16 rejects it in a
 * server component. The page's job is to read the non-`NEXT_PUBLIC_` config and
 * hand it down as props.
 */
export default function StudioPage() {
  return <main>Studio — not implemented yet. See TODO.md phase 2.</main>;
}
