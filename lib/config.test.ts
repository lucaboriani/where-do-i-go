/**
 * `MAP_STYLE_URL` is an override rather than a default, and `undefined` is the
 * signal that means "use the in-repo style".
 * ./notes.md#the-map-style-url-is-an-override-not-a-default
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "@/lib/config";

const original = process.env.MAP_STYLE_URL;

afterEach(() => {
  if (original === undefined) delete process.env.MAP_STYLE_URL;
  else process.env.MAP_STYLE_URL = original;
});

const SET = "https://tiles.example/styles/mine";

/** Each case asserts the getter is LIVE before asserting what it answers.
 *  Without that, "expected undefined" passes against a `config` object with no
 *  such property at all — green for the wrong reason, in the exact shape
 *  CLAUDE.md names. */
describe("config.mapStyleUrl", () => {
  it("is undefined when unset, which is what selects the in-repo style", () => {
    process.env.MAP_STYLE_URL = SET;
    expect(config.mapStyleUrl, "the getter is live").toBe(SET);
    delete process.env.MAP_STYLE_URL;
    expect(config.mapStyleUrl).toBeUndefined();
  });

  it("is the value verbatim when set, so a deployer's own style wins whole", () => {
    process.env.MAP_STYLE_URL = SET;
    expect(config.mapStyleUrl).toBe(SET);
  });

  it("treats an empty or blank value as unset, because a blank .env line is not a URL", () => {
    process.env.MAP_STYLE_URL = SET;
    expect(config.mapStyleUrl, "the getter is live").toBe(SET);
    process.env.MAP_STYLE_URL = "";
    expect(config.mapStyleUrl).toBeUndefined();
    process.env.MAP_STYLE_URL = "   ";
    expect(config.mapStyleUrl, "whitespace is blank too").toBeUndefined();
  });

  it("trims what it returns, so a stray leading space is not part of the URL", () => {
    process.env.MAP_STYLE_URL = ` ${SET} `;
    expect(config.mapStyleUrl).toBe(SET);
  });
});

/**
 * The regression decision 27 exists for, pinned so it cannot come back. Nothing
 * under `test/` or `scripts/` reads `.env.example`, so without this the only
 * guard was a `grep -c` in a plan nobody re-runs. The precedent for a test
 * reading a non-source file is `lib/map/tokens.test.ts` on `app/globals.css`.
 */
describe(".env.example", () => {
  it("ships no MAP_STYLE_URL value, because a copied .env.local would swap the palette", () => {
    const env = readFileSync(
      fileURLToPath(new URL("../.env.example", import.meta.url)),
      "utf8",
    );
    expect(env, "the file was found and is not empty").toContain("MAP_STYLE_URL");
    expect(env).not.toMatch(/^\s*MAP_STYLE_URL=.+$/m);
  });
});
