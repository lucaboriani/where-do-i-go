import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Guardrails. These encode rules from CLAUDE.md and docs/data-model.md §11 that
 * cannot be inferred from the code, and they exist because an agent — or a
 * tired human — will otherwise rationalise past them.
 *
 * Note the honest limit: TODO.md observes that "an agent can rationalise past a
 * lint rule but not past a failing build". The size-limit budget on public
 * routes is the enforcement that really holds; these rules catch the mistake
 * earlier and explain it.
 */

/** Raw vocabulary IRIs belong in lib/vocab.ts and nowhere else. */
const NO_RAW_IRIS = {
  selector:
    "Literal[value=/^https?:\\/\\/(schema\\.org|purl\\.org|www\\.w3\\.org|xmlns\\.com|example\\.org\\/ns)/]",
  message:
    "Import the IRI from lib/vocab.ts instead of writing it inline. Three spellings of the same predicate is how a Pod rots (docs/data-model.md §11).",
};

/**
 * Every access-control primitive @inrupt/solid-client exposes, banned outside
 * lib/pod/access.ts.
 *
 * The list IS the fence, so it has to be complete rather than representative:
 * an unlisted primitive is a hole, and a hole here means lib/pod/read.ts can
 * rewrite an ACL with no lint error at all. Nine names once covered the ones
 * the module happened to use, which is a different thing.
 *
 * Re-derive it on an upgrade from node_modules/@inrupt/solid-client/dist/index.d.ts:
 * everything exported from ./acl/acl, ./acl/agent, ./acl/group, ./acl/class and
 * ./acl/mock, plus getEffectiveAccess from ./resource/resource (it reads the
 * WAC-Allow header, i.e. it answers "is this public?" — that is getAccess's
 * job), and the universalAccess and acp_ess_2 namespaces.
 */
const ACL_PRIMITIVES = [
  // ./acl/acl
  "hasAcl",
  "hasAccessibleAcl",
  "hasResourceAcl",
  "hasFallbackAcl",
  "getResourceAcl",
  "getFallbackAcl",
  "getSolidDatasetWithAcl",
  "getFileWithAcl",
  "getResourceInfoWithAcl",
  "createAcl",
  "createAclFromFallbackAcl",
  "saveAclFor",
  "deleteAclFor",
  // ./acl/agent
  "getAgentAccess",
  "getAgentAccessAll",
  "getAgentResourceAccess",
  "getAgentResourceAccessAll",
  "setAgentResourceAccess",
  "getAgentDefaultAccess",
  "getAgentDefaultAccessAll",
  "setAgentDefaultAccess",
  // ./acl/group
  "getGroupAccess",
  "getGroupAccessAll",
  "getGroupResourceAccess",
  "getGroupResourceAccessAll",
  "setGroupResourceAccess",
  "getGroupDefaultAccess",
  "getGroupDefaultAccessAll",
  "setGroupDefaultAccess",
  // ./acl/class
  "getPublicAccess",
  "getPublicResourceAccess",
  "getPublicDefaultAccess",
  "setPublicResourceAccess",
  "setPublicDefaultAccess",
  // ./acl/mock — a test that mocks an ACL is testing the library's idea of one,
  // not the Pod's. Fake at the HTTP layer instead (CLAUDE.md, Testing).
  "addMockResourceAclTo",
  "addMockFallbackAclTo",
  // ./resource/resource
  "getEffectiveAccess",
  // namespaces
  "universalAccess",
  "acp_ess_2",
];

