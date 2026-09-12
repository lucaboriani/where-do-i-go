import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** Guardrails: rules from CLAUDE.md and docs/data-model.md §11 that the code
 *  cannot state itself. The honest limit is that the public bundle budget is
 *  the enforcement which really holds; these catch the same mistake earlier.
 *  ./notes.md#why-the-guardrails-exist-and-the-honest-limit */

/** Raw vocabulary IRIs belong in lib/vocab.ts and nowhere else. */
const NO_RAW_IRIS = {
  selector:
    "Literal[value=/^https?:\\/\\/(schema\\.org|purl\\.org|www\\.w3\\.org|xmlns\\.com|example\\.org\\/ns)/]",
  message:
    "Import the IRI from lib/vocab.ts instead of writing it inline. Three spellings of the same predicate is how a Pod rots (docs/data-model.md §11).",
};

/** Every access-control primitive @inrupt/solid-client exposes, banned outside
 *  lib/pod/access.ts. THE LIST IS THE FENCE, so it must be complete rather
 *  than representative: an unlisted primitive is a hole. Re-derive it on an
 *  upgrade — ./notes.md#the-acl-primitive-list-is-the-fence-so-it-must-be-complete */
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

/** Tailwind arbitrary values, e.g. w-[137px]. Banned outside components/ui.
 *  FOUR ARMS AND TWO DIFFERENT DEPTHS, each measured against a dodge the
 *  previous version passed — and the `-` in the pattern is what keeps this
 *  file itself clean. Do not simplify either away; read why first:
 *  ./notes.md#four-arms-against-arbitrary-tailwind-values-and-two-depths */
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

/** Shared by the public block and lib/map so the two copies cannot drift;
 *  the stylesheet subpath stays importable on purpose.
 *  ./notes.md#why-the-maplibre-entries-are-hoisted */
const MAPLIBRE_PATH = {
  name: "maplibre-gl",
  message:
    "maplibre-gl must never be statically imported by a public route — 252.8 kB gzip against a 190 kB budget. The map is lazy: `await import(\"maplibre-gl\")` inside the intersection handler, typed with `import(\"maplibre-gl\").Map`, so the chunk is one the prerendered HTML never names (CLAUDE.md, Map). The stylesheet subpath is deliberately still allowed.",
};

