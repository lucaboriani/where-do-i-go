/**
 * §7.6 read on mount, and everything the answer decides: whether the three
 * coordinate controls take input, what they offer, what they say when they are
 * dead, and what may be published for a point the owner typed.
 * ./notes.md#the-gate-is-read-on-mount-and-never-again
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { fuzzForPublication } from "@/lib/pod/fuzz";
import { readPrivacySettings } from "@/lib/pod/read";
import { describe } from "@/lib/pod/result";
import { PRECISION_GRIDS, gridOf } from "@/lib/studio/place/place";
import type { PrivacySettings } from "@/lib/pod/schema";
import type { EntryPlace } from "@/lib/studio/place/place";
import type { StudioSessionLike } from "@/lib/studio/session";

/**
 * WHAT THE SETTINGS READ (§7.6) LEFT BEHIND, in the three states the controls
 * have to distinguish. `checking` and `closed` both hold the controls, and they
 * are separate anyway: one is a wait and the other is an answer, and telling
 * the owner "your privacy settings could not be read" while the request is
 * still in flight is a lie that resolves itself.
 */
type SettingsGate =
  | { kind: "checking" }
  | { kind: "ready"; settings: PrivacySettings }
  | { kind: "closed"; detail: string };

/**
 * §9, and it has to be SAID: "an entry silently losing its map pin becomes a
 * bug report, whereas 'you have not set a home region yet' is a one-time setup
 * step with an obvious fix."
 *
 * This is the common case rather than the rare one. `initialiseContainers()`
 * creates `/travel/settings/` and deliberately writes no document into it, so
 * every fresh deployment reads a 404 here until the owner sets a home region.
 */
const NO_SETTINGS_NOTE =
  "This entry will be saved without a map pin: your privacy settings could not be read, so " +
  "there is no home region to check a coordinate against. Set a home region and a default " +
  "precision on your Pod, then reopen this editor.";

/** Deliberately shares no vocabulary with the sentence above — same rule as the
 *  clean-save message: while the answer is still outstanding the owner must not
 *  be told what it is. */
const CHECKING_NOTE = "Waiting for the rules that decide what may be published with an entry.";

/* ══════════════════════════════════════════════════════════════════ inputs ══ */

export interface SettingsGateSeed {
  /** `/travel/settings/privacy.ttl` (§7.6). See `EntryEditorProps.settingsUrl`
   *  for why it is a URL this component is GIVEN rather than one it derives. */
  settingsUrl: string;
  /** Whose `fetch` the read goes over. The effect's own docblock says why it
   *  must be this one and never the ambient one. */
  session: StudioSessionLike;
  /** What the precision select is currently holding, for the option list and
   *  for the grid `fuzzed` snaps to. */
  precision: string;
  /** The owner's own `dy:defaultPrecisionMeters`, handed over the moment the
   *  read lands and TAKEN VERBATIM rather than mapped onto the option list —
   *  see `precisionOptions`. **MUST BE STABLE ACROSS RENDERS**, or the read
   *  effect loops: ./notes.md#why-the-seed-is-built-outside-the-render-callback */
  onDefaultPrecision: (value: string) => void;
}

/** What the settings decided, in the terms the controls consume. `gate` itself
 *  does not escape: every question the form asks of it is answered here. */
export interface SettingsGateView {
  coordinatesLive: boolean;
  presetPrecision: string;
  coordinateNote: string | null;
  /** The failure as `describe()` renders it, deliberately outside the sentence
   *  above — a URL and a status code are not something to read aloud. */
  settingsDetail: string | null;
  precisionOptions: number[];
  fuzzed: (point: { lat: number; long: number }) => EntryPlace["geo"];
}

/* ═════════════════════════════════════════════════════════════════ the hook ══ */

