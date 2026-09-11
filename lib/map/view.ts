export type Bbox = { west: number; south: number; east: number; north: number };

/** §6: one source clusters above ~50 points. At or below, every feature is a
 *  leaf and the cluster layers never fire. */
export const CLUSTER_THRESHOLD = 50;

/** §6 puts the projection choice here. It is a value, not a call: the one
 *  setProjection call site stays in use-map-instance.ts. */
export const PROJECTION = { type: "mercator" } as const;

export const ROUTE_WIDTH = 2.5;
/** Casing is drawn at ROUTE_WIDTH + this, i.e. 1.75px each side — inside the
 *  design brief's 1.5–2px requirement. */
export const CASING_EXTRA = 3.5;

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
