/**
 * The palette the map draws with, in hex because MapLibre parses hex and not
 * `oklch()`: ./notes.md#why-the-style-is-hex-and-not-oklch
 * Values are `app/globals.css`'s, checked against it by `tokens.test.ts`.
 */

/** Basemap, then the two-step accent the route and markers use. Roads and
 *  boundaries are NOT here: they are near-achromatic greys hand-stepped off
 *  `land` in `style.ts`, and `style.test.ts` bounds their channel spread. */
export const MAP_COLORS = {
  land: "#101316",
  water: "#152026",
  label: "#70757A",
  accent: "#1295FC",
  accentBright: "#84C0FD",
  accentDeep: "#034F8A",
} as const;

export type MapColor = keyof typeof MAP_COLORS;

/** The CSS custom property each mirrors. Same keys as `MAP_COLORS`, asserted,
 *  so neither object can gain a colour on its own. */
export const MAP_COLOR_TOKENS: Record<MapColor, string> = {
  land: "--color-map-land",
  water: "--color-map-water",
  label: "--color-map-label",
  accent: "--color-accent",
  accentBright: "--color-accent-bright",
  accentDeep: "--color-accent-deep",
};
