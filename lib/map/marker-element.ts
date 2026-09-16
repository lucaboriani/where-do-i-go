import type { PointProps } from "@/lib/map/points";

const BASE = "map-marker";
/** A fuzzed coordinate is a circle, an exact one a pin: the shape is the claim
 *  the data makes. docs/design-brief.md, and lib/place/precision.ts owns the
 *  matching decimal count. */
const EXACT = "map-marker--exact";
const FUZZED = "map-marker--fuzzed";
// Kept out of BASE: applied by a classList.toggle, not composed at build time.
export const MARKER_ACTIVE = "ring-2 ring-accent-bright";

export function buildMarkerElement({
  slug,
  title,
  thumbnail,
  precisionMeters,
}: PointProps): HTMLElement {
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
    el.append(img);
  }
  return el;
}
