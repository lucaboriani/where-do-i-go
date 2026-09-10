/**
 * The dark desaturated basemap, authored rather than recoloured.
 * ./notes.md#seventeen-layers-and-what-was-left-out
 */
import type { LayerSpecification, StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { MAP_COLORS } from "@/lib/map/tokens";

/** OpenFreeMap: no key, no account, no cookies (decisions.md §7). Overridable
 *  per deployer; the OSM attribution it requires is added by the map, never
 *  here, and is never removed. */
export const TILES_URL = "https://tiles.openfreemap.org/planet";
export const GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

/** The only fontstack the glyph endpoint is known to serve — measured, not
 *  chosen. Typefaces are phase 7 and are unrelated to this. */
export const FONTSTACK = ["Noto Sans Regular"];

/** Stage 3 adds its own sources beside this one, so the id is exported rather
 *  than spelled twice. */
export const SOURCE_ID = "openmaptiles";

/** Achromatic steps off `land`, not palette tokens: the brief bans a saturated
 *  hue in the basemap so the route and the photographs are the only saturated
 *  things on screen. */
const INK = {
  wood: "#131719",
  glacier: "#1a1f23",
  park: "#121618",
  roadMinor: "#191d21",
  roadMajor: "#20252a",
  roadMotorway: "#272d33",
  rail: "#1d2226",
  boundaryState: "#232a30",
  boundaryCountry: "#2c343b",
} as const;

/** Background, water and the two landcover steps. Everything here paints
 *  before any line or label. */
function groundLayers(): LayerSpecification[] {
  return [
    { id: "background", type: "background", paint: { "background-color": MAP_COLORS.land } },
    {
      id: "water",
      type: "fill",
      source: SOURCE_ID,
      "source-layer": "water",
      // A tunnelled waterway is under the ground, not on it.
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "fill-color": MAP_COLORS.water },
    },
    {
      id: "waterway",
      type: "line",
      source: SOURCE_ID,
      "source-layer": "waterway",
      paint: {
        "line-color": MAP_COLORS.water,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 16, 2],
      },
    },
    {
      id: "landcover_wood",
      type: "fill",
      source: SOURCE_ID,
      "source-layer": "landcover",
      filter: ["==", ["get", "class"], "wood"],
      paint: { "fill-color": INK.wood, "fill-opacity": 0.6 },
    },
    {
      id: "landcover_glacier",
      type: "fill",
      source: SOURCE_ID,
      "source-layer": "landcover",
      filter: ["==", ["get", "subclass"], "glacier"],
      paint: { "fill-color": INK.glacier, "fill-opacity": 0.5 },
    },
    {
      id: "landuse_park",
      type: "fill",
      source: SOURCE_ID,
      "source-layer": "landuse",
      filter: ["==", ["get", "class"], "park"],
      paint: { "fill-color": INK.park },
    },
  ];
}

/** One line layer per road class, plus rail. No casings: a casing on a road
 *  competes with the route's, which is the one thing the brief wants cased. */
function roadLayers(): LayerSpecification[] {
  const road = (
    id: string,
    classes: string[],
    color: string,
    narrow: number,
    wide: number,
  ): LayerSpecification => ({
    id,
    type: "line",
    source: SOURCE_ID,
    "source-layer": "transportation",
    filter: ["in", ["get", "class"], ["literal", classes]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": color,
      "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 6, narrow, 18, wide],
    },
  });

  return [
    road("highway_minor", ["minor", "service", "track", "path"], INK.roadMinor, 0.3, 3),
    road("highway_major", ["primary", "secondary", "tertiary", "trunk"], INK.roadMajor, 0.6, 6),
    road("highway_motorway", ["motorway"], INK.roadMotorway, 0.9, 8),
    {
      id: "railway",
      type: "line",
      source: SOURCE_ID,
      "source-layer": "transportation",
      filter: ["==", ["get", "class"], "rail"],
      paint: {
        "line-color": INK.rail,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.4, 18, 1.6],
        "line-dasharray": [3, 2],
      },
    },
  ];
}

/** Country and state only. `admin_level` is a number in this schema, so the
 *  comparisons are numeric rather than string. */
function boundaryLayers(): LayerSpecification[] {
  return [
    {
      id: "boundary_state",
      type: "line",
      source: SOURCE_ID,
      "source-layer": "boundary",
      filter: ["==", ["get", "admin_level"], 4],
      minzoom: 4,
      paint: {
        "line-color": INK.boundaryState,
        "line-width": 0.7,
        "line-dasharray": [4, 3],
      },
    },
    {
      id: "boundary_country",
      type: "line",
      source: SOURCE_ID,
      "source-layer": "boundary",
      filter: ["<=", ["get", "admin_level"], 2],
      layout: { "line-join": "round" },
      paint: {
        "line-color": INK.boundaryCountry,
        "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 8, 1.6],
      },
    },
  ];
}

/** Five place classes, smallest first so the largest paints last. A halo in
 *  `land` is what keeps a label legible over water and over a route line. */
function labelLayers(): LayerSpecification[] {
  const place = (
    id: string,
    cls: string,
    small: number,
    large: number,
    minzoom: number,
  ): LayerSpecification => ({
    id,
    type: "symbol",
    source: SOURCE_ID,
    "source-layer": "place",
    minzoom,
    filter: ["==", ["get", "class"], cls],
    layout: {
      "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
      "text-font": FONTSTACK,
      "text-size": ["interpolate", ["linear"], ["zoom"], minzoom, small, minzoom + 6, large],
      "text-max-width": 8,
      "text-padding": 4,
    },
    paint: {
      "text-color": MAP_COLORS.label,
      "text-halo-color": MAP_COLORS.land,
      "text-halo-width": 1.1,
    },
  });

  return [
    place("place_village", "village", 9, 11, 10),
    place("place_town", "town", 10, 13, 8),
    place("place_city", "city", 11, 15, 5),
    place("place_state", "state", 10, 13, 4),
    place("place_country", "country", 10, 15, 2),
  ];
}

/** The style, in paint order: ground, roads, boundaries, labels. */
export function buildBasemapStyle(): StyleSpecification {
  return {
    version: 8,
    name: "Travel diary — dark",
    glyphs: GLYPHS_URL,
    sources: {
      [SOURCE_ID]: { type: "vector", url: TILES_URL },
    },
    layers: [...groundLayers(), ...roadLayers(), ...boundaryLayers(), ...labelLayers()],
  };
}
