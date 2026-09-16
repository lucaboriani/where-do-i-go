// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildMarkerElement } from "@/lib/map/marker-element";

const base = { slug: "arrival", title: "Arrival", sortOrder: 1 };

describe("buildMarkerElement", () => {
  it("labels itself for a screen reader with the entry's title", () => {
    expect(buildMarkerElement(base).getAttribute("aria-label")).toBe("Arrival");
  });

  it("shows a skeleton and no image when the entry has no thumbnail", () => {
    const el = buildMarkerElement(base);
    expect(el.querySelector("img")).toBeNull();
    expect(el.className).toContain("bg-surface");
  });

  it("renders an image when there is a thumbnail, still over the skeleton", () => {
    const el = buildMarkerElement({ ...base, thumbnail: "https://pod.example/t.jpg" });
    const img = el.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://pod.example/t.jpg");
    expect(el.className).toContain("bg-surface");
  });

  it("marks a fuzzed coordinate differently from an exact one, because the shape is the claim", () => {
    const exact = buildMarkerElement(base).className;
    const fuzzed = buildMarkerElement({ ...base, precisionMeters: 5000 }).className;
    expect(fuzzed).not.toBe(exact);
  });

  it("carries the slug, so the reconciler can match it", () => {
    expect(buildMarkerElement(base).dataset.slug).toBe("arrival");
  });

  it("uses no arbitrary Tailwind values, which the guardrail bans outside components/ui", () => {
    expect(buildMarkerElement({ ...base, precisionMeters: 5000 }).className).not.toMatch(
      /\[[^\]]+\]/,
    );
  });

  it("never applies MARKER_ACTIVE itself; the hook toggles it after building", () => {
    expect(buildMarkerElement(base).className).not.toContain("ring-2");
  });

  it("sizes the marker from the .map-marker class, not size-10 or an arbitrary value", () => {
    const el = buildMarkerElement({ slug: "s", title: "t", precisionMeters: undefined });
    expect(el.className).toContain("map-marker");
    expect(el.className).not.toContain("size-10");
    expect(el.className).not.toMatch(/\[[^\]]+\]/); // still no arbitrary Tailwind
  });

  it("gives the exact marker the square/halo variant and the fuzzed one the soft circle", () => {
    const exact = buildMarkerElement({ slug: "a", title: "t", precisionMeters: undefined });
    const fuzzed = buildMarkerElement({ slug: "b", title: "t", precisionMeters: 500 });
    expect(exact.className).toContain("map-marker--exact");
    expect(fuzzed.className).toContain("map-marker--fuzzed");
  });
});
