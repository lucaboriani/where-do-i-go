import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import config from "../eslint.config.mjs";
import { BLUR_BUDGET_BYTES, withinBlurBudget } from "@/lib/media/targets";
import { Photo } from "@/lib/pod/schema";
import { publicEntryPoints, transitiveClosure } from "./support/imports";

/**
 * TODO.md phase 0.5: "A deliberate violation of each guardrail rule fails CI —
 * test the enforcement, don't assume it."
 *
 * Each case lints a snippet *at a path where the rule is supposed to apply*,
 * because every guardrail here is path-scoped. Linting the right code at the
 * wrong path proves nothing.
 *
 * THE LAST describe at the foot of this file is deliberately not a lint case.
 * It guards a constant that a lint fence forced to be duplicated; its own
 * comment says why it lives here.
 */

const eslint = new ESLint({ cwd: process.cwd() });

async function lint(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  return result?.messages ?? [];
}

const ruleIds = (msgs: Awaited<ReturnType<typeof lint>>) => msgs.map((m) => m.ruleId);

/**
 * Parse failures, spelled out. A snippet ESLint cannot parse yields ONE message
 * with `fatal: true` and `ruleId: null`, and no rule messages at all — so every
 * allow-case here would pass on a snippet that was never linted. That is this
 * repository's "green run that verified nothing" in miniature, and it is one
 * mistyped fixture away at all times. Reject-cases fail loudly on their own (a
 * null ruleId is not "no-restricted-syntax"); the allow-cases are what this is
 * for. Returns strings rather than a count so a failure names the line.
 */
const fatals = (msgs: Awaited<ReturnType<typeof lint>>) =>
  msgs.filter((m) => m.fatal).map((m) => `${m.line}:${m.column} ${m.message}`);

/**
 * BELTED_MODULES, derived from eslint.config.mjs rather than hand-typed — a
 * hand-typed copy is how lib/pod/rdf.ts stayed invisible to every sweep below.
 * Located by content (the literal "lib/pod/read.ts" in its files array), not
 * by position, so reordering the config cannot lose it.
 */
function beltFilesArray(): string[] {
  const entries = config as Array<{ files?: string[] }>;
  const block = entries.find((c) => (c.files ?? []).includes("lib/pod/read.ts"));
  if (!block?.files) {
    throw new Error(
      "No block in eslint.config.mjs lists lib/pod/read.ts in its files array — the belt " +
        "moved or was renamed, and BELTED_MODULES cannot find it.",
    );
  }
  return block.files;
}

/** A files entry is a literal path, or "<dir>/**\/*.ts" naming every
 *  production .ts file directly under dir — the only two shapes the belt
 *  uses today. Throws on a glob that matched nothing rather than silently
 *  sweeping an empty list. */
function resolveBeltModules(patterns: string[]): string[] {
  const out: string[] = [];
  for (const pattern of patterns) {
    const cut = pattern.indexOf("/**/");
    if (cut === -1) {
      out.push(pattern);
      continue;
    }
    const dir = pattern.slice(0, cut);
    const files = existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"))
          .map((e) => `${dir}/${e.name}`)
      : [];
    if (files.length === 0) {
      throw new Error(`${pattern} in eslint.config.mjs's belt matched no production file under ${dir}.`);
    }
    out.push(...files);
  }
  return out.sort();
}

const BELTED_MODULES = resolveBeltModules(beltFilesArray());

