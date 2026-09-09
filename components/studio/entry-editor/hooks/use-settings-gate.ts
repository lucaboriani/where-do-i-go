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

/** WHAT THE SETTINGS READ (§7.6) LEFT BEHIND, in the three states the controls
 *  have to distinguish — a wait is not an answer:
 *  ./notes.md#the-three-states-the-controls-distinguish */
type SettingsGate =
  | { kind: "checking" }
  | { kind: "ready"; settings: PrivacySettings }
  | { kind: "closed"; detail: string };

/** §9, and it has to be SAID rather than silently lost — and this is the
 *  COMMON case, since a fresh deployment has no privacy.ttl at all:
 *  ./notes.md#the-note-has-to-be-said-out-loud */
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
  /** Whose `fetch` the read goes over — this one and never the ambient one:
   *  ./notes.md#the-read-is-memoised-on-the-url-and-never-ambient */
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
   * ON MOUNT, NOT AT SAVE TIME — the fail-closed posture. MEMOISED ON THE URL,
   * holding the PROMISE and not a flag, which is what survives StrictMode's
   * double invoke. `session.fetch`, NEVER THE AMBIENT ONE: §7.6 is owner-only.
   * ./notes.md#the-read-is-memoised-on-the-url-and-never-ambient
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
      /** ONE FACT IS NOT THE OTHER (§7.6, §9): unreadable settings close the
       *  controls, settings with no `home` do not. Collapsing them strips the pin
       *  from every home-less owner:
       *  ./notes.md#one-fact-is-not-the-other-unreadable-versus-no-home */
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

  /** The fixed grids, §7.6's own default and whatever the form holds. THE
   *  SETTINGS VALUE JOINS THE LIST; IT IS NOT MAPPED ONTO IT:
   *  ./notes.md#the-settings-value-joins-the-option-list */
  const precisionOptions = useMemo(() => {
    const grids = new Set<number>(PRECISION_GRIDS);
    if (gate.kind === "ready") grids.add(gate.settings.defaultPrecisionMeters);
    const held = gridOf(precision);
    if (held !== null) grids.add(held);
    return [...grids].sort((a, b) => a - b);
  }, [gate, precision]);

  /** What may be published for a point the owner typed, §9 steps 1–3 delegated
   *  whole. The TWO GUARDS in front are not redundant with it:
   *  ./notes.md#what-fuzzed-delegates-and-the-two-guards-in-front-of-it */
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