const MAPLIBRE_PATTERN = {
  group: ["maplibre-gl/dist/*.js", "maplibre-gl/dist/*.mjs"],
  message:
    "Import maplibre-gl lazily, not by a deep path: `await import(\"maplibre-gl\")`. Only the stylesheet subpath may be imported statically.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**", ".pod-data/**"]),

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
    // app/not-found.tsx and app/global-error.tsx are listed individually:
    // both are public-facing pages OUTSIDE app/(public)/**, and one of them
    // could import the auth library with no error at all.
    // ./notes.md#why-the-two-app-root-public-pages-are-listed-individually
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
            // EXACT SPECIFIER, not a pattern. "maplibre-gl/**" would also
            // refuse dist/maplibre-gl.css, which the attribution control
            // needs, and no negation re-includes it under gitignore
            // semantics. Measured across eight import shapes.
            MAPLIBRE_PATH,
          ],
          patterns: [
            {
              // components/studio/** HAS NO PARENTHESES, so the two (studio)
              // globs missed it and the media subsystem sat one import from a
              // public page. The bare directory AND the subpath, both measured:
              // ./notes.md#the-parenthesis-hole-in-the-studio-fence
              // ./notes.md#why-a-fence-names-the-bare-directory-as-well-as-the-subpath
              group: [
                "**/app/(studio)/**",
                "**/(studio)/**",
                "**/components/studio",
                "**/components/studio/**",
              ],
              message:
                "app/(public) must never import from (studio), including components/studio. Separate root layouts are what keep the bundles apart.",
            },
            {
              group: ["@inrupt/solid-client-authn-browser", "@inrupt/solid-client-authn-browser/**"],
              message:
                "The public path is unauthenticated by design and uses plain fetch. No Solid auth library on public routes.",
            },
            {
              // All three spellings, because the one this project actually
              // writes was the one missing. `radix-ui/*` is redundant today and
              // kept deliberately — the bare name is what does the work:
              // ./notes.md#the-three-radix-spellings-and-which-one-does-the-work
              group: ["radix-ui", "radix-ui/*", "@radix-ui/*", "vaul", "sonner", "cmdk"],
              message:
                "shadcn/Radix is studio-only (decisions.md §11). Nothing from it may reach a public reading page.",
            },
            {
              // On disk via shadcn's sonner, and wanted by nothing public: the
              // theme is fixed dark, at :root, with no toggle. Bare name only.
              // ./notes.md#why-next-themes-is-fenced-from-public-routes
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
              // The hooks moved to a ROOT directory on 2026-09-12, out from
              // behind the components/studio ban; this is that ban at their new
              // home. Bare directory as well as subpath, as lib/studio has it.
              group: ["**/hooks/studio", "**/hooks/studio/**"],
              message:
                "hooks/studio is studio-only. Every hook there reaches lib/studio, lib/pod/write or lib/media, so importing one from a public route drags the auth library into the public bundle indirectly — the ban on components/studio, one directory removed.",
            },
            {
              // The bare directory AND the subpath, matching the lib/studio
              // fence above: "**/lib/media/**" alone does NOT match a bare
              // "@/lib/media". Measured, and closed before an index.ts exists:
              // ./notes.md#why-a-fence-names-the-bare-directory-as-well-as-the-subpath
              group: ["exifreader", "**/lib/media", "**/lib/media/**"],
              message:
                "Image-processing code is studio-only; it must not weigh down the public bundle.",
            },
            // The bare specifier above does not cover a deep path, and
            // dist/maplibre-gl.mjs is the same 252.8 kB by another name.
            // Scoped to JS so the .css subpath stays reachable.
            MAPLIBRE_PATTERN,
          ],
        },
      ],
    },
  },

  // ------------------------------- what a public page can reach, fenced too
  {
    /** Publicly reachable and fenced by nothing until now: an import of
     *  lib/studio here would drag the auth library into a public route one
     *  level down. ./notes.md#why-the-publicly-reachable-lib-modules-are-fenced-too */
    files: [
      "lib/time/**/*.ts",
      "lib/place/**/*.ts",
      "lib/config.ts",
      "lib/vocab.ts",
      "lib/pod/read.ts",
      "lib/pod/cached.ts",
      "lib/pod/result.ts",
      "lib/pod/tags.ts",
      "lib/pod/schema.ts",
      "lib/pod/rdf.ts",
      "lib/map/**/*.ts",
      "lib/utils.ts",
      // NOT "hooks/**/*.{ts,tsx}": resolveBeltModules in test/guardrails.test.ts
      // reads one directory level and throws on a glob matching no production
      // file, and hooks/ itself holds only the two area directories. The
      // extensions match the length block's — a hook returning a marker
      // element is a .tsx, and a .ts-only glob leaves it unfenced.
      "hooks/map/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          // Flat config REPLACES a rule's options per file, not merges them, so
          // this block would silently drop the ACL ban above for lib/pod/read.ts
          // unless it repeats it — caught by the primitive-sweep tests below.
          paths: [
            {
              name: "@inrupt/solid-client",
              importNames: ACL_PRIMITIVES,
              message:
                "Access control goes through lib/pod/access.ts only — the four-method interface in docs/data-model.md §5. Mechanisms differ per server (WAC vs ACP) and are not reliably detectable; see decisions.md §19.",
            },
            MAPLIBRE_PATH,
          ],
          patterns: [
            {
              // "**/studio", not "**/hooks/studio": from hooks/map the sibling
              // spells ../studio, which contains no "hooks/" segment at all.
              // ./notes.md#why-the-belt-names-any-studio-directory
              group: ["@inrupt/*", "**/studio", "**/studio/**"],
              message:
                "This module is imported by public routes. Importing lib/studio, hooks/studio or an Inrupt package here puts the auth library in the public bundle indirectly — the same failure the app/(public) fence prevents, one level down.",
            },
            MAPLIBRE_PATTERN,
          ],
        },
      ],
    },
  },

  // ------------------------------------------ function length, hard bounds only
  /** 200/80 are the bounds CI refuses; CLAUDE.md's 130/50 are TENDENCIES, which
   *  check:structure reports without failing. Own block per rule name, because
   *  flat config REPLACES a rule's options rather than merging them:
   *  ./notes.md#why-the-function-length-bounds-are-200-and-80-in-blocks-of-their-own */
  {
    files: ["components/**/*.{ts,tsx}", "app/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"],
    rules: {
      "max-lines-per-function": [
        "error",
        { max: 200, skipComments: true, skipBlankLines: true, IIFEs: true },
      ],
    },
  },
  {
    files: ["lib/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "max-lines-per-function": [
        "error",
        { max: 80, skipComments: true, skipBlankLines: true, IIFEs: true },
      ],
    },
  },
  /**
   * A test file has a ceiling; a test FUNCTION has none. A scenario test reads
   * better whole than shredded into helpers whose names hide the arrangement,
   * so `max-lines-per-function` is off here and `max-lines` takes its place.
   * Last of the three: a components/ test file matches both, later block wins.
   */
  {
    files: ["**/*.test.{ts,tsx}", "e2e/**/*.ts"],
    rules: {
      "max-lines-per-function": "off",
      "max-lines": ["error", { max: 1000, skipComments: true, skipBlankLines: true }],
    },
  },
]);

export default eslintConfig;