export function useSettingsGate({
  settingsUrl,
  session,
  precision,
  onDefaultPrecision,
}: SettingsGateSeed): SettingsGateView {
  const [gate, setGate] = useState<SettingsGate>({ kind: "checking" });

  /* ─────────────────────────────────────────────── §7.6, read on mount ─── */

  /**
   * ON MOUNT, NOT AT SAVE TIME, and that is the fail-closed posture rather than
   * an optimisation. §9 makes every coordinate write conditional on this
   * document, so a form that took the input and refused it afterwards would
   * have accepted a coordinate it was never going to publish and said nothing
   * until the owner pressed Save. The controls are dead or live according to
   * the answer, which means the answer has to arrive first.
   *
   * MEMOISED ON THE URL, WHICH IS WHAT MAKES IT ONE READ. The App Router runs
   * the studio under StrictMode in development, so this effect is invoked
   * twice; a `live` flag alone would cancel the first invocation's promise and
   * a ref that merely said "already started" would leave the second with
   * nothing to await, so nothing would ever be set. Holding the PROMISE — the
   * shape components/studio/studio-shell/studio-shell.tsx uses for `enumerateTrips`, and
   * `restoreSession`'s for the same reason — makes both invocations await the
   * same request.
   *
   * `session.fetch`, NEVER THE AMBIENT ONE. §7.6 is owner-only: anonymously
   * this is a 401, and on ESS a 401 does not even distinguish private from
   * missing. Either way it lands in the `closed` branch, which is the right
   * answer to both.
   */
  const settingsRead = useRef<{
    url: string;
    result: ReturnType<typeof readPrivacySettings>;
  } | null>(null);
  useEffect(() => {
    if (settingsRead.current?.url !== settingsUrl) {
      settingsRead.current = {
        url: settingsUrl,
        result: readPrivacySettings(settingsUrl, { fetch: session.fetch }),
      };
    }
    let live = true;
    void settingsRead.current.result.then((result) => {
      if (!live) return;
      /**
       * ONE FACT IS NOT THE OTHER (§7.6, §9). A `Result` that is not ok is "the
       * settings could not be read" and closes the controls; settings that ARE
       * ok but carry no `home` are "I have no home to protect", which is a
       * legitimate configuration where every coordinate is still snapped and
       * none is ever dropped. Collapsing the second into the first strips the
       * pin from every entry of everyone who never set a home region, silently
       * and for ever, and `fuzzForPublication` cannot catch it because it never
       * gets asked.
       */
      if (!result.ok) {
        setGate({ kind: "closed", detail: describe(result.error) });
        return;
      }
      setGate({ kind: "ready", settings: result.value });
      // The owner's own default, taken VERBATIM rather than mapped onto the
      // option list — see the select below.
      onDefaultPrecision(String(result.value.defaultPrecisionMeters));
    });
    return () => {
      live = false;
    };
  }, [settingsUrl, session, onDefaultPrecision]);

  /** The three controls take input only against settings this app trusts.
   *  Everything else on the form is unaffected: an unreadable privacy.ttl costs
   *  the owner a map pin, not an editor. */
  const coordinatesLive = gate.kind === "ready";
  /** §7.6's `dy:defaultPrecisionMeters`, or `""` where there is none to be had.
   *  There is no built-in fallback, deliberately. */
  const presetPrecision = gate.kind === "ready" ? String(gate.settings.defaultPrecisionMeters) : "";

  /** Why the three controls are dead, or `null` when they are not. A note that
   *  outlived its condition would be a hold announced on every encounter with a
   *  control nothing is holding. */
  const coordinateNote =
    gate.kind === "ready" ? null : gate.kind === "checking" ? CHECKING_NOTE : NO_SETTINGS_NOTE;

  /**
   * What the precision control offers: the fixed grids, the owner's own default
   * from §7.6, and whatever the form is currently holding.
   *
   * **THE SETTINGS VALUE JOINS THE LIST; IT IS NOT MAPPED ONTO IT.** §7.6's own
   * fixture is 500 m, which is none of the fixed grids, and rounding it either
   * way is wrong in a way the wire cannot show: coarser publishes a pin further
   * from the truth than the owner asked for while `dy:precisionMeters` reports
   * the distance as deliberate, and finer is simply a leak. `Set` because a
   * default that happens to equal a fixed grid must not appear twice.
   *
   * The CURRENT value is in here too, so a draft restored from a build with a
   * different list still shows the number it is about to publish at. What the
   * control shows and what `fuzzForPublication` is given have to be the same
   * number (§9 step 3).
   */
  const precisionOptions = useMemo(() => {
    const grids = new Set<number>(PRECISION_GRIDS);
    if (gate.kind === "ready") grids.add(gate.settings.defaultPrecisionMeters);
    const held = gridOf(precision);
    if (held !== null) grids.add(held);
    return [...grids].sort((a, b) => a - b);
  }, [gate, precision]);

  /**
   * What may be published for a coordinate the owner typed, or `undefined` when
   * nothing may be. §9 steps 1–3, and the whole of the decision is delegated:
   * this function chooses no distance, checks no radius and rounds nothing.
   *
   * THE TWO GUARDS IN FRONT OF `fuzzForPublication` ARE NOT REDUNDANT WITH IT.
   * It is total and fails closed on settings that do not parse, but it cannot
   * see a gate that never opened — `checking` and `closed` have no settings to
   * hand it at all — and it treats an unusable explicit precision as a drop
   * rather than falling back to the default, which is the same answer these
   * reach more directly. Both are fail-closed, so the worst either can do is
   * publish nothing.
   *
   * BACK TO NUMBERS, WHICH `lib/pod/fuzz.ts` DELIBERATELY AVOIDED RETURNING.
   * Its strings exist so that a naive float snap cannot publish
   * `35.010000000000005`; the values coming back have already been through
   * `toFixed`, and `Number` → `String` round-trips a short decimal to the same
   * digits, which is what `decimalLexical` will spend on it. `GeoPoint` is
   * typed in numbers and both serialisers read it, so this is where the two
   * meet.
   */
  function fuzzed(point: { lat: number; long: number }): EntryPlace["geo"] {
    if (gate.kind !== "ready") return undefined;
    const grid = gridOf(precision);
    if (grid === null) return undefined;

    const result = fuzzForPublication(point, gate.settings, grid);
    if (result.kind === "drop") return undefined;
    return {
      lat: Number(result.lat),
      long: Number(result.long),
      // From the RESULT, never from the select. §9 step 3 wants
      // `dy:precisionMeters` to "match what was actually done", and the two
      // differ the moment anything upstream of here changes its mind.
      precisionMeters: result.precisionMeters,
    };
  }

  return {
    coordinatesLive,
    presetPrecision,
    coordinateNote,
    settingsDetail: gate.kind === "closed" ? gate.detail : null,
    precisionOptions,
    fuzzed,
  };
}