/**
 * Tailwind arbitrary values, e.g. w-[137px]. Banned outside components/ui.
 *
 * FOUR ARMS, BECAUSE ONE ONLY SAW HALF THE CODE. Until 2026-09-05 this was the
 * `JSXAttribute` arm alone, so it read a class string written INLINE in the
 * attribute and nothing else. `components/studio/entry-editor.tsx` keeps its
 * two shared class strings in module-level consts spent as `className={CONTROL}`
 * — an `Identifier`, not a `Literal` — and the rule was blind to both. Measured:
 * `disabled:bg-[#222]` inside `CONTROL` produced zero errors, the same string
 * inline produced one. Extracting a class string to a const is the ordinary way
 * to stop two controls drifting apart, so this was not an exotic dodge; it is
 * what the file already did.
 *
 * THE DEPTHS ARE DELIBERATELY ASYMMETRIC — child-anchored at the declarator,
 * descendant inside the concatenation — and both halves are load-bearing:
 *
 * - `VariableDeclarator > Literal` rather than `VariableDeclarator Literal`.
 *   The descendant form makes `test/guardrails.test.ts` UNLINTABLE: its own
 *   fixtures live inside `const msgs = await lint(…)`, which makes every
 *   deliberate violation a descendant of a declarator. Measured — the
 *   descendant shape flags that file twice and still passes every snippet
 *   case, so the tests would look fine while the guardrail broke the file that
 *   proves it works.
 * - ...but descendant WITHIN the `BinaryExpression`, because `+` nests to the
 *   left: in `"a " + "b " + "p-[3px]"` the offender is a grandchild, not a
 *   child, and a `> BinaryExpression > Literal` arm would pass a two-part
 *   concatenation and miss a three-part one.
 * - The `TemplateLiteral` arm exists because static template text is a
 *   `TemplateElement`, not a `Literal`. Without it the rule is bypassed by
 *   swapping a quote for a backtick, which is output both a formatter and an
 *   agent produce without thinking about it.
 *
 * Name-agnostic on purpose: a rule keyed to `CONTROL`/`BUTTON` is defeated by a
 * rename, and directory scoping would need a `files` list that rots. Repo-wide
 * this flags zero places outside `components/ui/**`, which is already exempt.
 *
 * The `-` in the pattern is what keeps `eslint.config.mjs` itself clean, not
 * the selector depth: this file holds two bare `[…]` strings, but none with an
 * alphanumeric immediately before the bracket. Do not "simplify" it away.
 *
 * NOT covered, and kept in view rather than pretended away: a class string held
 * in an object property or an array element, and `clsx`/`cva` argument
 * positions. Also note the `lib/vocab.ts` block below names this list
 * explicitly — new arms do not reach it unless that spread is kept in step.
 */
const TW_ARBITRARY = "[a-z0-9]-\\[[^\\]]+\\]";
const TW_MESSAGE =
  "Arbitrary Tailwind values are banned outside components/ui/**. Use a design token from app/globals.css (docs/design-brief.md).";

