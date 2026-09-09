// @vitest-environment jsdom
/** §7.6 read on mount, the three states its answer leaves, and the two things
 *  only this hook can be asked: one read per URL under StrictMode, and a
 *  `fuzzed` that fails closed on every gate that is not open.
 *  ./notes.md#what-use-settings-gate-is-tested-for */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { err, ok } from "@/lib/pod/result";
import { useSettingsGate } from "./use-settings-gate";
import type { SettingsGateSeed } from "./use-settings-gate";
import type { PrivacySettings } from "@/lib/pod/schema";
import type { StudioSessionLike } from "@/lib/studio/session";

/**
 * MOCKED, unlike the component suites, which serve `privacy.ttl` over MSW on
 * purpose. What is under test here is the hook's own decisions, the read is
 * covered by test/privacy-settings.test.ts, and holding the promise by hand is
 * the only way to ask "how many reads?" ./notes.md#why-this-one-mocks-the-read
 */
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pod/read", () => ({ readPrivacySettings: read }));

afterEach(cleanup);

const SETTINGS_URL = "https://pod.example/travel/settings/privacy.ttl";

/** §7.6's own fixture: 500 m is deliberately NOT one of `PRECISION_GRIDS`. */
const settings = (over: Partial<PrivacySettings> = {}): PrivacySettings => ({
  iri: `${SETTINGS_URL}#it`,
  schemaVersion: 1,
  home: { lat: 45.4642, long: 9.19, radiusMeters: 2000 },
  defaultPrecisionMeters: 500,
  ...over,
});

const session = {
  fetch: vi.fn(),
  info: { isLoggedIn: true, webId: "u" },
} as unknown as StudioSessionLike;

function seed(over: Partial<SettingsGateSeed> = {}): SettingsGateSeed {
  return {
    settingsUrl: SETTINGS_URL,
    session,
    precision: "",
    onDefaultPrecision: vi.fn(),
    ...over,
  };
}

/**
 * `renderHook(() => useSettingsGate(seed()))` is a LOOP, not a shorthand: a
 * fresh `onDefaultPrecision` per render re-runs the read effect, which
 * re-`setGate`s. Every seed here is therefore built once, outside the render
 * callback. ./notes.md#why-the-seed-is-built-outside-the-render-callback
 */
function held(over: Partial<SettingsGateSeed> = {}) {
  read.mockReturnValue(new Promise(() => {}));
  const props = seed(over);
  return renderHook(() => useSettingsGate(props));
}

/** Resolved settings, awaited. `act` because the `.then` sets state. */
async function landed(over: Partial<SettingsGateSeed> = {}, value = settings()) {
  read.mockReturnValue(Promise.resolve(ok(value)));
  const rendered = renderHook((props: SettingsGateSeed) => useSettingsGate(props), {
    initialProps: seed(over),
  });
  await act(async () => {});
  return rendered;
}

beforeEach(() => {
  read.mockReset();
});

describe("useSettingsGate — the three states", () => {
  it("holds the controls while the answer is outstanding, and says so without saying what", async () => {
    const { result } = held();
    expect(result.current.coordinatesLive).toBe(false);
    expect(result.current.presetPrecision).toBe("");
    expect(result.current.coordinateNote).toMatch(/waiting/i);
    // Shares no vocabulary with the `closed` sentence: while the answer is
    // outstanding the owner must not be told what it is.
    expect(result.current.coordinateNote).not.toMatch(/could not be read/i);
    expect(result.current.settingsDetail).toBeNull();
  });

  it("opens them on a read that worked, and reports the owner's own default", async () => {
    const onDefaultPrecision = vi.fn();
    const { result } = await landed({ onDefaultPrecision });
    expect(result.current.coordinatesLive).toBe(true);
    expect(result.current.coordinateNote).toBeNull();
    expect(result.current.presetPrecision).toBe("500");
    expect(result.current.settingsDetail).toBeNull();
    expect(onDefaultPrecision, "VERBATIM, never mapped onto the grid list").toHaveBeenCalledWith(
      "500",
    );
  });

  it("closes them on a read that failed, and carries the detail outside the sentence", async () => {
    read.mockReturnValue(Promise.resolve(err({ kind: "http", status: 404, url: SETTINGS_URL })));
    const props = seed();
    const { result } = renderHook(() => useSettingsGate(props));
    await act(async () => {});
    expect(result.current.coordinatesLive).toBe(false);
    expect(result.current.coordinateNote).toMatch(/without a map pin/i);
    expect(result.current.settingsDetail, "the failure, under the sentence").not.toBeNull();
  });

  it("treats settings with NO home as READY — one fact is not the other (§7.6, §9)", async () => {
    // `{ kind: "closed" }` here strips the pin from every entry of everyone who
    // never set a home region, silently and for ever.
    const { result } = await landed({}, settings({ home: undefined }));
    expect(result.current.coordinatesLive).toBe(true);
    expect(result.current.coordinateNote).toBeNull();
  });
});

