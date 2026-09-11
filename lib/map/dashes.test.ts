import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { DASH_BY_MODE, MODE_DASHES } from "@/lib/map/dashes";
import { TravelMode } from "@/lib/pod/schema";

describe("MODE_DASHES", () => {
  it("covers every TravelMode the schema allows, plus Unknown", () => {
    expect(Object.keys(MODE_DASHES).sort()).toEqual([...TravelMode.options, "Unknown"].sort());
  });

  it("gives Walk and Flight different patterns, or the mode says nothing", () => {
    expect(MODE_DASHES.Walk).not.toEqual(MODE_DASHES.Flight);
  });

  it("uses a solid line for exactly one mode, so the others read as interruptions", () => {
    const solid = Object.entries(MODE_DASHES).filter(([, d]) => d[1] === 0);
    expect(solid.map(([m]) => m)).toEqual(["Car"]);
  });
});

describe("DASH_BY_MODE", () => {
  it("is accepted by the real style spec inside a line layer", () => {
    const errors = validateStyleMin({
      version: 8,
      sources: { s: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      layers: [
        {
          id: "l",
          type: "line",
          source: "s",
          paint: { "line-dasharray": DASH_BY_MODE },
        },
      ],
    });
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  it("names every mode in the expression, not just the ones a fixture happened to have", () => {
    const flat = JSON.stringify(DASH_BY_MODE);
    for (const mode of TravelMode.options) expect(flat).toContain(`"${mode}"`);
  });
});
