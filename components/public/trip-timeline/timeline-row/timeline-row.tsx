"use client";

import { useTripHighlight } from "@/hooks/trip/highlight-context";

export default function TimelineRow({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  const { activeSlug, raise, clear } = useTripHighlight();
  const isActive = activeSlug === slug;

  return (
    // Handlers on the row, not the link: React's onFocus delegates the bubbling
    // focusin, so focus and hover share one path. ./notes.md#why-the-handlers-sit-on-the-row
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
