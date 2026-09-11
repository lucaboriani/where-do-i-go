import type { PointProps } from "@/lib/map/points";

const BASE = "size-10 overflow-hidden border-2 border-accent bg-surface";
/** A fuzzed coordinate is a circle, an exact one a pin: the shape is the claim
 *  the data makes. docs/design-brief.md, and lib/place/precision.ts owns the
 *  matching decimal count. */
const EXACT = "rounded-sm";
const FUZZED = "rounded-full opacity-80";

export function buildMarkerElement({ slug, title, thumbnail, precisionMeters }: PointProps): HTMLElement {
  const el = document.createElement("div");
  el.className = `${BASE} ${precisionMeters === undefined ? EXACT : FUZZED}`;
  el.dataset.slug = slug;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", title);

  if (thumbnail !== undefined) {
    const img = document.createElement("img");
    img.src = thumbnail;
    img.alt = "";
    img.loading = "lazy";
    img.className = "size-full object-cover";
    el.append(img);
  }
  return el;
}
