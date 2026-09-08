// @vitest-environment jsdom
/** The studio's entry editor: sections 0 and 9 — the file's own controls, and what only the source can show.
 *  Split out of entry-editor.test.tsx; the shared rig is ./entry-editor.harness. */

import {
  COORDINATE_FIELD,
  ENTRY_TTL,
  INDEX_TTL,
  REVALIDATE_URL,
  SPEC_CREATED,
  SPEC_OCCURRED,
  importModule,
  registerEditorLifecycle,
} from "./entry-editor.harness";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";

registerEditorLifecycle();

/* ══════════════════════════════════════════════════════════════════════════
 * 0. Controls. None of these test the editor. They test that this file is
 *    running the way it claims to, and they come first because every assertion
 *    below is worthless if one of them is wrong.
 * ════════════════════════════════════════════════════════════════════════ */

describe("controls for this file", () => {
  it("runs in jsdom, at the origin the revalidation handler is registered for", () => {
    expect(typeof document).toBe("object");
    expect(window.location.origin).toBe(new URL(REVALIDATE_URL).origin);
  });

  it("runs on the clock this file fixes, not the machine's", () => {
    // If the TZ assignment at the top stopped taking effect, the offset
    // assertions further down would silently start asserting the developer's
    // zone — and would pass in UTC against an implementation that hardcoded
    // "+00:00". This fails instead.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Asia/Tokyo");
    expect(new Date("2026-04-02T16:20:00").getTimezoneOffset()).toBe(-540);
  });

  it("the dynamic loader resolves the @/ alias, and rejects what is absent", async () => {
    const known = (await importModule("@/lib/pod/save-entry")) as { saveEntry?: unknown };
    expect(typeof known.saveEntry).toBe("function");
    await expect(importModule("@/components/studio/definitely-not-here")).rejects.toThrow();
  });

  it("the §7 fixtures were extracted, and are the ones this file thinks they are", () => {
    expect(ENTRY_TTL).toContain(SPEC_CREATED);
    expect(ENTRY_TTL).toContain(SPEC_OCCURRED);
    expect(INDEX_TTL).toContain("dy:entryCount");
  });

  it("the coordinate query would find a coordinate field if one existed", () => {
    // The family query is now used the other way round — section 1 asserts it
    // finds EXACTLY the three controls the editor is meant to have, so a fourth
    // coordinate-ish input cannot appear unnoticed. It still has to be a query
    // that resolves something, and it still has to resolve nothing on a tree
    // with no coordinate field in it; both halves are measured here rather than
    // assumed, exactly as they were when the pin they served was the opposite.
    const probe = document.createElement("div");
    probe.innerHTML = '<label for="p">Latitude</label><input id="p" />';
    document.body.append(probe);
    expect(screen.queryAllByLabelText(COORDINATE_FIELD)).toHaveLength(1);
    probe.remove();
    expect(screen.queryAllByLabelText(COORDINATE_FIELD)).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9. What only the source can show.
 *
 * Same justification as section 5 of components/studio/studio-shell/studio-shell.test.tsx and the
 * "use cache" checks in test/cached-owner-profile.test.ts: `"use client"` is a
 * compiler directive and an inert string expression under vitest, an import
 * never exercised on a tested path leaves no runtime trace, and a TYPE has no
 * runtime trace at all.
 * ════════════════════════════════════════════════════════════════════════ */

describe("as source", () => {
  const EDITOR = "components/studio/entry-editor/entry-editor.tsx";
  const SESSION = "lib/studio/session.ts";

  function read(path: string): string {
    try {
      return readFileSync(path, "utf8");
    } catch (cause) {
      throw new Error(
        `${path} does not exist yet — this is the red step of the TDD loop, not a broken test.`,
        { cause },
      );
    }
  }

  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const specifiers = (text: string) =>
    [...text.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g)].map(
      (m) => m[1] ?? m[2],
    );

  const typeOnlySpecifiers = (text: string) =>
    [...text.matchAll(/\bimport\s+type\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);

  it("the scanners discriminate, so the bans below cannot pass on an empty set", () => {
    const sample = `import type { A } from "erased";\nimport { B } from "kept";\n`;
    expect(typeOnlySpecifiers(sample)).toEqual(["erased"]);
    expect(specifiers(sample)).toEqual(["erased", "kept"]);
    expect(stripComments("/* x */ const a = 1; // y\n")).not.toContain("x");
    expect(stripComments("/* x */ const a = 1; // y\n")).toContain("const a = 1");
    // And the file it is about to scan really is on disk and really has imports.
    expect(specifiers(stripComments(read(SESSION)))).toContain(
      "@inrupt/solid-client-authn-browser",
    );
  });

  it('the editor carries "use client" before any import', () => {
    const text = stripComments(read(EDITOR));
    const directive = text.search(/["']use client["']/);
    const firstImport = text.search(/^\s*import\b/m);
    expect(directive).toBeGreaterThanOrEqual(0);
    expect(firstImport).toBeGreaterThanOrEqual(0);
    expect(directive).toBeLessThan(firstImport);
  });

  it("the editor reads no config and no environment variable", () => {
    // OWNER_WEBID, SITE_URL, SITE_NAME and POD_ROOT are not NEXT_PUBLIC_ and
    // lib/config.ts throws the moment it is reached in a browser. Everything
    // the editor needs arrives as a prop or on the session — the same rule the
    // shell is held to.
    const text = stripComments(read(EDITOR));
    expect(specifiers(text).filter((s) => s.includes("lib/config"))).toEqual([]);
    expect(text).not.toMatch(/\bprocess\s*\.\s*env\b/);
  });

  it("the editor imports no VALUE from the Solid auth library", () => {
    // The session is injected, as it is into the shell. A value import here
    // would put the library outside the `ssr: false` boundary that
    // components/studio/studio-client/studio-client.tsx draws.
    const text = stripComments(read(EDITOR));
    const erased = new Set(typeOnlySpecifiers(text));
    const values = specifiers(text).filter((s) => !erased.has(s));
    expect(values.filter((s) => s.startsWith("@inrupt/solid-client-authn-browser"))).toEqual([]);
  });

  /**
   * `StudioSessionLike` MUST GROW `fetch`, DERIVED FROM `Session["fetch"]`.
   *
   * It models `login`, `logout` and `events` today and not `fetch`, so the
   * editor has nothing typed to hand `saveEntry` — and `saveEntry`'s own
   * docblock forbids the fallback: "Never defaulted to the ambient one: that is
   * a silent downgrade to anonymous."
   *
   * Asserted on the source because a type leaves no runtime trace, and asserted
   * as DERIVED rather than merely present for the reason lib/studio/session.ts
   * argues at length about its other three members: "hand-writing
   * login(options: {...}) would compile happily against a library that had
   * renamed one of them." A hand-typed `fetch: (input, init) => Promise<Response>`
   * would compile against a library that changed the signature, and the failure
   * would be a 401 at runtime.
   */
  it("StudioSessionLike models fetch, derived from Session[\"fetch\"]", () => {
    const text = stripComments(read(SESSION));
    const iface = text.slice(text.indexOf("interface StudioSessionLike"));
    const body = iface.slice(iface.indexOf("{"), iface.indexOf("}") + 1);

    expect(body, "StudioSessionLike does not mention fetch").toMatch(/\bfetch\b/);
    expect(body, "fetch is retyped by hand rather than derived from Session").toMatch(
      /fetch\s*:\s*Session\[["']fetch["']\]/,
    );
    // The control: the three members it already derives are found by the same
    // scan, so a regex that had stopped matching would fail here first.
    expect(body).toMatch(/login\s*:\s*Session\[["']login["']\]/);
    expect(body).toMatch(/logout\s*:\s*Session\[["']logout["']\]/);
  });
});
