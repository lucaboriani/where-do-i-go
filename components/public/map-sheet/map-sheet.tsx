"use client";

import { useCallback, useEffect, useRef } from "react";
import { useTripHighlight } from "@/hooks/trip/highlight-context";
import { nextSnap, targetForRow, type SnapOffsets } from "./snap";

/** One scroll container, two spacers and a body. The drag is the browser's own
 *  scroll and the snapping is CSS; this file adds the handle and the arithmetic
 *  a pointer cannot do. ./notes.md#why-one-scroller */
export default function MapSheet({ children }: { children: React.ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const halfSpacer = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const { pinnedSlug, source } = useTripHighlight();

  const scrollToTop = useCallback((top: number) => {
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    scroller.current?.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  }, []);

  function cycle() {
    const offsets = measure(halfSpacer.current, body.current);
    if (offsets === null) return;
    scrollToTop(nextSnap(scroller.current?.scrollTop ?? 0, offsets));
  }

  // Keyed on the PIN, never on the active highlight a hover outranks:
  // ./notes.md#only-a-pin-moves-the-sheet
  useEffect(() => {
    if (pinnedSlug === null) return;
    const offsets = measure(halfSpacer.current, body.current);
    const row = rowFor(body.current, pinnedSlug);
    if (offsets === null || row === null) return;
    scrollToTop(targetForRow(row.offsetTop, handle.current?.offsetHeight ?? 0, offsets));
  }, [pinnedSlug, scrollToTop]);

  // The initial position, and ONLY the initial one: a fresh load on an entry
  // route opens the sheet so the prose is not below the fold.
  // ./notes.md#only-a-pin-moves-the-sheet
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (source !== "route") return;
    const offsets = measure(halfSpacer.current, body.current);
    if (offsets !== null) scroller.current?.scrollTo({ top: offsets.full, behavior: "auto" });
  }, [source]);

  return (
    <div ref={scroller} className="trip-sheet">
      <div className="trip-sheet-spacer-peek" aria-hidden />
      {/* The ref is on THIS spacer: its offsetTop IS the half snap position.
          The peek spacer's is 0. ./notes.md#the-offsets-are-read-not-computed */}
      <div ref={halfSpacer} className="trip-sheet-spacer-half" aria-hidden />
      <div ref={body} className="trip-sheet-body">
        <button ref={handle} type="button" className="trip-sheet-handle" onClick={cycle}>
          <span className="sr-only">Resize the entry list</span>
          <span aria-hidden className="block h-1 w-10 rounded-full bg-hairline" />
        </button>
        {children}
      </div>
    </div>
  );
}

/** The offsets are READ from the DOM, so `app/globals.css` stays the single
 *  source for the geometry. ./notes.md#the-offsets-are-read-not-computed */
function measure(halfSpacer: HTMLElement | null, body: HTMLElement | null): SnapOffsets | null {
  if (halfSpacer === null || body === null) return null;
  const strip = parseFloat(getComputedStyle(body).scrollMarginTop) || 0;
  return { peek: 0, half: halfSpacer.offsetTop, full: body.offsetTop - strip };
}

/** Matched on the dataset rather than through a selector: a slug is validated
 *  for length, not for CSS-safe characters. ./notes.md#only-a-pin-moves-the-sheet */
function rowFor(body: HTMLElement | null, slug: string): HTMLElement | null {
  if (body === null) return null;
  for (const el of body.querySelectorAll<HTMLElement>("[data-slug]")) {
    if (el.dataset.slug === slug) return el;
  }
  return null;
}
