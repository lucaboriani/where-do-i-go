/**
 * MapLibre cannot read a CSS custom property and cannot parse `oklch()`, so
 * the palette is restated in hex and this is what stops the two drifting.
 * What it does not catch: ./notes.md#the-drift-check-and-what-it-does-not-catch
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAP_COLORS, MAP_COLOR_TOKENS } from "@/lib/map/tokens";

const CSS = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

/** Pulls the oklch value and the hex the stylesheet records beside it, off a
 *  line of the shape `--color-accent: oklch(...); ` plus a trailing hex
 *  comment. The colon is what stops `--color-accent` matching
 *  `--color-accent-bright`. */
function declared(token: string): { oklch: string; hex: string } | undefined {
  const found = new RegExp(
    `${token}:\\s*(oklch\\([^)]*\\));\\s*/\\*\\s*(#[0-9A-Fa-f]{6})`,
  ).exec(CSS);
  return found === null ? undefined : { oklch: found[1], hex: found[2].toUpperCase() };
}

describe("MAP_COLORS against app/globals.css", () => {
  it("mirrors a token that the stylesheet actually declares, for every colour", () => {
    for (const [key, token] of Object.entries(MAP_COLOR_TOKENS)) {
      expect(declared(token), `${key} → ${token}`).toBeDefined();
    }
  });

  it("carries the same hex the stylesheet records", () => {
    for (const [key, token] of Object.entries(MAP_COLOR_TOKENS)) {
      expect(declared(token)?.hex, `${key} → ${token}`).toBe(
        MAP_COLORS[key as keyof typeof MAP_COLORS].toUpperCase(),
      );
    }
  });

  it("names the same six colours in both objects, so neither can gain one alone", () => {
    expect(Object.keys(MAP_COLORS).sort()).toEqual(Object.keys(MAP_COLOR_TOKENS).sort());
  });

  it("holds six-digit hex and never oklch, because MapLibre parses one and not the other", () => {
    // Color.parse("oklch(…)") returns undefined and validateStyleMin rejects
    // it: ./notes.md#why-the-style-is-hex-and-not-oklch
    for (const [key, hex] of Object.entries(MAP_COLORS)) {
      expect(hex, key).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
