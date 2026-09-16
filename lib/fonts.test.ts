import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, root)), "utf8");
const CSS = read("app/globals.css");
const FONTS = read("lib/fonts.ts");

// globSync isn't in @types/node@^20 (Node 22 has it at runtime, but typecheck
// is a separate gate); this walk uses the typed readdirSync form instead.
function walk(dir: string, exts: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(fileURLToPath(new URL(dir, root)), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...walk(rel, exts));
    } else if (exts.some((ext) => rel.endsWith(ext))) {
      found.push(rel);
    }
  }
  return found;
}

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
    const files = [
      ...walk("app", ["ts", "tsx", "css"]),
      ...walk("components", ["ts", "tsx", "css"]),
    ].filter((f) => !f.includes("components/ui/") && f !== "app/globals.css");
    for (const rel of files) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/font-family\s*:/);
      expect(src, rel).not.toMatch(/["'`](Syne|DM Mono)["'`]/);
    }
  });

  it("applies FONT_CLASS to every root <html>", () => {
    for (const rel of [
      "app/(public)/layout.tsx",
      "app/(studio)/layout.tsx",
      "app/not-found.tsx",
    ]) {
      const src = read(rel);
      expect(src, rel).toMatch(/import\s*\{\s*FONT_CLASS\s*\}\s*from\s*["']@\/lib\/fonts["']/);
      expect(src, rel).toMatch(/className=\{FONT_CLASS\}/);
    }
  });

  it("keeps Syne on its default variable cut — no fixed weight", () => {
    const syneCall = /Syne\(\{[\s\S]*?\}\)/.exec(FONTS)?.[0] ?? "";
    expect(syneCall).not.toBe("");
    expect(syneCall).not.toMatch(/weight/);
  });
});
