"use client";

import Link from "next/link";
import { useTripHighlight } from "@/hooks/trip/highlight-context";
import { wallClockOf } from "@/lib/time/offsets";
import type { IndexEntry } from "@/lib/pod/schema";

export default function TimelineRow({ href, entry }: { href: string; entry: IndexEntry }) {
  const { activeSlug, raise, clear } = useTripHighlight();
  const wall = wallClockOf(entry.occurredAt);

  return (
    // Handlers on the row, not the link: React's onFocus delegates the bubbling
    // focusin, so focus and hover share one path. ./notes.md#why-the-handlers-sit-on-the-row
    <li
      data-active={activeSlug === entry.slug || undefined}
      onPointerEnter={() => raise(entry.slug, "timeline")}
      onPointerLeave={clear}
      onFocus={() => raise(entry.slug, "timeline")}
      onBlur={clear}
      // NOT data-[active]:bg-surface — the bracket form trips TW_ARBITRARY, and
      // the bare data-active: variant is unverified on this Tailwind. A ternary
      // of literal class strings is neither clever nor arbitrary.
      className={activeSlug === entry.slug ? "rounded-sm bg-surface p-2" : "rounded-sm p-2"}
    >
      <Link className="text-accent-bright underline" href={href}>
        {entry.title.value}
      </Link>
      {wall !== "" && (
        <time dateTime={entry.occurredAt} className="ml-2 font-mono text-sm text-muted-foreground">
          <span>{wall.slice(0, 10)}</span> <span>{wall.slice(11, 16)}</span>
        </time>
      )}
    </li>
  );
}
