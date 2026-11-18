import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { signInAsOwner } from "./sign-in";

/**
 * The studio at phone width. jsdom has no layout, so overflow and tap-target
 * size can only be measured in a real browser — this is why it is e2e. Every
 * screen the seeded flow reaches is measured, each reported on its own (soft)
 * so one failing screen does not hide the others.
 */

const PHONE = { width: 390, height: 844 };
const MIN_TAP = 44;

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

type Problem = string;

/** The three checks, in the page: no horizontal page overflow, every control
 *  inside the viewport width, every control at least MIN_TAP tall. Scoped to
 *  `main` (the studio's own UI); invisible and visually-hidden nodes skipped. */
async function layoutProblems(page: Page): Promise<Problem[]> {
  return page.evaluate(([minTap, vw]) => {
    const problems: string[] = [];
    // NOT window.innerWidth: with isMobile, Chromium grows it to the content's
    // width (measured: 600 after a 600px child), so the overflow check could
    // never fail. The pinned viewport width is the bound.
    const sw = document.documentElement.scrollWidth;
    if (sw > vw) problems.push(`page overflow: scrollWidth ${sw} > viewport ${vw}`);

    const describe = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type");
      const label =
        el.getAttribute("aria-label") ??
        (el as HTMLInputElement).labels?.[0]?.textContent ??
        el.textContent ??
        el.getAttribute("name") ??
        "";
      const text = label.trim().replace(/\s+/g, " ").slice(0, 40);
      return `<${tag}${type ? ` type=${type}` : ""}> "${text}"`;
    };

    const main = document.querySelector("main");
    if (!main) return [...problems, "no <main> on the page"];
    const controls = main.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea");
    if (controls.length === 0) problems.push("no controls found inside <main>");

    for (const el of controls) {
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue; // visually hidden (sr-only)
      const name = describe(el);
      const size = `${Math.round(box.width)}x${Math.round(box.height)}`;

      if (box.left < 0 || box.right > vw) {
        problems.push(`outside viewport: ${name} ${size}, left ${Math.round(box.left)} right ${Math.round(box.right)} > ${vw}`);
      }

      // A checkbox/radio's tap target is its wrapping label, when it has one.
      const isToggle = el instanceof HTMLInputElement && /^(checkbox|radio)$/.test(el.type);
      const target = isToggle ? (el.closest("label") ?? el) : el;
      const tapHeight = target.getBoundingClientRect().height;
      if (tapHeight < minTap) {
        problems.push(`tap target < ${minTap}px: ${name} ${size} (target height ${Math.round(tapHeight)})`);
      }
    }
    return problems;
  }, [MIN_TAP, PHONE.width] as const);
}

async function checkScreen(page: Page, screen: string) {
  // Let late layout (fonts, async rows) settle before measuring.
  await page.waitForLoadState("networkidle");
  const problems = await layoutProblems(page);
  expect.soft(problems, `${screen} at ${PHONE.width}px`).toEqual([]);
}

test.describe("the studio at phone width", () => {
  test.describe.configure({ timeout: 120_000 });

  test("every studio screen fits 390px with 44px tap targets", async ({ page }) => {
    await page.goto("/studio");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await checkScreen(page, "signed-out sign-in");

    await signInAsOwner(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "touch emulation must match studio.css's (pointer: coarse)").toBe(true);

    // Click-through, never a deep goto — see studio-authoring.spec.ts on the
    // silent re-auth that bounces a hard nav back to /studio.
    const trip = page.getByRole("link", { name: "Japan, spring", exact: true });
    await expect(trip).toBeVisible();
    await checkScreen(page, "trips list");

    await page.getByRole("link", { name: "New trip" }).click();
    await expect(page.getByRole("heading", { name: "New trip" })).toBeVisible();
    await checkScreen(page, "new trip editor");

    await page.goto("/studio");
    await page.getByRole("link", { name: "Japan, spring", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit trip" })).toBeVisible();
    const entry = page.getByRole("link", { name: "First night in Shinjuku", exact: true });
    await expect(entry).toBeVisible();
    await checkScreen(page, "trip editor + entries list");

    await page.getByRole("link", { name: "New entry" }).click();
    await expect(page.getByRole("heading", { name: "New entry" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save entry" })).toBeVisible();
    await checkScreen(page, "blank entry editor");

    await page.goto("/studio");
    await page.getByRole("link", { name: "Japan, spring", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit trip" })).toBeVisible();
    await entry.click();
    await expect(page.getByRole("heading", { name: "Edit entry" })).toBeVisible();
    await checkScreen(page, "entry editor");
  });
});
