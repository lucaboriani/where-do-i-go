# test/support

## why-a-walker

`vitest.config.ts` once included only `**/*.test.ts`. The repository's first `.tsx` test —
`test/studio-shell.test.tsx`, 31 kB — was therefore collected by nothing, and the suite
reported "280 passed" identically with and without it on disk. An uncollected file does not
report red; it does not report at all.

`vitest-collection.test.ts` was written to catch that, but it listed `test/` **top level
only**. Once tests moved next to their subjects, that guard would have kept passing while
grading an empty directory — the same defect, reintroduced by its own fix. Hence a walker,
and hence a test that asserts depth rather than merely presence.
