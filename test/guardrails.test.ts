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

  it("rejects Radix on a public route", async () => {
    const msgs = await lint(
      "app/(public)/thing.tsx",
      `import * as Dialog from "@radix-ui/react-dialog";\nexport default function T() { return <Dialog.Root />; }\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
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
   * FAILING ON PURPOSE — a hole in the fence, not a broken test.
   *
   * `no-restricted-imports` is configured twice: once for `**` with `paths`
   * (the ACL ban list) and once for `app/(public)/**` and `components/public/**`
   * with `patterns` (the import boundary). ESLint flat config REPLACES a rule's
   * options rather than merging them, so the second block switches the first one
   * off for exactly those paths. Verified by linting a real file:
   * `app/(public)/__hole/page.tsx` importing `universalAccess`,
   * `setPublicDefaultAccess` and `getResourceInfoWithAcl` exits 0.
   *
   * The boundary patterns block `@/lib/pod/access`, so a public route cannot
   * reach OUR module — but it can import the raw primitives from
   * @inrupt/solid-client and rewrite an ACL directly, on the one path where the
   * bundle budget and architecture invariant 3 both say the Solid libraries must
   * never appear.
   *
   * The fix belongs in eslint.config.mjs, not here: the `app/(public)` block has
   * to carry the ACL `paths` entry as well as its `patterns`, or the two rules
   * have to be split so one cannot silence the other.
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
});
