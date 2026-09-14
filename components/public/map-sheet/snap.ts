/** The sheet's three rest positions, as scrollTop values MEASURED from the DOM
 *  — never recomputed from dvh here. ./notes.md#the-offsets-are-read-not-computed */
export type SnapOffsets = { peek: number; half: number; full: number };

// A rest position is fractional on a scaled display, and a flick can stop a
// pixel short of a detent.
const EPSILON = 2;

export function nextSnap(current: number, { peek, half, full }: SnapOffsets): number {
  if (current < half - EPSILON) return half;
  if (current < full - EPSILON) return full;
  return peek;
}

/** The half floor is defensive — every row in the current layout already sits
 *  past full. Past full is allowed: a long timeline scrolls freely there
 *  (spec §2). ./notes.md#only-a-pin-moves-the-sheet */
export function targetForRow(rowTop: number, handleHeight: number, { half }: SnapOffsets): number {
  return Math.max(half, rowTop - handleHeight);
}
