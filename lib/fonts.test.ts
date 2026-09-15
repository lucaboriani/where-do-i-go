import { readFileSync, globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, root)), "utf8");
const CSS = read("app/globals.css");
const FONTS = read("lib/fonts.ts");

describe("font tokens against app/globals.css", () => {
  it("points --font-sans at the Syne variable, not at itself", () => {
    expect(CSS).toMatch(/--font-sans:\s*var\(--font-syne\)/);
    expect(CSS).not.toMatch(/--font-sans:\s*var\(--font-sans\)/);
  });

  it("points --font-mono at the DM Mono variable and drops the geist token", () => {
    expect(CSS).toMatch(/--font-mono:\s*var\(--font-dm-mono\)/);
    expect(CSS).not.toMatch(/--font-geist-mono/);
  });

  it("declares in lib/fonts.ts the exact variable names globals.css consumes", () => {
    expect(FONTS).toMatch(/variable:\s*["']--font-syne["']/);
    expect(FONTS).toMatch(/variable:\s*["']--font-dm-mono["']/);
  });

  it("declares the families once — no hard-coded font-family in app or components", () => {
    const files = globSync("{app,components}/**/*.{ts,tsx,css}", {
      cwd: fileURLToPath(root),
    }).filter((f) => !f.includes("components/ui/") && f !== "app/globals.css");
    for (const rel of files) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/font-family\s*:/);
      expect(src, rel).not.toMatch(/["'`](Syne|DM Mono)["'`]/);
    }
  });
});
