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
