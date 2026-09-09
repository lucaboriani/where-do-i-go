/**
 * How `dy:precisionMeters` is rendered, on the reading page as well as in the
 * studio. No React and no DOM. ./notes.md#why-precisionlabel-left-placets
 */

/** `500` → `~500 m`, `10000` → `~10 km`. The tilde is the honest part: what is
 *  published is a cell of about this size, not a distance from anywhere. */
export function precisionLabel(metres: number): string {
  return metres >= 1000 && metres % 100 === 0 ? `~${metres / 1000} km` : `~${metres} m`;
}