describe("guardrails actually fire", () => {
  it("rejects a raw vocabulary IRI outside lib/vocab.ts", async () => {
    const msgs = await lint(
      "lib/pod/read.ts",
      `const p = "https://schema.org/name";\nexport default p;\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-syntax");
    expect(msgs[0].message).toMatch(/lib\/vocab\.ts/);
  });

  it("allows the same IRI inside lib/vocab.ts", async () => {
    const msgs = await lint(
      "lib/vocab.ts",
      `export const p = "https://schema.org/name";\n`,
    );
    expect(ruleIds(msgs)).not.toContain("no-restricted-syntax");
  });

  it("rejects arbitrary Tailwind values outside components/ui", async () => {
    const msgs = await lint(
      "app/(public)/thing.tsx",
      `export default function T() { return <div className="w-[137px]" />; }\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-syntax");
    expect(msgs.map((m) => m.message).join()).toMatch(/Arbitrary Tailwind/);
  });

  it("allows arbitrary Tailwind values inside components/ui", async () => {
    const msgs = await lint(
      "components/ui/thing.tsx",
      `export default function T() { return <div className="w-[137px]" />; }\n`,
    );
    expect(ruleIds(msgs)).not.toContain("no-restricted-syntax");
  });

  /**
   * THE SAME GUARDRAIL, AT THE SPELLING THIS REPOSITORY ACTUALLY WRITES.
   *
   * The two cases above only ever exercise a string typed INSIDE the attribute,
   * and that is the only shape the selector can see:
   *
   *     JSXAttribute[name.name='className'] Literal[value=/[a-z0-9]-\[[^\]]+\]/]
   *
   * components/studio/entry-editor/entry-editor.tsx does not write its classes that way. Its
   * nine controls share two module-level constants, CONTROL and BUTTON, spent as
   * `className={CONTROL}` — an Identifier, not a Literal — so the rule never
   * looks at the strings at all. Measured against the real config before this was
   * written rather than reasoned: `disabled:hover:bg-[#222]` inside BUTTON
   * produces ZERO no-restricted-syntax messages and the identical string inline
   * produces one. Every class string in the studio editor is outside the fence,
   * and the docblock above those two constants says so and asks for hand
   * discipline instead. This is the test that replaces the hand discipline.
   *
   * THE INLINE CASES ABOVE STAY EXACTLY AS THEY ARE. They are the control that
   * proves the rule fires at all; a widening that quietly stopped covering the
   * inline form would otherwise read as a pass.
   *
   * THE FOUR SHAPES, and the third is the one that matters most:
   *
   *   1. inline `className="p-[3px]"`  — above, kept.
   *   2. `const C = "…"`               — a single Literal initialiser.
   *   3. `const B = "…" + "…"`         — what entry-editor.tsx's BUTTON actually
   *                                      IS today. A rule that handles only a
   *                                      single Literal initialiser passes this
   *                                      one and misses the very file that
   *                                      prompted the change. The three-operand
   *                                      row is here because `"a" + "b" + "c"`
   *                                      nests left, so the offending Literal is
   *                                      a grandchild of the BinaryExpression,
   *                                      not a child of it.
   *   4. const C = backticks           — pinned DELIBERATELY. A TemplateLiteral's
   *                                      static text is a TemplateElement, not a
   *                                      Literal, so a Literal-only rule is
   *                                      bypassed by one character, and quotes
   *                                      and backticks are produced
   *                                      interchangeably by both a formatter and
   *                                      an agent. It costs one extra selector
   *                                      arm; leaving it out leaves the fence
   *                                      with a keyboard shortcut through it.
   *
   * Both public and studio paths, because a class constant on a public page is
   * exactly as far outside the design tokens as one in the studio, and the
   * scoping this rule needs is by NODE SHAPE, not by directory — see the
   * allow-cases below for why that distinction is the whole design.
   *
   * lintText does not read from disk, so naming the real editor file here costs
   * nothing and says which file the case is about.
   */
  it.each([
    [
      "components/studio/entry-editor/entry-editor.tsx",
      "a direct string initialiser",
      `const CONTROL = "w-full border border-hairline bg-[#222] px-3 py-2";\n` +
        `export default function T() { return <input className={CONTROL} />; }\n`,
    ],
    [
      "components/studio/entry-editor/entry-editor.tsx",
      "a concatenation of two literals — entry-editor.tsx's BUTTON, verbatim but for one value",
      `const BUTTON =\n` +
        `  "cursor-pointer border border-hairline bg-surface px-4 py-2 hover:bg-hairline " +\n` +
        `  "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[#222]";\n` +
        `export default function T() { return <button className={BUTTON} />; }\n`,
    ],
    [
      "components/studio/entry-editor/entry-editor.tsx",
      "a concatenation of three, where the offender is a grandchild",
      `const BUTTON = "border " + "px-4 " + "p-[3px]";\n` +
        `export default function T() { return <button className={BUTTON} />; }\n`,
    ],
    [
      "components/studio/entry-editor/entry-editor.tsx",
      "a template literal initialiser",
      "const CARD = `w-full p-[3px]`;\n" +
        "export default function T() { return <div className={CARD} />; }\n",
    ],
    [
      "app/(public)/thing.tsx",
      "the same const form on a public page",
      `const CARD = "w-full p-[3px]";\n` +
        `export default function T() { return <div className={CARD} />; }\n`,
    ],
  ])(
    "rejects an arbitrary Tailwind value held in a const at %s — %s",
    async (path, _shape, code) => {
      const msgs = await lint(path, code);
      // A snippet that fails to PARSE produces one fatal message and no rule
      // messages, so this would fail on the assertion below rather than on the
      // thing it is about. Named explicitly so the failure output says which.
      expect(fatals(msgs)).toEqual([]);
      expect(ruleIds(msgs)).toContain("no-restricted-syntax");
      // Which no-restricted-syntax message matters: NO_RAW_IRIS shares the rule
      // id, so `toContain("no-restricted-syntax")` alone would pass on the wrong
      // guardrail firing for the wrong reason.
      expect(
        msgs.filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message).join("\n"),
      ).toMatch(/Arbitrary Tailwind/);
    },
  );

  /**
   * THE ALLOW-CASES. A fence that rejects everything is not a fence, and this
   * one has a specific, measured way of going wrong.
   *
   * The first two are the ordinary ones: the real CONTROL and BUTTON strings out
   * of entry-editor.tsx, unmodified. They are token-only, and they carry
   * `disabled:` and `hover:` variant prefixes — measured as passing today, and
   * kept here so a widened selector cannot start rejecting variant prefixes on
   * the way to catching arbitrary values. components/ui/** stays exempt in the
   * const form too, not just inline; shadcn's copied source is full of both.
   *
   * THE LAST TWO ARE THE TRAP. eslint.config.mjs is the file that DEFINES this
   * rule and test/guardrails.test.ts is the file that TESTS it. Both are
   * ordinary files under the everywhere block, both are linted by `eslint .`,
   * and both are necessarily full of strings that look exactly like what the
   * rule bans — quoting the banned thing is what defining and testing it
   * consists of. They are linted from DISK here, not as snippets, so this file's
   * own fixtures above are inside the allow-case: a rule the test cannot
   * tolerate turns its own test red.
   *
   * Probed against the real config before this was written:
   *
   *   VariableDeclarator Literal[…]      (descendant) — 2 errors, both in
   *       test/guardrails.test.ts, at the two inline cases above. Their fixtures
   *       sit inside `const msgs = await lint(…)`, which makes the fixture
   *       string a descendant of a VariableDeclarator. The rule would make its
   *       own test unlintable while looking correct on every snippet.
   *
   *   VariableDeclarator > Literal[…]    (child-anchored, plus a
   *   BinaryExpression arm and a TemplateLiteral arm) — 0 errors repo-wide
   *       outside components/ui/**, and all five reject cases above still fire.
   *
   * On eslint.config.mjs specifically, and this corrects a plausible reading of
   * it: the `w-[137px]` in that file is on line 89, in a COMMENT. No AST node
   * carries it, so neither shape flags it. The rule's own selector string on
   * line 91 does not self-match either — its VALUE contains `-\[`, a real
   * backslash between the `-` and the `[`, so `[a-z0-9]-\[` does not match. That
   * safety lives in the REGEX, not in the selector: drop the `-` from it (a
   * bare `\[[^\]]+\]` is the obvious way to try to catch more) and two literals
   * in eslint.config.mjs match at once, one of them being line 91 itself.
   */
  it.each([
    [
      "components/studio/entry-editor/entry-editor.tsx",
      "entry-editor.tsx's real CONTROL — tokens only, with disabled: variants",
      `const CONTROL =\n` +
        `  "w-full border border-hairline bg-surface px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60";\n` +
        `export default function T() { return <input className={CONTROL} />; }\n`,
    ],
    [
      "components/studio/entry-editor/entry-editor.tsx",
      "entry-editor.tsx's real BUTTON — a concatenation, tokens only, hover: and disabled: variants",
      `const BUTTON =\n` +
        `  "cursor-pointer border border-hairline bg-surface px-4 py-2 hover:bg-hairline " +\n` +
        `  "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface";\n` +
        `export default function T() { return <button className={BUTTON} />; }\n`,
    ],
    [
      "components/ui/thing.tsx",
      "shadcn's copied source, const form — exempt inline, so exempt here too",
      `const CONTROL = "w-full p-[3px]";\n` +
        `export default function T() { return <div className={CONTROL} />; }\n`,
    ],
    [
      "components/ui/thing.tsx",
      "shadcn's copied source, concatenated const form",
      `const BUTTON = "inline-flex " + "data-[state=open]:bg-accent";\n` +
        `export default function T() { return <button className={BUTTON} />; }\n`,
    ],
  ])("allows %s — %s", async (path, _why, code) => {
    const msgs = await lint(path, code);
    // Without this, a snippet ESLint could not parse reports zero rule messages
    // and this case passes having linted nothing. That is the exact vacuous pass
    // this file exists to avoid.
    expect(fatals(msgs)).toEqual([]);
    expect(
      msgs.filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message),
    ).toEqual([]);
  });

  /**
   * Non-vacuity for the two on-disk cases below. If eslint.config.mjs and
   * test/guardrails.test.ts were outside no-restricted-syntax's scope — a
   * `files` change, a globalIgnores entry — they would lint clean forever and
   * the allow-case would be proving nothing. NO_RAW_IRIS shares the rule id and
   * is unrelated to this change, which is what makes it the right probe: it
   * asks "is no-restricted-syntax alive at this path" without pinning anything
   * about where the Tailwind arm is scoped.
   */
  it.each(["eslint.config.mjs", "test/guardrails.test.ts"])(
    "no-restricted-syntax is alive at %s, so a clean lint there means something",
    async (path) => {
      const msgs = await lint(path, `const p = "https://schema.org/name";\nexport default p;\n`);
      expect(fatals(msgs)).toEqual([]);
      expect(ruleIds(msgs)).toContain("no-restricted-syntax");
    },
  );

  it.each(["eslint.config.mjs", "test/guardrails.test.ts"])(
    "%s on disk still lints clean — the rule must not break the file that defines it or the file that tests it",
    async (path) => {
      const [result] = await eslint.lintFiles([path]);
      // An ignored or unmatched path yields NO result, and `result?.messages ??
      // []` would then read as clean. Pin that the file was really linted.
      expect(result?.filePath).toBe(resolve(process.cwd(), path));
      // The whole message list, not a count: the failure output has to name the
      // line, or "the config does not lint" is untraceable in CI.
      expect(
        result.messages.map((m) => `${path}:${m.line}:${m.column} ${m.ruleId ?? "FATAL"} ${m.message}`),
      ).toEqual([]);
    },
  );

  it("rejects the Solid auth library on a public route", async () => {
    const msgs = await lint(
      "app/(public)/thing.tsx",
      `import { login } from "@inrupt/solid-client-authn-browser";\nexport default function T() { return <div onClick={() => login({})} />; }\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
  });

  /**
   * The Radix fence, at BOTH spellings — and the bare one is the spelling that
   * matters, because it is the only one this project actually writes.
   *
   * package.json depends on `radix-ui` ^1.6.7 — the unified package — and on no
   * `@radix-ui/react-*` package directly. All seven Radix imports under
   * components/ui/** are `from "radix-ui"`. So a case that lints only
   * `@radix-ui/react-dialog`, which is all this test used to do, exercises a
   * spelling that appears nowhere in the repo, while the spelling someone would
   * actually produce — copying a line out of components/ui/dialog.tsx onto a
   * public page — sails straight through the group. That is this file's own
   * "right code at the wrong path" warning one step sideways: the right path,
   * the wrong specifier. Do not simplify this back to a single case.
   *
   * The scoped spelling stays on the list rather than being replaced: radix-ui
   * re-exports the scoped packages and depends on them, so they sit in
   * node_modules and a deliberate import — or one copy-pasted from Radix's own
   * docs, which are written in the scoped style — resolves today.
   */
  it.each([
    // specifier                   why this spelling is on the list
    ["radix-ui"], //               what package.json has; all 7 components/ui Radix imports
    ["radix-ui/dialog"], //        a resolvable subpath: the exports map has "./*" and
    //                             node_modules/radix-ui/dist/dialog.mjs exists. The bare entry
    //                             already blocks this — no-restricted-imports matches `group`
    //                             with gitignore semantics, not minimatch, so "radix-ui" is a
    //                             superset of "radix-ui/*" rather than the other way round.
    //                             Probed: ["radix-ui"] blocks radix-ui/dialog; ["radix-ui/*"]
    //                             does NOT block bare radix-ui. Pinned anyway, so that if that
    //                             matcher ever changes the subpath does not quietly open up.
    ["@radix-ui/react-dialog"], // the scoped spelling: present transitively via radix-ui
    ["vaul"], //                   components/ui/drawer.tsx
    ["sonner"], //                 components/ui/sonner.tsx
    ["cmdk"], //                   components/ui/command.tsx
  ])("rejects %s on a public route", async (specifier) => {
    const msgs = await lint(
      "app/(public)/thing.tsx",
      `import * as UI from "${specifier}";\nexport default function T() { return <div>{String(UI)}</div>; }\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
    // The message has to name the specifier, or CI output cannot tell a
    // deployer which import to move.
    expect(
      msgs.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message).join("\n"),
    ).toContain(specifier);
  });

  /**
   * The allow-case for the group above. shadcn is studio-only, not banned
   * outright, so the fix cannot be "ban radix-ui everywhere": that would make
   * shadcn's own copied source and every studio page unlintable, and a fence
   * that rejects everything is not a fence.
   */
  it.each([
    ["app/(studio)/thing.tsx", "radix-ui"],
    ["components/ui/dialog.tsx", "radix-ui"], // shadcn's copied source, verbatim
    ["components/ui/drawer.tsx", "vaul"],
  ])("allows %s to import %s", async (path, specifier) => {
    const msgs = await lint(
      path,
      `import * as UI from "${specifier}";\nexport default function T() { return <div>{String(UI)}</div>; }\n`,
    );
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  /**
   * next-themes, on all three fenced public paths.
   *
   * This one was a MISSING ban rather than a mis-spelled one — a judgement
   * call, so the reasoning belongs next to the case and not only in the config.
   * next-themes is on disk and importable from anywhere because shadcn's sonner
   * component pulls useTheme out of it (components/ui/sonner.tsx). But
   * CLAUDE.md's Styling rules fix the theme to dark, put the palette at :root
   * rather than under a .dark class, and rule out a theme toggle. So a
   * next-themes import on a public page is either dead weight in a bundle that
   * has a CI budget on it, or the first line of a toggle the design already
   * declined. Fenced on the public side only — see the allow-case below.
   */
  it.each(["app/(public)/thing.tsx", "components/public/thing.tsx", "app/not-found.tsx"])(
    "rejects next-themes at %s — the theme is fixed dark, with no toggle",
    async (path) => {
      const msgs = await lint(
        path,
        `import { useTheme } from "next-themes";\nexport default function T() { return <div>{String(useTheme)}</div>; }\n`,
      );
      expect(ruleIds(msgs)).toContain("no-restricted-imports");
      expect(
        msgs.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message).join("\n"),
      ).toContain("next-themes");
    },
  );

  /**
   * The allow-case for it. The ban has to stay public-only: widen it and
   * components/ui/sonner.tsx — shadcn's copied source, which imports useTheme
   * verbatim — becomes unlintable, and the studio loses the one place a theme
   * hook is legitimately read.
   */
  it.each(["app/(studio)/thing.tsx", "components/ui/sonner.tsx"])(
    "allows %s to import next-themes",
    async (path) => {
      const msgs = await lint(
        path,
        `import { useTheme } from "next-themes";\nexport default function T() { return <div>{String(useTheme)}</div>; }\n`,
      );
      expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
    },
  );

  /**
   * REGRESSION PINS for two pattern groups that had no test at all: the
   * (studio) route group, and the exifreader / lib/media group.
   *
   * Both were correctly spelled and already blocking when these cases were
   * written — measured under a probe first, then pinned — so both passed on
   * their first run. That is deliberate, and it is not the "a test that passes
   * the first time is suspect" smell this file warns about elsewhere: nothing
   * here claims new behaviour. The failing case that opened this loop is the
   * radix-ui one above. What these close is a different gap. An untested fence
   * is one refactor away from a decorative one, and neither group had anything
   * that would notice it breaking — the (studio) group especially, whose globs
   * carry literal parentheses that glob syntax could plausibly reinterpret.
   */
  it.each([
    ["app/(public)/thing.tsx", "@/app/(studio)/studio/page"],
    // A relative specifier, not just the alias: the group has a `**/(studio)/**`
    // half precisely so a path that never spells `app/` is still caught.
    ["components/public/thing.tsx", "../../app/(studio)/studio/page"],
    ["app/not-found.tsx", "@/app/(studio)/studio/page"],
    // components/studio/** — NO PARENTHESES, so for a while neither
    // `**/app/(studio)/**` nor `**/(studio)/**` matched it and this was the
    // one unfenced door into the whole media subsystem. Probed before the
    // fix, not inferred: `@/lib/media`, `@/lib/studio/session` and
    // `@/app/(studio)/layout` were each reported at app/(public), while
    // `@/components/studio/entry-editor` produced no output at all — and that
    // single import drags lib/media/*, lib/pod/{write,save-entry,access} →
    // @inrupt/solid-client, lib/studio/* → the auth library, and Radix into
    // the public graph. Wanting to reuse `Field` or the tag parser out of the
    // editor is the ordinary reason someone writes it.
    ["app/(public)/thing.tsx", "@/components/studio/entry-editor"],
    // The BARE directory as well as the subpath. Under the gitignore
    // semantics no-restricted-imports uses, `**/components/studio/**` does not
    // match a bare `@/components/studio` resolving to an index file — the same
    // hole that had to be closed separately for lib/media, so it is pinned
    // here rather than left to be rediscovered a third time.
    ["app/(public)/thing.tsx", "@/components/studio"],
    ["components/public/thing.tsx", "../../components/studio/entry-editor"],
    ["app/not-found.tsx", "@/components/studio/studio-shell"],
  ])("rejects %s importing %s — separate root layouts keep the bundles apart", async (path, moduleSpecifier) => {
    const msgs = await lint(
      path,
      `import Page from "${moduleSpecifier}";\nexport default function T() { return <div>{String(Page)}</div>; }\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
    expect(
      msgs.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message).join("\n"),
    ).toContain(moduleSpecifier);
  });

  /**
   * THE TWO SPELLINGS THE 2026-09-08 FOLDER MOVE CREATED, measured rather than
   * reasoned. `@/components/studio/entry-editor` named a FILE until that move
   * and now names a directory with an index.ts — the very resolution the
   * group's docblock says `**\/x/**` misses for a bare `@/x`. The move also puts
   * a second door in: the deep path past the barrel.
   */
  it.each([
    ["the barrel, which now resolves to an index.ts", "@/components/studio/entry-editor"],
    ["the deep path past the barrel", "@/components/studio/entry-editor/entry-editor"],
  ])("rejects %s from a public page", async (_shape, moduleSpecifier) => {
    // The control: the specifier really has the shape this case claims. Without
    // it, both rows pin a ban on a path that resolves to nothing.
    expect(existsSync(resolve("components/studio/entry-editor/index.ts"))).toBe(true);
    expect(existsSync(resolve("components/studio/entry-editor.tsx"))).toBe(false);
    const msgs = await lint(
      "app/(public)/thing.tsx",
      `import E from "${moduleSpecifier}";\nexport default function T() { return <div>{String(E)}</div>; }\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
    expect(
      msgs.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message).join("\n"),
    ).toContain(moduleSpecifier);
  });

  /** The allow-case: the studio importing its own modules is the normal case. */
  it("allows a studio page to import another (studio) module", async () => {
    const msgs = await lint(
      "app/(studio)/studio/page.tsx",
      `import Shell from "@/app/(studio)/studio/shell";\nexport default Shell;\n`,
    );
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  /**
   * And the allow-case for the components/studio half, which is the whole
   * point of it being a fence rather than a ban: app/(studio)/studio/page.tsx
   * → the "use client" wrapper → components/studio/studio-shell/studio-shell.tsx IS the
   * three-file shape CLAUDE.md mandates. Widen the group past the public block
   * and the studio can no longer render itself.
   *
   * `fatals` first, for the reason at the top of this file: these snippets are
   * linted at `.tsx` paths and a mistyped one would yield a parse error and no
   * rule messages, on which `not.toContain` passes having checked nothing.
   */
  it.each([
    ["app/(studio)/studio/page.tsx", "@/components/studio/studio-shell"],
    ["components/studio/studio-shell/studio-shell.tsx", "@/components/studio/entry-editor"],
  ])("allows %s to import %s — the studio has to be able to render itself", async (path, moduleSpecifier) => {
    const msgs = await lint(
      path,
      `import X from "${moduleSpecifier}";\nexport default function T() { return <div>{String(X)}</div>; }\n`,
    );
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  /**
   * Image processing is studio-only: it runs client-side in a Web Worker before
   * upload and has no business in a public reading page's bundle (CLAUDE.md,
   * Media). The library is `exifreader` — `exifr` was rejected as unmaintained
   * (docs/versions.md), so a case naming exifr would fence a package that is not
   * a dependency, the same mistake the radix-ui spelling made above.
   */
  it.each([
    ["app/(public)/thing.tsx", "exifreader"],
    ["components/public/thing.tsx", "exifreader"],
    ["app/(public)/thing.tsx", "@/lib/media/resize"],
    ["app/not-found.tsx", "@/lib/media/resize"],
    // THE HOLE THIS CASE HOLDS SHUT, the same one lib/studio already closed
    // below. no-restricted-imports matches `group` with gitignore semantics,
    // not minimatch, so `**/lib/media/**` does NOT match the bare specifier —
    // the pattern group needs a `**/lib/media` half of its own, and this is
    // the only case that notices if someone drops it. Measured before it was
    // added, not inferred: linting this exact import at app/(public) produced
    // no no-restricted-imports message at all, while `@/lib/media/resize` at
    // the same path was reported, so the file was being linted and the fence
    // simply missed. Latent only because nothing resolves at lib/media today;
    // the moment someone adds lib/media/index.ts, `@/lib/media` is a working
    // import on a public page and the whole fence is bypassed by dropping a
    // filename.
    ["app/(public)/thing.tsx", "@/lib/media"],
  ])("rejects %s importing %s — image processing is studio-only", async (path, moduleSpecifier) => {
    const msgs = await lint(
      path,
      `import * as mod from "${moduleSpecifier}";\nexport default function T() { return <div>{String(mod)}</div>; }\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
    expect(
      msgs.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message).join("\n"),
    ).toContain(moduleSpecifier);
  });

  /**
   * The allow-cases: the studio, and lib/media itself, must keep using it.
   *
   * THE SNIPPET IS DELIBERATELY JSX-FREE, AND THAT IS THE WHOLE POINT OF THIS
   * COMMENT. Until 2026-09-06 this block linted `return <div>{String(mod)}</div>`
   * — JSX — at `lib/media/resize.ts`, a `.ts` path where the parser rejects it.
   * ESLint answers a snippet it cannot parse with exactly ONE message, `fatal:
   * true` and `ruleId: null`, and no rule messages at all, so `not.toContain
   * ("no-restricted-imports")` passed on a file that was never linted. Measured:
   * `lintText` returned `[null]` for that pair, versus
   * `["no-restricted-imports"]` for the same import at a `.tsx` path. That is
   * this repository's "green run that verified nothing" in miniature, and the
   * `fatals` helper at the top of this file exists for precisely it — the block
   * simply never called it. Both halves are now fixed: a snippet that parses as
   * .ts and .tsx alike, and the assertion that would have caught it.
   */
  it.each([
    ["app/(studio)/thing.tsx", "exifreader"],
    ["lib/media/resize.ts", "exifreader"],
    ["app/(studio)/thing.tsx", "@/lib/media/resize"],
    // The bare specifier on the allowed side too: widening the pattern group
    // to catch `@/lib/media` must not fence the studio out of its own media
    // code. A fence that rejects everything proves nothing and blocks the work.
    ["app/(studio)/thing.tsx", "@/lib/media"],
    // THE MEDIA PIPELINE'S ONLY WRITE PATH. lib/media/upload.ts imports
    // putGuarded, because a binary upload goes through the one guarded write
    // like everything else — a second hand-rolled PUT for binaries is a blind
    // PUT waiting to happen. It is allowed today only because the fence block
    // above is scoped to `files: ["app/(public)/**", "components/public/**",
    // "app/not-found.tsx", "app/global-error.tsx"]`, which never reaches
    // lib/media. That is a property of an array someone could widen in one
    // keystroke, and nothing else would notice: `lib/pod/write` IS in the
    // fenced group, so adding "lib/**" to that files array breaks the media
    // pipeline's write path with no other test going red. Verified by doing
    // exactly that — this case turns red under the widening and green again
    // when it is reverted, so it pins the scope and not just the group.
    ["lib/media/upload.ts", "@/lib/pod/write"],
  ])("allows %s to import %s", async (path, moduleSpecifier) => {
    const msgs = await lint(path, `import * as mod from "${moduleSpecifier}";\nexport const used = String(mod);\n`);
    // Before the rule assertion, not after: an allow-case that never parsed
    // passes the line below for the wrong reason. See the block comment.
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  it("rejects importing studio-only pod modules from a public route", async () => {
    const msgs = await lint(
      "app/(public)/thing.tsx",
      `import { write } from "@/lib/pod/write";\nexport default function T() { return <div>{String(write)}</div>; }\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
  });

  /**
   * THE SAME GROUP, WALKED PROPERLY — including the two globs the §10 write
   * sequence added: `lib/pod/save-entry` and `lib/pod/entry-model`.
   *
   * The case above lints ONE member of a four-member pattern group and does not
   * check the message, so it would pass with `save-entry` and `entry-model`
   * missing from the config entirely. That matters most for `save-entry`: it
   * imports `lib/pod/access.ts`, so a public page importing it pulls
   * @inrupt/solid-client into the public bundle one step removed — the same
   * shape as the lib/studio hole this repo closed, and the one thing invariant 3
   * and the size budget both forbid. `entry-model` drags nothing in and is
   * fenced anyway: nothing public has any business serialising an entry, and a
   * module on neither list is invisible to every check here.
   *
   * THE SPELLINGS ARE THE MEASURED ONES, not the plausible ones. This file's own
   * radix-ui lesson is that a fence tested at a specifier the project does not
   * write proves nothing: the alias form is what a page would be written with,
   * the relative form is what an agent editing inside app/(public) produces, and
   * both were probed against the real config before being pinned here.
   *
   * These cases passed on their first run, and that is expected rather than the
   * "a test that passes first time is suspect" smell — the fence was already
   * correct by inspection and by probe; what was missing was anything that would
   * notice it breaking. Mutation-checked all the same: with the two new globs
   * deleted from eslint.config.mjs, the save-entry and entry-model rows below go
   * red and the rest of the file stays green.
   */
  it.each([
    // the two new globs, at all three fenced public paths
    ["app/(public)/thing.tsx", "@/lib/pod/save-entry"],
    ["components/public/thing.tsx", "@/lib/pod/save-entry"],
    ["app/not-found.tsx", "@/lib/pod/save-entry"],
    ["app/(public)/thing.tsx", "@/lib/pod/entry-model"],
    ["components/public/thing.tsx", "@/lib/pod/entry-model"],
    ["app/not-found.tsx", "@/lib/pod/entry-model"],
    // A relative specifier, no alias: the group is written `**/lib/pod/...`
    // precisely so a path that never spells `@/` is still caught, and a file
    // being edited inside app/(public) is where that spelling comes from.
    ["components/public/thing.tsx", "../../lib/pod/save-entry"],
    ["app/(public)/trips/[slug]/page.tsx", "../../../../lib/pod/save-entry"],
    // The `**/lib/pod/save-entry.*` half of each pair, which is the only thing
    // covering an extension-bearing specifier: gitignore semantics match whole
    // segments, so the bare glob does NOT match `save-entry.ts`. Measured —
    // delete the `.*` halves and these two rows are the only ones that notice.
    ["app/(public)/thing.tsx", "@/lib/pod/save-entry.ts"],
    ["app/(public)/thing.tsx", "@/lib/pod/entry-model.ts"],
    // The two older members of the group, at the path they had no case at:
    // app/not-found.tsx is fenced by a `files` entry rather than by being
    // inside app/(public), so it is the entry most easily lost in a refactor.
    ["app/not-found.tsx", "@/lib/pod/write"],
    ["app/not-found.tsx", "@/lib/pod/access"],
  ])("rejects %s importing %s — the write path is studio-only", async (path, moduleSpecifier) => {
    const msgs = await lint(
      path,
      `import * as mod from "${moduleSpecifier}";\nexport default function T() { return <div>{String(mod)}</div>; }\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
    // Naming the specifier is what makes the CI output actionable: "an import is
    // restricted" without saying which one sends a deployer reading the message
    // to the wrong line.
    expect(
      msgs.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message).join("\n"),
    ).toContain(moduleSpecifier);
  });

  /**
   * The allow-cases, and they are not decoration: a fence that rejects
   * everything is useless, and widening this group by one glob — `**\/lib/pod/**`
   * would do it — makes `lib/pod/save-entry.ts` unable to import its own
   * serialiser and the studio unable to save an entry at all.
   *
   * The last two rows are the specifiers the repository ACTUALLY contains today
   * (`lib/pod/save-entry.ts` imports `./entry-model` and `./access` relatively),
   * plus the one the test suite itself uses. Everything above them is a path the
   * studio will use as phase 2 lands.
   */
  it.each([
    ["app/(studio)/studio/page.tsx", "@/lib/pod/save-entry"],
    ["app/(studio)/studio/page.tsx", "@/lib/pod/entry-model"],
    ["components/studio/entry-editor/entry-editor.tsx", "@/lib/pod/save-entry"],
    ["test/entry-write.test.ts", "@/lib/pod/save-entry"],
    // The real, present-tense imports inside lib/pod itself.
    ["lib/pod/save-entry.ts", "./entry-model"],
    ["lib/pod/save-entry.ts", "./access"],
  ])("allows %s to import %s — the studio has to be able to write", async (path, moduleSpecifier) => {
    const msgs = await lint(
      path,
      `import * as mod from "${moduleSpecifier}";\nexport default String(mod);\n`,
    );
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  it("rejects ACL primitives outside lib/pod/access.ts", async () => {
    const msgs = await lint(
      "lib/pod/write.ts",
      `import { universalAccess } from "@inrupt/solid-client";\nexport default universalAccess;\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
  });

  it("allows ACL primitives inside lib/pod/access.ts", async () => {
    const msgs = await lint(
      "lib/pod/access.ts",
      `import { universalAccess } from "@inrupt/solid-client";\nexport default universalAccess;\n`,
    );
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  /**
   * The two cases above only ever exercise ONE name. The ban list is ~39
   * primitives and "the list IS the fence" (eslint.config.mjs): a rule that
   * fires on `universalAccess` and silently lets `setPublicDefaultAccess`
   * through would pass both of them while leaving lib/pod/read.ts free to
   * rewrite an ACL. So the cases below name other primitives explicitly, and
   * the pair after them walks the whole list.
   */
  it.each([
    // one per sub-module the ban list is derived from, so a whole group going
    // missing on an upgrade is caught rather than averaged out
    ["setPublicDefaultAccess", "lib/pod/read.ts"], // ./acl/class — the container shape
    ["getResourceInfoWithAcl", "lib/pod/read.ts"], // ./acl/acl — ACL discovery
    ["setAgentDefaultAccess", "lib/pod/write.ts"], // ./acl/agent
    ["setGroupResourceAccess", "lib/pod/cached.ts"], // ./acl/group
    ["addMockResourceAclTo", "test/read.test.ts"], // ./acl/mock
    ["getEffectiveAccess", "lib/pod/read.ts"], // ./resource/resource — WAC-Allow
    ["acp_ess_2", "lib/pod/write.ts"], // the ACP namespace
  ])("rejects %s at %s, not only universalAccess", async (name, path) => {
    const msgs = await lint(path, `import { ${name} } from "@inrupt/solid-client";\nexport default ${name};\n`);
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
    // The message must name the primitive that was rejected, or a deployer
    // reading CI output cannot tell which import to move.
    expect(msgs.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message).join()).toContain(name);
  });

  /**
   * Every name on the list, at a path the rule covers — and the same names at
   * lib/pod/access.ts, which must stay allowed. A rule that rejects everything
   * everywhere is useless: it would make the one module that implements access
   * control unwritable.
   *
   * The list is read out of eslint.config.mjs rather than copied here, so this
   * cannot drift into testing a stale copy of the fence. If the extraction ever
   * breaks it yields an empty list, which would make "every name fires" vacuously
   * true — hence the length assertion first.
   */
  const BANNED: string[] = (config as Array<{ rules?: Record<string, unknown> }>).flatMap((c) => {
    const rule = c.rules?.["no-restricted-imports"];
    if (!Array.isArray(rule)) return [];
    return (rule.slice(1) as Array<{ paths?: Array<{ name?: string; importNames?: string[] }> }>).flatMap(
      (opt) =>
        (opt?.paths ?? [])
          .filter((entry) => entry.name === "@inrupt/solid-client")
          .flatMap((entry) => entry.importNames ?? []),
    );
  });

  /** One import per line, so a message can be traced back to a name. */
  const everyBannedImport = () => `${BANNED.map((n) => `import { ${n} } from "@inrupt/solid-client";`).join("\n")}\n`;

  it("bans every primitive on the list, not a representative sample", async () => {
    // If this extraction silently returned [] the assertion below would pass on
    // nothing at all. 39 names as of @inrupt/solid-client 3.0.0.
    expect(BANNED.length).toBeGreaterThanOrEqual(30);
    expect(BANNED).toContain("universalAccess");
    expect(BANNED).toContain("setPublicDefaultAccess");

    const msgs = await lint("lib/pod/read.ts", everyBannedImport());
    const rejected = msgs.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message).join("\n");
    const unenforced = BANNED.filter((name) => !rejected.includes(`'${name}' import`));
    expect(unenforced).toEqual([]);
  });

  it("allows every one of them inside lib/pod/access.ts", async () => {
    const msgs = await lint("lib/pod/access.ts", everyBannedImport());
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  /**
   * A HOLE THAT IS NOW CLOSED. This test is what keeps it closed — it passes,
   * and it passes because of a fix, not because it stopped firing.
   *
   * What the hole was: `no-restricted-imports` is configured twice, once for
   * `**` with `paths` (the ACL ban list) and once for `app/(public)/**` and
   * `components/public/**` with `patterns` (the import boundary). ESLint flat
   * config REPLACES a rule's options rather than merging them, so the second
   * block switched the first one off for exactly those paths. Measured, not
   * reasoned: `app/(public)/__hole/page.tsx` importing `universalAccess`,
   * `setPublicDefaultAccess` and `getResourceInfoWithAcl` exited 0. The boundary
   * patterns did block `@/lib/pod/access`, so a public route could not reach OUR
   * module — but it could import the raw primitives from @inrupt/solid-client
   * and rewrite an ACL directly, on the one path where the bundle budget and
   * architecture invariant 3 both say the Solid libraries must never appear.
   *
   * The fence that closes it: the `app/(public)` block in eslint.config.mjs now
   * repeats the ACL `paths` entry alongside its `patterns`. It looks like a
   * duplicate of the `**` block and is not one; delete it, or "tidy" it away,
   * and these two cases go red. Checked by removing it: 2 failed, 27 passed.
   */
  it.each(["app/(public)/thing.tsx", "components/public/thing.tsx"])(
    "bans the ACL primitives at %s as well — the public bundle is where it matters most",
    async (path) => {
      const msgs = await lint(
        path,
        `import { universalAccess, setPublicDefaultAccess } from "@inrupt/solid-client";\n` +
          `export default function T() { return <div>{String([universalAccess, setPublicDefaultAccess])}</div>; }\n`,
      );
      expect(ruleIds(msgs)).toContain("no-restricted-imports");
      const rejected = msgs.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message).join("\n");
      expect(rejected).toContain("universalAccess");
      expect(rejected).toContain("setPublicDefaultAccess");
    },
  );

  /** The allow-case for the block above, so the fix cannot be "reject everything
   *  on public routes": the public path legitimately imports the read module. */
  it("still allows lib/pod/read.ts on a public route", async () => {
    const msgs = await lint(
      "app/(public)/thing.tsx",
      `import { readDiary } from "@/lib/pod/read";\nexport default function T() { return <div>{String(readDiary)}</div>; }\n`,
    );
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  it("allows the auth library in the studio", async () => {
    const msgs = await lint(
      "app/(studio)/thing.tsx",
      `import { login } from "@inrupt/solid-client-authn-browser";\nexport default function T() { return <div onClick={() => login({})} />; }\n`,
    );
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  /**
   * lib/studio/** is the studio's session and owner check. It wraps
   * @inrupt/solid-client-authn-browser, so a public route that imports it drags
   * the auth library into the public bundle indirectly — the exact thing
   * invariant 3 and the size budget both forbid. The library itself is already
   * banned on public paths; this closes the route around that ban.
   *
   * ANOTHER CLOSED HOLE, and again this test is the thing holding it shut.
   * eslint.config.mjs listed lib/pod/write and lib/pod/access in the public
   * boundary patterns and not lib/studio, so a public route could import the
   * session module and pull the auth library in one step removed. Closed in the
   * same change that introduced lib/studio/session.ts: that block now carries a
   * two-element pattern group for lib/studio — the bare directory, and the
   * directory-with-children glob. It had to go in THAT block and not the
   * everywhere one; the flat-config note above applies here too, the public
   * block replaces the rule's options rather than merging with them.
   */
  it.each([
    ["app/(public)/thing.tsx", "@/lib/studio/session"],
    ["components/public/thing.tsx", "@/lib/studio/session"],
    // The fence is the directory, not one filename: a pattern naming only
    // `session` leaves every other studio module reachable from a public page.
    ["app/(public)/thing.tsx", "@/lib/studio/autosave"],
    // The bare directory specifier. `**/lib/studio/**` alone does NOT match it,
    // which is why the pattern has two halves; drop the bare `**/lib/studio`
    // and this is the only case that notices. It reads as redundant only
    // because nothing resolves there today — the moment someone adds
    // lib/studio/index.ts, `import x from "@/lib/studio"` is a working import
    // on a public page and the whole fence is bypassed by dropping a filename.
    ["app/(public)/thing.tsx", "@/lib/studio"],
  ])("rejects %s importing %s", async (path, moduleSpecifier) => {
    const msgs = await lint(
      path,
      `import { restoreSession } from "${moduleSpecifier}";\nexport default function T() { return <div>{String(restoreSession)}</div>; }\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
    // Naming the offending specifier is what makes the CI output actionable.
    expect(
      msgs.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message).join("\n"),
    ).toContain(moduleSpecifier);
  });

  /**
   * The allow-cases for the block above. A rule that rejected lib/studio
   * everywhere would stop the studio importing its own session module — a fence
   * that rejects everything proves nothing and blocks the work.
   */
  it.each(["app/(studio)/studio/page.tsx", "lib/studio/autosave.ts"])(
    "allows %s to import the studio session module",
    async (path) => {
      const msgs = await lint(
        path,
        `import { restoreSession } from "@/lib/studio/session";\nexport default restoreSession;\n`,
      );
      expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
    },
  );

  /**
   * A THIRD CLOSED HOLE. It was written failing and is now green, because
   * eslint.config.mjs lists app/not-found.tsx (and app/global-error.tsx, which
   * does not exist yet — an inert files entry, so the day someone adds one it is
   * not another unfenced public page) in the boundary block's `files`. Removing
   * either entry puts these two cases back in the red, which is the point of them.
   *
   * `app/not-found.tsx` is a public page that is not inside `app/(public)`. It
   * cannot be: it is the 404 for paths matching no route group at all, which is
   * why it renders its own <html> — there is no shared root layout to wrap it.
   * The boundary block's `files` is ["app/(public)/**", "components/public/**"]
   * and this path is in neither, so NONE of the public/studio patterns apply to
   * the one page every mistyped URL on the site is served.
   *
   * Verified against the real config, not inferred: linting these two imports at
   * app/not-found.tsx today produces no no-restricted-imports message at all —
   * ESLint returns an empty message list, so these cases fail on the assertion
   * below and not on a parse or resolution error.
   *
   * It is served unauthenticated to anyone who mistypes a URL, so invariant 3
   * ("two access paths, one app" — the public path never touches the auth
   * library) applies to it exactly as it does to app/(public).
   */
  it.each(["@/lib/studio/session", "@inrupt/solid-client-authn-browser"])(
    "rejects app/not-found.tsx importing %s — it is a public page outside app/(public)",
    async (moduleSpecifier) => {
      const msgs = await lint(
        "app/not-found.tsx",
        `import * as mod from "${moduleSpecifier}";\n` +
          `export default function NotFound() { return <div>{String(mod)}</div>; }\n`,
      );
      expect(ruleIds(msgs)).toContain("no-restricted-imports");
      expect(
        msgs.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message).join("\n"),
      ).toContain(moduleSpecifier);
    },
  );

  /**
   * The allow-case for the pair above, written now so the fix cannot be "add
   * app/not-found.tsx to a block that rejects everything". The 404 page has to
   * keep importing what a public page legitimately imports — the shared
   * unauthenticated read module and next/link, which is what it actually uses.
   */
  it("still allows app/not-found.tsx to import next/link and lib/pod/read", async () => {
    const msgs = await lint(
      "app/not-found.tsx",
      `import Link from "next/link";\nimport { readDiary } from "@/lib/pod/read";\n` +
        `export default function NotFound() { return <Link href="/">{String(readDiary)}</Link>; }\n`,
    );
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  it("rejects a static maplibre-gl import from a public route", async () => {
    const msgs = await lint(
      "components/public/trip-map/probe.ts",
      `import maplibregl from "maplibre-gl";\nexport const a = maplibregl;\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
    expect(msgs.map((m) => m.message).join()).toMatch(/lazy/i);
  });

  it("rejects the same bytes reached by a deep path", async () => {
    const msgs = await lint(
      "components/public/trip-map/probe.ts",
      `import mod from "maplibre-gl/dist/maplibre-gl.mjs";\nexport const a = mod;\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
  });

  it("allows the maplibre stylesheet, which the attribution control needs", async () => {
    // An exact-specifier `paths` entry is what makes this possible: a
    // "maplibre-gl/**" pattern refuses it and no negation re-includes it.
    const msgs = await lint(
      "components/public/trip-map/probe.ts",
      `import "maplibre-gl/dist/maplibre-gl.css";\nexport const a = 1;\n`,
    );
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  it("allows a dynamic maplibre-gl import and an inline type, which is how the map mounts", async () => {
    // The asymmetry is the whole point: no-restricted-imports reaches neither
    // an ImportExpression nor a TSImportType, and the map is a chunk the
    // prerendered HTML never names.
    const msgs = await lint(
      "components/public/trip-map/probe.ts",
      `export type M = import("maplibre-gl").Map;\n` +
        `export async function load() {\n  const m = await import("maplibre-gl");\n  return m.default;\n}\n`,
    );
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  it("rejects a named static import, not only the default one", async () => {
    const msgs = await lint(
      "components/public/trip-map/probe.ts",
      `import { Marker } from "maplibre-gl";\nexport const a = Marker;\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
  });

  /**
   * `import type { Map } from "maplibre-gl"` — the ORDINARY-LOOKING spelling
   * stage 2 must avoid in favour of the inline `import("maplibre-gl").Map`
   * form above. The `paths` entry has no `importNames`, so it refuses every
   * binding regardless of `importKind`; measured, not assumed.
   */
  it("rejects a type-only static import at the same specifier", async () => {
    const msgs = await lint(
      "components/public/trip-map/probe.ts",
      `import type { Map } from "maplibre-gl";\nexport type M = Map;\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
  });

  /** The style spec is a separate package — stage 1 depends on this staying
   *  reachable, so the fence must not have widened past the exact specifier. */
  it("allows the style-spec type package, which is not maplibre-gl itself", async () => {
    const msgs = await lint(
      "components/public/trip-map/probe.ts",
      `import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";\n` +
        `export type S = StyleSpecification;\n`,
    );
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  it("allows a public route to import the two modules stage 0 moved out of lib/studio", async () => {
    const msgs = await lint(
      "app/(public)/trips/[slug]/probe.ts",
      `import { offsetOf } from "@/lib/time/offsets";\n` +
        `import { precisionLabel } from "@/lib/place/precision";\n` +
        `export const a = [offsetOf, precisionLabel];\n`,
    );
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  /**
   * "the paths they moved FROM" — `lib/studio/time/offsets` no longer exists
   * on disk, so its half of this case only ever proved a fatal parse error
   * was two messages; a mistyped fence would have passed it silently. Both
   * specifiers below are real, present-tense modules under lib/studio/**.
   */
  it("still refuses the paths they moved from, so the fence did not simply widen", async () => {
    const msgs = await lint(
      "app/(public)/trips/[slug]/probe.ts",
      `import { restoreSession } from "@/lib/studio/session";\n` +
        `import { placeFor } from "@/lib/studio/place/place";\n` +
        `export const a = [restoreSession, placeFor];\n`,
    );
    expect(fatals(msgs)).toEqual([]);
    expect(msgs.filter((m) => m.ruleId === "no-restricted-imports")).toHaveLength(2);
  });

  /**
   * THE BELT'S SCOPE. 5722e70 fenced only lib/time/**, lib/place/** and
   * lib/pod/read.ts; 3657839 widened it to the nine modules below once
   * lib/pod/cached.ts turned out to be what a public page actually imports.
   * BELTED_MODULES is derived above, not copied, so this cannot go stale.
   */

  /** Non-vacuity, in both directions: an empty list would let the two sweeps
   *  below pass having swept nothing, and a BELTED_MODULES built any other
   *  way could disagree with the config it claims to describe. */
  it("derives at least one belted module from eslint.config.mjs, not a hand-typed count", () => {
    expect(BELTED_MODULES.length).toBeGreaterThan(0);
    expect(BELTED_MODULES).toContain("lib/pod/read.ts");
    expect(resolveBeltModules(beltFilesArray())).toEqual(BELTED_MODULES);
  });

  it.each(BELTED_MODULES)(
    "rejects lib/studio at %s — every public entry point reaches this module",
    async (path) => {
      const msgs = await lint(
        path,
        `import { session } from "@/lib/studio/session";\nexport default session;\n`,
      );
      expect(ruleIds(msgs)).toContain("no-restricted-imports");
    },
  );

  it.each(BELTED_MODULES)("rejects a bare @inrupt/* import at %s", async (path) => {
    const msgs = await lint(
      path,
      `import { getSolidDataset } from "@inrupt/solid-client";\nexport default getSolidDataset;\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
  });

  // The allow-cases proving a widened belt must not over-reach: both need
  // @inrupt/solid-client for the same reason lib/media/upload.ts needs
  // lib/pod/write; see ./notes.md#why-access-and-pipeline-may-import-solid-client
  it.each(["lib/pod/access.ts", "lib/media/pipeline.ts"])(
    "still allows %s to import @inrupt/solid-client",
    async (path) => {
      const msgs = await lint(
        path,
        `import { getThing } from "@inrupt/solid-client";\nexport default getThing;\n`,
      );
      expect(fatals(msgs)).toEqual([]);
      expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
    },
  );
});

/**
 * THE CLOSURE, WALKED FROM REAL ENTRY POINTS RATHER THAN ASSUMED. Everything
 * above proves the belt fires where BELTED_MODULES says it should, never
 * whether BELTED_MODULES covers every lib/** module a public page can reach —
 * which is how lib/pod/rdf.ts stayed invisible. ./notes.md#why-a-closure-test
 */
describe("the belt's scope, walked from real public entry points", () => {
  const ROOT = resolve(process.cwd());

  it("names every lib/** module reachable from a public page in the belt's files array", () => {
    const entries = publicEntryPoints(ROOT);
    // Non-vacuity: an extraction that found no entry points would make the
    // closure below empty and this case pass having walked nothing.
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toContain("app/(public)/page.tsx");

    const libModules = [...transitiveClosure(entries, ROOT)].filter((f) => f.startsWith("lib/")).sort();
    // Same non-vacuity one level down: a walker that resolved no specifier
    // would make "every reachable lib module is belted" vacuously true.
    expect(libModules.length).toBeGreaterThan(0);

    const unbelted = libModules.filter((m) => !BELTED_MODULES.includes(m));
    expect(
      unbelted,
      "each of these is imported, directly or transitively, by a public page — so a public route " +
        "can reach @inrupt/* or lib/studio through it exactly as it could through lib/pod/read.ts " +
        "before the belt existed. Add it to the belt block's files array in eslint.config.mjs.",
    ).toEqual([]);
  });
});

describe("lib/map is fenced like the public path it serves", () => {
  it("refuses a static maplibre-gl import in lib/map, which would be 252.8 kB in a public chunk", async () => {
    expect(ruleIds(await lint("lib/map/view.ts", `import { Map } from "maplibre-gl";\n`))).toContain(
      "no-restricted-imports",
    );
  });

  it("refuses the deep dist path too, which is the same bytes by another name", async () => {
    expect(
      ruleIds(await lint("lib/map/view.ts", `import "maplibre-gl/dist/maplibre-gl.mjs";\n`)),
    ).toContain("no-restricted-imports");
  });

  it("allows the stylesheet subpath, which the attribution control needs", async () => {
    const msgs = await lint("lib/map/view.ts", `import "maplibre-gl/dist/maplibre-gl.css";\n`);
    // A snippet that fails to PARSE yields one fatal message and no rule
    // messages, so this allow-case would pass having linted nothing.
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  it("keeps lib/map out of the auth library and out of lib/studio", async () => {
    expect(
      ruleIds(await lint("lib/map/view.ts", `import { x } from "@/lib/studio/session";\n`)),
    ).toContain("no-restricted-imports");
  });

  it("fences lib/utils.ts the same way, because a public component is about to import cn", async () => {
    const code = `import { getDefaultSession } from "@inrupt/solid-client-authn-browser";\n`;
    expect(ruleIds(await lint("lib/utils.ts", code))).toContain("no-restricted-imports");
  });
});

/**
 * The two hard bounds from CLAUDE.md's "Code structure" — 200 for a render, 80
 * for a util, and a test FILE ceiling of 1000 with no bound on a test body.
 * Every case lints at a path where the bound is supposed to apply.
 */
describe("function length", () => {
  /** 210 statements: over the 200 hard bound for a render, and over lib's 80. */
  const longRender = `export function C() {\n${"  let x = 0;\n".repeat(210)}  return null;\n}\n`;
  /** 90 statements: over lib's 80 hard bound, under a render's 200. */
  const longUtil = `export function f() {\n${"  let x = 0;\n".repeat(90)}  return 1;\n}\n`;

  it("rejects a render function past the hard bound", async () => {
    const msgs = await lint("components/studio/thing/thing.tsx", longRender);
    expect(ruleIds(msgs)).toContain("max-lines-per-function");
    expect(msgs.map((m) => m.message).join()).toMatch(/too many lines/);
  });

  it("allows a render function that is merely long, because 130 is a tendency", async () => {
    const merely = `export function C() {\n${"  let x = 0;\n".repeat(140)}  return null;\n}\n`;
    const msgs = await lint("components/studio/thing/thing.tsx", merely);
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("max-lines-per-function");
  });

  it("rejects a lib function past the hard bound", async () => {
    const msgs = await lint("lib/pod/thing.ts", longUtil);
    expect(ruleIds(msgs)).toContain("max-lines-per-function");
  });

  it("holds lib tighter than a render at the very same length", async () => {
    expect(ruleIds(await lint("lib/pod/thing.ts", longUtil))).toContain("max-lines-per-function");
    expect(ruleIds(await lint("components/studio/thing/thing.tsx", longUtil))).not.toContain(
      "max-lines-per-function",
    );
  });

  it("counts code and not prose: 300 comment lines change nothing", async () => {
    const prose =
      `export function f() {\n${"  // a line of prose\n".repeat(300)}` +
      `${"  let x = 0;\n".repeat(40)}  return 1;\n}\n`;
    const msgs = await lint("lib/pod/thing.ts", prose);
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("max-lines-per-function");
  });

  it("limits a test FILE but never a test function body", async () => {
    const bigIt = `it("x", () => {\n${"  let x = 0;\n".repeat(300)}});\n`;
    const msgs = await lint("lib/pod/thing.test.ts", bigIt);
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("max-lines-per-function");
    expect(ruleIds(msgs)).not.toContain("max-lines");
  });

  it("rejects a test file past its own 1000-line ceiling", async () => {
    const huge = `${"let x = 0;\n".repeat(1010)}`;
    expect(ruleIds(await lint("lib/pod/thing.test.ts", huge))).toContain("max-lines");
  });

  /**
   * A multi-line `-- reason` directive is version-sensitive ESLint behaviour and
   * is the exemption shape CLAUDE.md mandates, so it is pinned rather than
   * assumed. Measured working on ESLint 9.39.5.
   */
  it("honours a multi-line disable with a reason, which is the shape CLAUDE.md mandates", async () => {
    const exempted =
      `/* eslint-disable-next-line max-lines-per-function --\n` +
      `   reason on its own line, removal condition on another */\n` +
      `export function f() {\n${"  let x = 0;\n".repeat(90)}  return 1;\n}\n`;
    const msgs = await lint("lib/pod/thing.ts", exempted);
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("max-lines-per-function");
  });

  /**
   * A deliberate asymmetry: components/ui/** is exempt from the folder rule, the
   * comment rule and the arbitrary-Tailwind fence, but NOT from this one. The
   * answer to a vendored monolith is an exemption with a reason, not a widening.
   */
  it("holds components/ui to the render bound, since the shadcn CLI rewrites that directory", async () => {
    const longUi = `export function C() {\n${"  let x = 0;\n".repeat(210)}  return null;\n}\n`;
    expect(ruleIds(await lint("components/ui/thing.tsx", longUi))).toContain(
      "max-lines-per-function",
    );
  });
});

/**
 * ── A guardrail that is not a lint rule ─────────────────────────────────────
 *
 * WHY IT IS IN THIS FILE. Everything above proves a *fence* fires. This proves
 * the invariant a fence made necessary. `app/(public)/**` may not import
 * `**\/lib/media/**` (the "Image-processing code is studio-only" case above is
 * what enforces it), and `lib/pod/schema.ts` is read by public pages — so the
 * §6.4 blur budget could not be imported into it and had to be RESTATED there
 * (c267678). Two numbers, in two modules, with no compiler and no linter
 * holding them together: they can drift apart in silence, and the drift is
 * invisible until either an oversized placeholder ships to every reader of a
 * public page or a legitimate one is thrown away on read.
 *
 * A test file is under neither fence, so it may import both sides and hold them
 * against each other. That is the entire reason the guard lives here rather
 * than inside either module. `test/read.test.ts` was the other candidate and is
 * the wrong home: it drives normative Turtle through `readEntry` over MSW, and
 * this is not wire behaviour — it is two modules agreeing, which is what every
 * other case in this file is about.
 *
 * NOT A RESTATEMENT, WHICH IS THE POINT. `expect(BLUR_BUDGET_BYTES).toBe(1200)`
 * already exists, in test/media-targets.test.ts, and pins the VALUE. Nothing
 * here names 1200. These cases compare the two implementations TO EACH OTHER,
 * so they stay green when the budget is deliberately changed in both places and
 * go red the moment it is changed in one — which is the only failure this is
 * for. Asserting each side equals 1200 separately would be two restatements of
 * a literal and would guard nothing.
 *
 * And the schema's ceiling is reached THROUGH THE SCHEMA — by parsing strings
 * and finding where RETENTION flips — never by reading a constant or matching
 * on `.max`. A refactor that expresses the ceiling some other way keeps this
 * honest instead of breaking it.
 *
 * It bisects on retention rather than on acceptance because the ceiling stopped
 * being a rejection: over budget now DISCARDS the placeholder and keeps the
 * photo, so `safeParse` succeeds on both sides of the boundary. A bisection on
 * `success` would find no boundary at all and would have gone quietly green
 * forever — a guard that stops guarding, which is worse than the drift it was
 * watching for. `effectiveCeilingBytes` throws rather than asserts for exactly
 * that class of failure, and it throws in BOTH directions: no boundary above,
 * and a boundary that is a rejection rather than a discard.
 */
describe("the §6.4 blur budget cannot drift between lib/media and lib/pod", () => {
  const A_PHOTO = { contentUrl: "https://pod.example/travel/media/abc123/web.webp" };

  /**
   * Parse a Photo carrying exactly this placeholder, and report three things
   * where this helper used to report one.
   *
   * `accepted` — did the PHOTO survive. Since the ceiling became a discard this
   * must be true on both sides of the boundary, and asserting it is how these
   * cases hold the fix in place: an over-budget placeholder costs the
   * placeholder, never the photo, never the entry that contains it, and never
   * that entry's row in the trip index that `rebuildIndex` rewrites.
   *
   * `kept` — did the PLACEHOLDER survive. This is the boundary the bisection
   * below hunts, and the reason the helper had to change shape at all.
   *
   * `blamed` is not decoration: a rejection for an unrelated reason — a
   * contentUrl that stopped being a valid URL, a field the schema later makes
   * required — would otherwise surface as a bare `accepted: false` naming
   * nothing, and every case here would report a boundary it never measured.
   */
  function parseBlur(blurDataUrl: string) {
    const r = Photo.safeParse({ ...A_PHOTO, blurDataUrl });
    return {
      accepted: r.success,
      kept: r.success && r.data.blurDataUrl === blurDataUrl,
      value: r.success ? r.data.blurDataUrl : undefined,
      blamed: r.success ? [] : r.error.issues.map((i) => i.path.join(".")),
    };
  }

  it("the control photo parses AND keeps a small placeholder, so a discard below is the budget and not the fixture", () => {
    expect(Photo.safeParse(A_PHOTO).success).toBe(true);
    const tiny = parseBlur("data:image/webp;base64,AAAA");
    expect(tiny.accepted).toBe(true);
    // Without this second assertion a transform that discarded EVERY
    // placeholder would satisfy every `accepted` check in this describe.
    expect(tiny.kept).toBe(true);
  });

  /**
   * The largest placeholder `Photo` KEEPS, in ASCII where one character is one
   * byte, found by bisection rather than by reading the constant out of the
   * module.
   *
   * Two degenerate schemas would make a bisection meaningless, and both throw
   * here rather than returning a number this test invented:
   *
   *   - THE CEILING DELETED. The far probe is kept, so there is no boundary
   *     below `hi` and bisection would return the top of its own probe range.
   *   - THE CEILING FATAL AGAIN. The far probe is rejected rather than
   *     discarded — the regression this whole change undoes. A bisection on
   *     `kept` alone cannot tell it from a working discard, because a rejected
   *     Photo has no `blurDataUrl` to keep either.
   */
  function effectiveCeilingBytes(): number {
    let hi = 1 << 16;
    const far = parseBlur("d".repeat(hi));
    if (!far.accepted) {
      throw new Error(
        `Photo REJECTED a ${hi}-byte blurDataUrl (blamed: ${far.blamed.join(", ")}) instead of ` +
          `discarding it — the read-side §6.4 ceiling is fatal to the whole photo again, and ` +
          `with it to the entry and to that entry's row in the trip index`,
      );
    }
    if (far.kept) {
      throw new Error(
        `Photo.blurDataUrl kept ${hi} bytes — the read-side §6.4 ceiling is gone entirely`,
      );
    }
    let lo = 0; // the empty string is always kept: there is no .min() here
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      const probe = parseBlur("d".repeat(mid));
      if (!probe.accepted) {
        throw new Error(
          `Photo REJECTED a ${mid}-byte blurDataUrl (blamed: ${probe.blamed.join(", ")}) — over ` +
            `budget must discard the placeholder, not reject the photo`,
        );
      }
      if (probe.kept) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  it("the ceiling lib/pod/schema.ts enforces on read IS BLUR_BUDGET_BYTES", () => {
    expect(effectiveCeilingBytes()).toBe(BLUR_BUDGET_BYTES);
  });

  /**
   * Both sides of the boundary, in ASCII and in two-byte codepoints.
   *
   * The multi-byte pair earns its place because the budget is BYTES while the
   * obvious cheap spelling of a ceiling is a character count. Measured against
   * the installed zod@4.5.4 rather than recalled: `z.string().max(n)` counts
   * CODE POINTS — `"\u{1F600}".repeat(3)` has `.length` 6 and still passes
   * `.max(3)` — so BLUR_BUDGET_BYTES/2 accented characters are half the budget
   * in codepoints and all of it in bytes, and sail under any
   * `.max(BLUR_BUDGET_BYTES)`. Only a byte measurement decides them. The ASCII
   * bisection above cannot see it: there one character is one byte and every
   * wrong unit agrees with the right one.
   *
   * Every probe length is derived from BLUR_BUDGET_BYTES, so changing that
   * constant moves the probes and the schema stays where it is: the boundary
   * they straddle is the one under test, not a fixed one.
   */
  const PROBES: [label: string, value: string][] = [
    ["ascii, exactly at the budget", "d".repeat(BLUR_BUDGET_BYTES)],
    ["ascii, one byte over", "d".repeat(BLUR_BUDGET_BYTES + 1)],
    ["two-byte codepoints, exactly at the budget", "é".repeat(Math.floor(BLUR_BUDGET_BYTES / 2))],
    ["two-byte codepoints, one codepoint over", "é".repeat(Math.floor(BLUR_BUDGET_BYTES / 2) + 1)],
  ];

  it.each(PROBES)(
    "the read schema and withinBlurBudget agree on the same string — %s",
    (_label, value) => {
      const withinBudget = withinBlurBudget(value);
      const onRead = parseBlur(value);
      // Never fatal, on either side of the boundary. `blamed` first so that a
      // failure names the field that objected instead of printing `false`.
      expect(onRead.blamed).toEqual([]);
      expect(onRead.accepted).toBe(true);
      // The two implementations agreeing: what the writer would have emitted is
      // exactly what the reader keeps.
      expect(onRead.kept).toBe(withinBudget);
      expect(onRead.value).toBe(withinBudget ? value : undefined);
    },
  );
});

describe("setProjection has one call site", () => {
  it("is reached from the style.load handler and from nowhere else in the tree", () => {
    // Excludes *.test.ts: the fake Map in use-map-instance.test.ts must define
    // a same-named setProjection method to stand in for the real one, and a
    // dumb text scan cannot tell that apart from a second production call site.
    const hits = execFileSync(
      "git",
      ["grep", "-l", "setProjection(", "--", "lib", "components", "app", ":(exclude)**/*.test.ts", ":(exclude)**/*.test.tsx"],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    expect(hits).toEqual(["components/public/trip-map/hooks/use-map-instance.ts"]);
  });
});
