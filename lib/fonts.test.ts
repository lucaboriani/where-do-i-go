import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { syne, dmMono, FONT_CLASS } from "@/lib/fonts";

const root = new URL("../", import.meta.url);
const CSS = readFileSync(fileURLToPath(new URL("app/globals.css", root)), "utf8");

describe("font tokens against app/globals.css", () => {
  it("points --font-sans at the Syne variable, not at itself", () => {
    expect(CSS).toMatch(/--font-sans:\s*var\(--font-syne\)/);
    expect(CSS).not.toMatch(/--font-sans:\s*var\(--font-sans\)/);
  });

  it("points --font-mono at the DM Mono variable", () => {
    expect(CSS).toMatch(/--font-mono:\s*var\(--font-dm-mono\)/);
    expect(CSS).not.toMatch(/--font-geist-mono/);
  });

  it("exposes the variable names the loaders generate", () => {
    expect(syne.variable).toBe("--font-syne");
    expect(dmMono.variable).toBe("--font-dm-mono");
    expect(FONT_CLASS).toContain(syne.variable);
    expect(FONT_CLASS).toContain(dmMono.variable);
  });

  it("declares the families once — no hard-coded font-family in app or components", () => {
    const files = globSync("{app,components}/**/*.{ts,tsx,css}", {
      cwd: fileURLToPath(root),
    }).filter((f) => !f.includes("components/ui/"));
    for (const rel of files) {
      const src = readFileSync(fileURLToPath(new URL(rel, root)), "utf8");
      expect(src, rel).not.toMatch(/font-family\s*:/);
      expect(src, rel).not.toMatch(/["'`](Syne|DM Mono)["'`]/);
    }
  });
});
