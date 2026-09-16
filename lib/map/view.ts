export type Bbox = { west: number; south: number; east: number; north: number };

/** §6: one source clusters above ~50 points. At or below, every feature is a
 *  leaf and the cluster layers never fire. */
export const CLUSTER_THRESHOLD = 50;

/** §6 puts the projection choice here. It is a value, not a call: the one
 *  setProjection call site stays in use-map-instance.ts. */
export const PROJECTION = { type: "mercator" } as const;

/** MapLibre expands "globe" to an interpolation: globe below z11, mercator
 *  above z12. ./notes.md#why-the-globe-is-a-shorthand-not-vertical-perspective */
export const GLOBE_PROJECTION = { type: "globe" } as const;

export const ROUTE_WIDTH = 1.5;
export const ROUTE_WIDTH_ACTIVE = 2.5;
// (CASING_EXTRA deleted — the route no longer has a casing. docs/decisions.md §34.)

export function shouldCluster(count: number): boolean {
  return count > CLUSTER_THRESHOLD;
}

export function fitOptions(bbox: Bbox) {
  return {
    bounds: [
      [bbox.west, bbox.south],
      [bbox.east, bbox.north],
    ] as [[number, number], [number, number]],
    padding: 32,
    animate: false as const,
  };
}
