"use client";

import { useTripHighlight } from "@/hooks/trip/highlight-context";

export default function TripRow({ slug, children }: { slug: string; children: React.ReactNode }) {
  const { activeSlug, raise, clear } = useTripHighlight();
  const isActive = activeSlug === slug;

  return (
    // Handlers on the row, not the link, and the source is "timeline" — the
    // union names the not-the-map side, not this component.
    // ./notes.md#why-the-source-is-timeline
    <li
      data-active={isActive || undefined}
      data-slug={slug}
      onPointerEnter={() => raise(slug, "timeline")}
      onPointerLeave={clear}
      onFocus={() => raise(slug, "timeline")}
      onBlur={clear}
      // NOT data-[active]:bg-surface — the bracket form trips TW_ARBITRARY, and
      // the bare data-active: variant is unverified on this Tailwind. A ternary
      // of literal class strings is neither clever nor arbitrary.
      className={isActive ? "rounded-sm bg-surface p-2" : "rounded-sm p-2"}
    >
      {children}
    </li>
  );
}
