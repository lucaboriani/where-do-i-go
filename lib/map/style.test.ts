/**
 * The basemap, checked against the real style spec rather than against its own
 * object literal. Why seventeen: ./notes.md#seventeen-layers-and-what-was-left-out
 */

import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { MAP_COLORS } from "@/lib/map/tokens";
import { FONTSTACK, GLYPHS_URL, SOURCE_ID, TILES_URL, buildBasemapStyle } from "@/lib/map/style";

describe("buildBasemapStyle", () => {
  it("is accepted by the MapLibre style spec", () => {
    // The point of the whole file: an assertion against our own literal would
    // verify nothing. validateStyleMin is the real validator, offline.
    expect(validateStyleMin(buildBasemapStyle()).map((e) => e.message)).toEqual([]);
  });

  it("draws from OpenFreeMap, which needs no key, no account and no cookies", () => {
    // The LITERAL host, not TILES_URL — comparing the output against the
    // module's own constants is a tautology that stays green if someone
    // repoints them at a keyed provider, which is invariant 6 breaking.
    const style = buildBasemapStyle();
    expect(style.sources[SOURCE_ID]).toEqual({
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
    });
    expect(style.glyphs).toBe(
      "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    );
    // And the constants are what the style actually uses, so the two halves
    // of this file cannot disagree.
    expect(TILES_URL).toBe("https://tiles.openfreemap.org/planet");
    expect(GLYPHS_URL).toBe(style.glyphs);
  });

  it("carries no API key, token or placeholder for one, anywhere", () => {
    // Invariant 6 is "zero required API keys", and it is a product feature.
    expect(JSON.stringify(buildBasemapStyle())).not.toMatch(
      /\{?(key|access[_-]?token|api[_-]?key|apikey)\}?/i,
    );
  });

  it("uses land, water and label — a ban on the accent is not proof it used the palette", () => {
    const json = JSON.stringify(buildBasemapStyle()).toUpperCase();
    for (const key of ["land", "water", "label"] as const) {
      expect(json, key).toContain(MAP_COLORS[key].toUpperCase());
    }
  });

  it("keeps every road and boundary achromatic, which is the brief's actual rule", () => {
    // "Any saturated hue in the basemap competes with the route." 32 is
    // measured, not chosen: ./notes.md#the-achromatic-bound-is-32-and-why
    const inks = JSON.stringify(buildBasemapStyle()).match(/"#[0-9a-fA-F]{6}"/g) ?? [];
    expect(inks.length, "no colours found means this loop asserts nothing").toBeGreaterThan(10);
    const palette = new Set(Object.values(MAP_COLORS).map((h) => h.toUpperCase()));
    for (const quoted of inks) {
      const hex = quoted.slice(2, -1).toUpperCase();
      if (palette.has(`#${hex}`)) continue;
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(Math.max(r, g, b) - Math.min(r, g, b), `#${hex}`).toBeLessThanOrEqual(32);
    }
  });

  it("names only a fontstack the glyph endpoint serves, on every symbol layer", () => {
    // NO `if (font !== undefined)` GUARD, and that is the whole case. A missing
    // text-font is spec-legal — validateStyleMin returns [] — and MapLibre then
    // falls back to a fontstack OpenFreeMap does not serve, so every place
    // label silently disappears. A guarded loop skips exactly that failure.
    const symbols = buildBasemapStyle().layers.filter((l) => l.type === "symbol");
    expect(symbols.length, "no symbol layer means the loop below asserts nothing").toBe(5);
    for (const layer of symbols) {
      expect(layer.layout?.["text-font"], layer.id).toEqual(FONTSTACK);
    }
  });

  it("uses hex everywhere, because an oklch colour is a layer that does not draw", () => {
    const colours = JSON.stringify(buildBasemapStyle()).match(/"[^"]*oklch\([^"]*"/g);
    expect(colours).toBeNull();
  });

  it("spends no accent colour in the basemap, because the route needs all three", () => {
    // The brief: "any saturated hue in the basemap competes with the route".
    // The accent trio belongs to the route and the markers, which stage 3 adds
    // imperatively — so none of it may appear here. Narrower than the channel
    // -spread case above and kept beside it: this one names the three hexes.
    const json = JSON.stringify(buildBasemapStyle());
    for (const key of ["accent", "accentBright", "accentDeep"] as const) {
      expect(json.toUpperCase(), key).not.toContain(MAP_COLORS[key].toUpperCase());
    }
  });

  it("puts every label above every fill and line, so nothing paints over a place name", () => {
    const types = buildBasemapStyle().layers.map((l) => l.type);
    expect(types.lastIndexOf("fill")).toBeLessThan(types.indexOf("symbol"));
    expect(types.lastIndexOf("line")).toBeLessThan(types.indexOf("symbol"));
  });
});
