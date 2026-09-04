import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import config from "../eslint.config.mjs";

/**
 * TODO.md phase 0.5: "A deliberate violation of each guardrail rule fails CI —
 * test the enforcement, don't assume it."
 *
 * Each case lints a snippet *at a path where the rule is supposed to apply*,
 * because every guardrail here is path-scoped. Linting the right code at the
 * wrong path proves nothing.
 */

const eslint = new ESLint({ cwd: process.cwd() });

async function lint(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  return result?.messages ?? [];
}

const ruleIds = (msgs: Awaited<ReturnType<typeof lint>>) => msgs.map((m) => m.ruleId);

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

  /** The allow-case: the studio importing its own modules is the normal case. */
  it("allows a studio page to import another (studio) module", async () => {
    const msgs = await lint(
      "app/(studio)/studio/page.tsx",
      `import Shell from "@/app/(studio)/studio/shell";\nexport default Shell;\n`,
    );
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

  /** The allow-cases: the studio, and lib/media itself, must keep using it. */
  it.each([
    ["app/(studio)/thing.tsx", "exifreader"],
    ["lib/media/resize.ts", "exifreader"],
    ["app/(studio)/thing.tsx", "@/lib/media/resize"],
  ])("allows %s to import %s", async (path, moduleSpecifier) => {
    const msgs = await lint(
      path,
      `import * as mod from "${moduleSpecifier}";\nexport default function T() { return <div>{String(mod)}</div>; }\n`,
    );
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  it("rejects importing studio-only pod modules from a public route", async () => {
    const msgs = await lint(
      "app/(public)/thing.tsx",
      `import { write } from "@/lib/pod/write";\nexport default function T() { return <div>{String(write)}</div>; }\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
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
});
