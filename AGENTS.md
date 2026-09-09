# MANDATORY RULES

1. **BE CONCISE UNLESS OTHERWISE STATED.**
2. **SIMPLICITY BEATS CLEVERNESS.**

They outrank everything below. A shorter answer and a plainer implementation are the defaults;
length and cleverness have to be asked for. When a rule further down this file could be read two
ways, these two decide it.

---

# AGENTS.md

Project rules for this repository live in **`CLAUDE.md`**. Read that first — it carries the
architectural invariants, the data-model contract, and the hard rules, none of which can be
inferred by reading the code.

Other entry points:

| File | What it covers |
|---|---|
| `CLAUDE.md` | Rules and invariants. Start here. |
| `TODO.md` | Ordered task list, beginning with installation and setup |
| `docs/data-model.md` | The RDF contract. Normative. |
| `docs/decisions.md` | Why the stack is what it is |
| `docs/design-brief.md` | Visual direction and the palette |
| `docs/versions.md` | Pinned dependency versions and known pitfalls |
| `docs/phase-0-spike.md` | Platform assumptions to verify first |

This file exists so that the Next.js managed block below lands here rather than in
`CLAUDE.md`. `next dev` writes it, and it replaces its own block in place on each run. Leave
the markers alone and commit changes to the block along with your work.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