const NO_ARBITRARY_TAILWIND = [
  {
    selector: `JSXAttribute[name.name='className'] Literal[value=/${TW_ARBITRARY}/]`,
    message: TW_MESSAGE,
  },
  { selector: `VariableDeclarator > Literal[value=/${TW_ARBITRARY}/]`, message: TW_MESSAGE },
  {
    selector: `VariableDeclarator > BinaryExpression Literal[value=/${TW_ARBITRARY}/]`,
    message: TW_MESSAGE,
  },
  {
    selector: `VariableDeclarator > TemplateLiteral > TemplateElement[value.raw=/${TW_ARBITRARY}/]`,
    message: TW_MESSAGE,
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**"]),

  // ---------------------------------------------------------------- everywhere
  {
    files: ["**/*.{ts,tsx,mjs}"],
    rules: {
      "no-restricted-syntax": ["error", NO_RAW_IRIS, ...NO_ARBITRARY_TAILWIND],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@inrupt/solid-client",
              importNames: ACL_PRIMITIVES,
              message:
                "Access control goes through lib/pod/access.ts only — the four-method interface in docs/data-model.md §5. Mechanisms differ per server (WAC vs ACP) and are not reliably detectable; see decisions.md §19.",
            },
          ],
        },
      ],
    },
  },

  // ------------------------------------------------- lib/vocab.ts is the source
  {
    files: ["lib/vocab.ts"],
    rules: { "no-restricted-syntax": ["error", ...NO_ARBITRARY_TAILWIND] },
  },

  // ------------------------------- lib/pod/access.ts is the one ACL implementor
  {
    files: ["lib/pod/access.ts"],
    rules: { "no-restricted-imports": "off" },
  },

  // ------------------------------------- shadcn's copied source uses these freely
  {
    files: ["components/ui/**"],
    rules: { "no-restricted-syntax": ["error", NO_RAW_IRIS] },
  },

  // --------------------------------------------------- the public/studio boundary
  {
    // app/not-found.tsx and app/global-error.tsx are listed individually
    // because they are public-facing pages that sit OUTSIDE app/(public)/**.
    // Next requires them at the app root; not-found.tsx renders its own <html>
    // precisely because there is no shared root layout to inherit. A read-only
    // review found not-found.tsx could import the Solid auth library with no
    // error at all, on a page every 404 renders. global-error.tsx does not
    // exist yet and a files entry for an absent file is inert — it is here so
    // that the day someone adds one, it is not another unfenced public page.
    files: [
      "app/(public)/**",
      "components/public/**",
      "app/not-found.tsx",
      "app/global-error.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          // ESLint flat config REPLACES a rule's options rather than merging
          // them, so this block silences the ACL ban above unless it repeats
          // it. Omitting it let a public route import setPublicDefaultAccess
          // and rewrite an ACL directly — on the one path where invariant 3 and
          // the bundle budget both say the Solid libraries must never appear.
          // Caught by test/guardrails.test.ts; keep the two in step.
          paths: [
            {
              name: "@inrupt/solid-client",
              importNames: ACL_PRIMITIVES,
              message:
                "Access control goes through lib/pod/access.ts only — and a public route must not touch it at all.",
            },
          ],
          patterns: [
            {
              group: ["**/app/(studio)/**", "**/(studio)/**"],
              message:
                "app/(public) must never import from (studio). Separate root layouts are what keep the bundles apart.",
            },
            {
              group: ["@inrupt/solid-client-authn-browser", "@inrupt/solid-client-authn-browser/**"],
              message:
                "The public path is unauthenticated by design and uses plain fetch. No Solid auth library on public routes.",
            },
            {
              // All three Radix spellings, because the one this project
              // actually writes was the one missing. package.json depends on
              // `radix-ui` ^1.6.7 — the unified package — and on no
              // `@radix-ui/react-*` package directly; all seven Radix imports
              // under components/ui/** are `from "radix-ui"`. So the group used
              // to fence a scoped spelling that appears nowhere in the repo
              // while the spelling someone would actually produce — copying a
              // line out of components/ui/dialog.tsx — sailed through.
              //
              // On `radix-ui/*`, measured rather than assumed: ESLint matches
              // these groups with gitignore-style semantics, not minimatch, so
              // the bare `radix-ui` entry ALREADY covers `radix-ui/dialog` and
              // deeper. The subpath entry is redundant today and kept anyway,
              // because the subpath is genuinely reachable (the exports map has
              // "./*" and dist/dialog.mjs exists) and this is the entry that
              // would still fence it if that matcher ever changed. Do not read
              // it as the thing doing the work — the bare name is.
              //
              // The scoped form stays on its own account: radix-ui depends on
              // the scoped packages, so they sit in node_modules and a
              // deliberate import, or one copied out of Radix's own docs,
              // resolves today.
              group: ["radix-ui", "radix-ui/*", "@radix-ui/*", "vaul", "sonner", "cmdk"],
              message:
                "shadcn/Radix is studio-only (decisions.md §11). Nothing from it may reach a public reading page.",
            },
            {
              // next-themes arrives as a transitive concern of shadcn's sonner
              // component (components/ui/sonner.tsx imports useTheme from it),
              // so it is on disk and importable. Nothing public may want it:
              // CLAUDE.md fixes the theme to dark, puts the palette at :root
              // rather than under a .dark class, and rules out a theme toggle.
              // A next-themes import on a public route is therefore either dead
              // weight in the bundle or the start of a toggle that the design
              // has already declined. Studio and components/ui keep it.
              // Bare name only: per the note above it covers subpaths too.
              group: ["next-themes"],
              message:
                "The theme is fixed dark, with the palette at :root and no toggle (CLAUDE.md, Styling). next-themes is studio-only, where it arrives via shadcn's sonner.",
            },
            {
              // save-entry.ts is the §10 write sequence and imports access.ts,
              // so a public page importing it pulls @inrupt/solid-client in one
              // step removed — the same shape as the lib/studio hole below.
              // entry-model.ts is pure and drags nothing in, and is fenced
              // anyway: nothing public has any business serialising an entry,
              // and a module on neither list is invisible to every check here.
              group: [
                "**/lib/pod/write", "**/lib/pod/write.*",
                "**/lib/pod/access", "**/lib/pod/access.*",
                "**/lib/pod/save-entry", "**/lib/pod/save-entry.*",
                "**/lib/pod/entry-model", "**/lib/pod/entry-model.*",
              ],
              message:
                "lib/pod/write.ts, lib/pod/access.ts, lib/pod/save-entry.ts and lib/pod/entry-model.ts are studio-only. Public routes read through lib/pod/read.ts.",
            },
            {
              // The directory, not one filename: naming `session` alone would
              // leave every other studio module reachable from a public page.
              group: ["**/lib/studio", "**/lib/studio/**"],
              message:
                "lib/studio is studio-only. It wraps @inrupt/solid-client-authn-browser, so importing it from a public route drags the auth library into the public bundle indirectly — the ban on the library itself, one step removed.",
            },
            {
              // The bare directory AND the subpath, matching the lib/studio
              // fence above. no-restricted-imports matches these groups with
              // gitignore semantics, not minimatch, so "**/lib/media/**" alone
              // does NOT match a bare "@/lib/media" import resolving to an
              // index file. Measured, not inferred: before this entry existed,
              // linting `import * as m from "@/lib/media"` at
              // app/(public)/__fence-probe.tsx reported nothing at all, while
              // the same file importing "@/lib/media/resize" was reported —
              // so the file was being linted and the fence simply did not
              // match. There is no lib/media/index.ts today; this closes the
              // hole before there is one, which is the only time it can be
              // closed without a public bundle already carrying the weight.
              group: ["exifreader", "**/lib/media", "**/lib/media/**"],
              message:
                "Image-processing code is studio-only; it must not weigh down the public bundle.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