describe("useSettingsGate — one read, however many invocations", () => {
  it("reads once under StrictMode, which invokes the effect twice", async () => {
    read.mockReturnValue(Promise.resolve(ok(settings())));
    const props = seed();
    const { result } = renderHook(() => useSettingsGate(props), { wrapper: StrictMode });
    await act(async () => {});
    // A `live` flag alone cancels the first invocation and leaves the second
    // awaiting nothing, so the gate never opens. Holding the PROMISE is what
    // makes both invocations await one request.
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current.coordinatesLive).toBe(true);
  });

  it("does not re-read when an unrelated prop moves, and does when the URL does", async () => {
    read.mockReturnValue(Promise.resolve(ok(settings())));
    const rendered = renderHook((props: SettingsGateSeed) => useSettingsGate(props), {
      initialProps: seed(),
    });
    await act(async () => {});
    rendered.rerender(seed({ precision: "100" }));
    expect(read).toHaveBeenCalledTimes(1);
    rendered.rerender(seed({ settingsUrl: `${SETTINGS_URL}?v=2` }));
    await act(async () => {});
    expect(read, "memoised on the URL, and the URL changed").toHaveBeenCalledTimes(2);
  });
});

describe("useSettingsGate — what the precision control offers", () => {
  it("unions §7.6's own default into the grids rather than rounding it onto them", async () => {
    const { result } = await landed();
    expect(result.current.precisionOptions).toContain(500);
    expect(result.current.precisionOptions).toEqual(
      [...result.current.precisionOptions].sort((a, b) => a - b),
    );
    expect(
      result.current.precisionOptions.filter((m) => m === 500),
      "a default that equals a fixed grid must not appear twice",
    ).toHaveLength(1);
  });

  it("unions whatever the form is holding, so a restored value renders", async () => {
    const { result } = await landed({ precision: "250" });
    expect(result.current.precisionOptions).toContain(250);
  });

  it("offers the fixed grids before the answer lands, and never an unusable value", async () => {
    const { result } = held({ precision: "banana" });
    expect(result.current.precisionOptions.length).toBeGreaterThan(0);
    expect(result.current.precisionOptions.every((m) => Number.isInteger(m) && m > 0)).toBe(true);
  });
});

describe("useSettingsGate — `fuzzed` fails closed", () => {
  const TOKYO = { lat: 35.6938, long: 139.7034 };

  it("publishes nothing at all while the gate is only `checking`", async () => {
    const { result } = held({ precision: "500" });
    expect(result.current.fuzzed(TOKYO)).toBeUndefined();
  });

  it("publishes nothing for a precision the select cannot show", async () => {
    const { result } = await landed({ precision: "" });
    expect(result.current.fuzzed(TOKYO), "no grid held, so no coordinate").toBeUndefined();
  });

  it("snaps to the grid the form holds, and reports what was ACTUALLY done", async () => {
    const { result } = await landed({ precision: "500" });
    const geo = result.current.fuzzed(TOKYO);
    expect(geo).toBeDefined();
    expect(typeof geo?.lat, "back to numbers, which GeoPoint is typed in").toBe("number");
    expect(geo?.precisionMeters, "from the RESULT, never from the select").toBe(500);
    expect(geo?.lat).not.toBe(TOKYO.lat);
  });

  it("REMOVES the geometry for a point inside the home region (§9 step 2)", async () => {
    const { result } = await landed({ precision: "500" });
    expect(result.current.fuzzed({ lat: 45.4642, long: 9.19 })).toBeUndefined();
  });
});
