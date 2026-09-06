/**
 * Reading the output of a spawned child process, whatever colours it chose.
 *
 * WHY THIS EXISTS. `test/network-guard.test.ts` runs a child vitest and asserted
 * `/Tests\s+1 failed/` against its raw stdout. That passed here and failed on CI
 * on 2026-09-06, because vitest's default reporter renders the summary as
 *
 *     ESC[2m      Tests ESC[22m ESC[1mESC[31m1 failedESC[39m ...
 *
 * — two spaces AND four escape sequences between `Tests` and `1 failed`. `\s+`
 * matches the spaces, meets the ESC, and the match fails.
 *
 * The split local/CI behaviour was not "CI turns colour on". Colour is on by
 * DEFAULT: tinyrainbow's `isSupported()` returns true whenever `TERM` is unset
 * or not `dumb`, piped stdout or not (node_modules/tinyrainbow/dist/index.js).
 * What turned it off locally was the *agent's* environment — vitest calls
 * `disableDefaultColors()` when std-env reports `isAgent`, i.e. when `AI_AGENT`,
 * `CLAUDECODE` or one of ten similar variables is set
 * (node_modules/vitest/dist/chunks/cac.uFydS1Z4.js, `createCLI`). The spawn
 * passed no `env`, so it inherited that and the colour never appeared. Every
 * human running `npm test` from an ordinary shell got the CI behaviour, and so
 * did CI. Measured, not reasoned: `env -i HOME=... node .../vitest.mjs run`
 * emits the escapes above on this machine.
 *
 * So the callers do two things, and both are load-bearing:
 *   1. hand the child an explicit `env` instead of inheriting the ambient one,
 *      which is what made local and CI disagree in the first place; and
 *   2. strip anyway, because 1. only fixes the runs we control — an assertion
 *      that depends on the child's styling is the wrong shape regardless.
 *
 * Not in `test/network-guard.ts`: that module is the rule `test/setup.ts`
 * applies to unhandled requests, and it is loaded by every test file in the
 * suite through the setup file. Reading child-process output is a different
 * subject with a different audience — `test/vitest-collection.test.ts`,
 * `test/check-commands.test.ts` and `test/public-bundle-cli.test.ts` all spawn
 * children too.
 */

/**
 * ANSI CSI sequences: ESC `[`, zero or more parameter bytes (0x30–0x3F), zero
 * or more intermediate bytes (0x20–0x2F), one final byte (0x40–0x7E).
 *
 * That is the whole grammar, so it covers every colour (`ESC[31m`) and every
 * cursor or erase code a reporter might interleave (`ESC[2K`, `ESC[?25l`),
 * rather than the SGR subset a hand-picked list would have caught. Deliberately
 * not OSC: nothing vitest prints uses it, and a terminator-hunting OSC pattern
 * can eat real text when the terminator is missing.
 */
const CSI = /\u001B\[[0-?]*[ -/]*[@-~]/g;

/** The same text, with the styling removed and nothing else changed. */
export function stripAnsi(output: string): string {
  return output.replace(CSI, "");
}

/**
 * Vitest's summary line for a run of exactly one test that failed.
 *
 * The count is part of it. `Tests  1 failed` alone also matches
 * `Tests  1 failed | 7 passed (8)`, so it would keep passing if the child
 * suddenly collected the whole suite instead of the one fixture spec — and the
 * child in question exists to run exactly one file containing exactly one test.
 *
 * Apply it to `stripAnsi(output)`, never to raw output. Composed at the call
 * site on purpose: `expect(stripAnsi(out)).toMatch(ONE_FAILED_TEST)` prints the
 * readable, unstyled text as the received value when it fails, which a
 * boolean-returning helper cannot do.
 */
export const ONE_FAILED_TEST = /^\s*Tests\s+1 failed\s+\(1\)\s*$/m;
