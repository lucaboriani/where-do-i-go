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
              importNames: [
                "universalAccess",
                "acp_ess_2",
                "getSolidDatasetWithAcl",
                "getAgentAccess",
                "setAgentAccess",
                "getPublicAccess",
                "setPublicAccess",
                "createAcl",
                "saveAclFor",
              ],
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
    files: ["app/(public)/**", "components/public/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
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
