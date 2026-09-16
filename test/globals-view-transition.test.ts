// CSS-presence check: jsdom has no view-transition runtime, so this asserts
// the declarations exist rather than executing a transition. In test/, not
// beside app/globals.css, because a stylesheet has no .ts/.tsx sibling for
// check:structure to pair it with — see REPO_TESTS in scripts/check-structure.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

describe("app/globals.css view transitions", () => {
  it("opts into cross-document view transitions", () => {
    expect(CSS).toMatch(/@view-transition\s*{[^}]*navigation:\s*auto/);
  });

  it("disables them under reduced motion", () => {
    expect(CSS).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
