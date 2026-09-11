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
    expect(buildMarkerElement({ ...base, precisionMeters: 5000 }).className).not.toMatch(/\[[^\]]+\]/);
  });
});
