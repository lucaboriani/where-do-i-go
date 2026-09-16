// CSS-presence check: jsdom has no view-transition runtime, so this asserts
// the declarations exist rather than executing a transition. Task 9 brief
// Step 1, docs/superpowers/plans/2026-09-15-look-and-feel-phase-7.md.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(fileURLToPath(new URL("./globals.css", import.meta.url)), "utf8");

describe("app/globals.css view transitions", () => {
  it("opts into cross-document view transitions", () => {
    expect(CSS).toMatch(/@view-transition\s*{[^}]*navigation:\s*auto/);
  });

  it("disables them under reduced motion", () => {
    expect(CSS).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
