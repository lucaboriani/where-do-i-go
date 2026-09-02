import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

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

  it("allows the auth library in the studio", async () => {
    const msgs = await lint(
      "app/(studio)/thing.tsx",
      `import { login } from "@inrupt/solid-client-authn-browser";\nexport default function T() { return <div onClick={() => login({})} />; }\n`,
    );
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });
});
