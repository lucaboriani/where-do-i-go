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

/** Tailwind arbitrary values, e.g. w-[137px]. Banned outside components/ui. */
const NO_ARBITRARY_TAILWIND = {
  selector: "JSXAttribute[name.name='className'] Literal[value=/[a-z0-9]-\\[[^\\]]+\\]/]",
  message:
    "Arbitrary Tailwind values are banned outside components/ui/**. Use a design token from app/globals.css (docs/design-brief.md).",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**"]),

  // ---------------------------------------------------------------- everywhere
  {
    files: ["**/*.{ts,tsx,mjs}"],
    rules: {
      "no-restricted-syntax": ["error", NO_RAW_IRIS, NO_ARBITRARY_TAILWIND],
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
    rules: { "no-restricted-syntax": ["error", NO_ARBITRARY_TAILWIND] },
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
              group: ["@radix-ui/*", "vaul", "sonner", "cmdk"],
              message:
                "shadcn/Radix is studio-only (decisions.md §11). Nothing from it may reach a public reading page.",
            },
            {
              group: ["**/lib/pod/write", "**/lib/pod/write.*", "**/lib/pod/access", "**/lib/pod/access.*"],
              message:
                "lib/pod/write.ts and lib/pod/access.ts are studio-only. Public routes read through lib/pod/read.ts.",
            },
            {
              // The directory, not one filename: naming `session` alone would
              // leave every other studio module reachable from a public page.
              group: ["**/lib/studio", "**/lib/studio/**"],
              message:
                "lib/studio is studio-only. It wraps @inrupt/solid-client-authn-browser, so importing it from a public route drags the auth library into the public bundle indirectly — the ban on the library itself, one step removed.",
            },
            {
              group: ["exifreader", "**/lib/media/**"],
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
