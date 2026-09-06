"use client";

/**
 * The studio's entry editor: one form, and the §10 write sequence behind it.
 *
 * WHAT IT IS NOT ALLOWED TO DO, the same two rules the shell is held to and for
 * the same reasons:
 *
 *   1. It imports NO VALUE from @inrupt/solid-client-authn-browser. The session
 *      arrives as a prop, so every behaviour here is testable against a plain
 *      object, and the library stays inside the `ssr: false` boundary that
 *      components/studio/studio-client.tsx draws.
 *   2. It reads NO config and NO env var. OWNER_WEBID, SITE_URL, SITE_NAME and
 *      POD_ROOT are not `NEXT_PUBLIC_`, so `lib/config.ts` throws the moment it
 *      is reached in a browser. The trips it can write into arrive as props;
 *      the owner's WebID comes off the session.
 *
 * THE WRITE ITSELF LIVES IN `lib/pod/save-entry.ts`. This file assembles an
 * `Entry`, picks the precondition, and turns the `{ completed, failed,
 * recovery }` report into something a human can act on. It reimplements none of
 * the sequence — in particular it never PUTs anything itself, so every write it
 * causes carries a precondition (§10).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COORDINATE CONTROLS, AND THE ORDER OF EVENTS THAT MAKES THEM SAFE.
 *
 * §9: "the studio applies fuzzing before the write and discards the precise
 * original", because "resources are publicly readable … anyone can fetch the
 * raw triple". So the fuzz happens HERE, before the `Entry` below is built —
 * `saveEntry` never sees a precise coordinate, and nothing downstream could
 * catch one if it did, because by then the precise value exists only in this
 * component's state and in the input the owner is looking at.
 *
 * Until 2026-09-06 this file had no coordinate input at all and said so at
 * length: fuzzing did not exist under lib/, so a latitude field would have put
 * a true coordinate on a world-readable resource — a privacy invariant broken
 * rather than a feature missing, and unfixable after the fact. `lib/pod/fuzz.ts`
 * and `readPrivacySettings` now exist, and this is their caller.
 *
 * FOUR RULES, EACH OF WHICH IS A DIFFERENT WAY TO LEAK:
 *
 *   1. What reaches `place.geo` is the `FuzzResult`, never the form state.
 *   2. A `drop` means NO `geo` AT ALL — not a coarser one. §9 step 2 explains
 *      why at length: a hundred entries "fuzzed to 2 km" resolve to one cell
 *      whose centroid is the house, and each new entry sharpens it. The place
 *      name survives; it is the geometry that is absent, not the entry.
 *   3. It FAILS CLOSED. Settings that are absent, unreadable or schema-invalid
 *      leave the three controls dead with the reason on screen and associated,
 *      rather than live and refused at save time — `sameWebId`'s posture. Valid
 *      settings with NO home region are a different fact and stay live: §7.6
 *      calls that "I have no home to protect", and reading it as a failure
 *      would silently strip the pin from every entry of everyone who never set
 *      one.
 *   4. AN UNTOUCHED COORDINATE IS NOT RE-FUZZED. A stored pair was already
 *      snapped when it was written, and it is not necessarily on today's grid —
 *      `snapToPrecision(35.6938, 139.7034, 500)` is 35.69423/139.70348, not the
 *      §7.3 fixture's own pair — so re-snapping on every save walks the pin.
 *      Leave both boxes empty and the place travels through untouched, exactly
 *      as `created` and `datePublished` do.
 *
 * PHOTOS are phase 3 for the same reason they always were: they need the
 * resize/EXIF pipeline. A photo's GPS is a coordinate like any other and goes
 * through §9 steps 1–4, but there is no photo input to drive yet.
 * An entry being edited carries its existing photos through untouched.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PLAIN CONTROLS ON PURPOSE. TODO.md keeps layout deliberately unstyled until
 * phase 7, and native `<select>`, `<input>` and `<textarea>` need no Radix on a
 * screen with eleven controls on it. Every one of them has a real `<label>`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { documentUrlOf } from "@/lib/pod/entry-model";
import { fuzzForPublication } from "@/lib/pod/fuzz";
import { readPrivacySettings } from "@/lib/pod/read";
import { describe } from "@/lib/pod/result";
import { Status, TravelMode } from "@/lib/pod/schema";
import { saveEntry } from "@/lib/pod/save-entry";
import { clearDraft, readDraft, writeDraft } from "@/lib/studio/drafts";
import { revalidatePublicSite } from "@/lib/studio/revalidate";
import { SCHEMA_VERSION } from "@/lib/vocab";
import type { ReactNode } from "react";
import type {
  Entry,
  PrivacySettings,
  Status as EntryStatus,
  TravelMode as Mode,
} from "@/lib/pod/schema";
import type { SaveEntryReport } from "@/lib/pod/save-entry";
import type { Precondition } from "@/lib/pod/write";
import type { Draft, StorageLike } from "@/lib/studio/drafts";
import type { StudioSessionLike } from "@/lib/studio/session";

/* ═══════════════════════════════════════════════════════════════════ props ══ */

/** One trip the owner may write into, resolved by whoever knows where the Pod
 *  is. The container and index URLs are passed rather than derived here: this
 *  component reads no config, and §4's layout is the read layer's to know. */
export interface EditorTrip {
  /** `<…/trip.ttl#it>` — what `dy:trip` points at. */
  iri: string;
  slug: string;
  /** What the owner picks from the list. */
  name: string;
  /** `<…/entries.ttl>`, the trip's index resource (§7.4). */
  indexUrl: string;
  /** `<…/entries/>`, where the entry resource goes. */
  entriesContainer: string;
  /**
   * `dy:status` of the TRIP — not of the entry, which is the control below.
   *
   * Optional because a caller that knows only where a trip is can still offer
   * it, and because the whole point of the marker is to say something extra
   * about a draft rather than to withhold a trip nobody labelled.
   *
   * It is rendered, and that is why it is here. `listStudioTrips` carries it
   * for one stated reason — "a picker that shows a draft trip and a published
   * trip identically invites the one mistake that cannot be undone from the
   * editor: writing a PUBLISHED entry into a DRAFT trip yields a public entry
   * whose trip is not public". The marker is what makes that visible before the
   * click rather than after it.
   */
  status?: EntryStatus;
}

export interface EntryEditorProps {
  /** Injected, never constructed here. Its `fetch` is the only authenticated
   *  one in the browser, and every Pod request below goes through it. */
  session: StudioSessionLike;
  trips: EditorTrip[];
  /**
   * `/travel/settings/privacy.ttl` (§7.6), resolved by whoever knows where the
   * Pod is — `privacySettingsUrl(podRoot)` in lib/pod/read.ts. It joins
   * `indexUrl` and `entriesContainer` as a URL this component is GIVEN, because
   * this component reads no config: `POD_ROOT` is not `NEXT_PUBLIC_` and
   * `lib/config.ts` throws the moment it is reached in a browser.
   *
   * **REQUIRED, AND THAT IS THE POINT.** Optional would mean a shell that
   * forgot to pass it produced an editor that failed closed for ever — no error
   * anywhere, no test red anywhere, coordinates simply never published, which
   * is indistinguishable from a Pod with no `privacy.ttl` on it. Nothing
   * renders a wire nobody passed, so tsc is the only check that covers this
   * one.
   *
   * A URL rather than the parsed settings, because THE READ FAILING IS THE CASE
   * THAT MATTERS (§9's fail-closed rule) and only a URL can 404. It is read
   * over the session's own fetch: the resource is owner-only, so an anonymous
   * GET is a 401 on a real Pod — and on ESS a 401 does not even distinguish
   * private from missing (§13).
   */
  settingsUrl: string;
  /**
   * Absent means CREATE. Present means EDIT, and `etag` is the one from THE
   * READ THAT PRODUCED THIS STATE (§10) — `null` when the server sent none,
   * which is a state this editor refuses to save over rather than papering
   * over with a blind PUT.
   */
  initial?: { entry: Entry; etag: string | null };
  /**
   * Where in-progress text is kept between visits. Defaults to the browser's
   * own `localStorage`, which is what actually ships.
   *
   * Injected rather than reached for so that the failure that matters can be
   * scripted: Safari in private mode reports a zero quota and throws on the
   * first `setItem`, and no browser global can be made to do that on demand.
   */
  storage?: StorageLike;
}

/* ═════════════════════════════════════════════════════════════════ helpers ══ */

/**
 * Every human-readable literal is language-tagged (§6), and an entry being
 * edited keeps the tag it already had.
 *
 * A fixed default rather than a control: there is one owner writing one diary,
 * and a language picker is a feature to add when someone needs it. An UNtagged
 * literal is the thing §6 rules out, so a default is the honest minimum.
 */
const LANGUAGE = "en";

const pad = (n: number) => String(n).padStart(2, "0");

/** `<input type="datetime-local">` hands back exactly this, with the seconds
 *  optional and no offset at all. */
const LOCAL_DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/;
const TRAILING_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;

/** The UTC offset this machine is on at that wall-clock time, `+09:00`-shaped.
 *  Computed AT the instant in question so a summer date gets the summer offset. */
function offsetHere(wall: string): string {
  const at = new Date(wall);
  const minutes = Number.isNaN(at.getTime()) ? 0 : -at.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const size = Math.abs(minutes);
  return `${sign}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
}

/**
 * What the form holds → `xsd:dateTime` with an offset (§3, §6).
 *
 * THE WALL CLOCK IS COPIED, NOT RECOMPUTED. §7.3: `dy:occurredAt` "carries the
 * local UTC offset of the place", so "21:40+09:00" renders as half past nine in
 * the evening for every reader. Converting through a `Date` and back would
 * rewrite an entry edited from another time zone into that zone's offset — the
 * same instant, spelled as the wrong time of day, which for a travel diary is
 * most of the meaning. So only the OFFSET is supplied here, and on an edit it
 * is the one already stored.
 */
function toOffsetDateTime(local: string, storedOffset: string | undefined): string | undefined {
  const parts = LOCAL_DATETIME.exec(local);
  if (!parts) return undefined;
  const wall = `${parts[1]}T${parts[2]}${parts[3] ?? ":00"}`;
  return `${wall}${storedOffset ?? offsetHere(wall)}`;
}

/** The offset an already-stored timestamp carries. `Z` is a valid offset and
 *  means the same as `+00:00`; everything this app writes uses the latter. */
function offsetOf(value: string | undefined): string | undefined {
  const found = value === undefined ? null : TRAILING_OFFSET.exec(value);
  if (found === null) return undefined;
  return found[1] === "Z" ? "+00:00" : found[1];
}

/** `2026-03-29T21:40:00+09:00` → `2026-03-29T21:40`, which is what the control
 *  accepts. The wall clock is shown as stored, never shifted into this
 *  machine's zone — see toOffsetDateTime. */
const wallClockOf = (value: string | undefined) => (value === undefined ? "" : value.slice(0, 16));

/**
 * Now, with this machine's offset — the one instant a save is stamped with:
 * `dcterms:created` on a create, `schema:datePublished` on a first publication,
 * and, through `saveEntry`'s `now`, `dcterms:modified` on the entry and its
 * index row.
 *
 * These are moments in the owner's life rather than in the trip's, so unlike
 * `dy:occurredAt` they take the offset of wherever the owner is sitting.
 */
function nowWithOffset(): string {
  const at = new Date();
  const wall =
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
  return `${wall}${offsetHere(wall)}`;
}

/** `dy:tag` is a token, not prose (§3): comma-separated in, trimmed, untagged. */
const parseTags = (text: string) =>
  text
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");

/** §11 guardrail 7: an entry's `dy:slug` is its filename. Encoded for the
 *  reason lib/pod/read.ts's URL builders are — an unencoded `#` or `?` in a
 *  slug silently addresses a different resource. */
function entryUrlIn(trip: EditorTrip, slug: string): string {
  const container = trip.entriesContainer.endsWith("/")
    ? trip.entriesContainer
    : `${trip.entriesContainer}/`;
  return `${container}${encodeURIComponent(slug)}.ttl`;
}

/* ═════════════════════════════════════════════════════════ the coordinate ══ */

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
 * The grids offered besides the owner's own default.
 *
 * **NO "EXACT" OPTION, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT.**
 * `fuzzForPublication` is the total boundary §9 asks for: it is the one place
 * that checks the home region, and it has no exact mode — `snapToPrecision`
 * refuses anything that is not a positive integer of metres. An "exact" option
 * could therefore only be implemented by going AROUND that function, and going
 * around it goes around the home-region drop as well. The one entry an owner is
 * most likely to mark "exact" is the one taken at home.
 *
 * Coarser than the owner's default is always available; finer is only ever
 * their own setting.
 */
const PRECISION_GRIDS = [100, 1000, 10_000] as const;

/** The value of the precision control, in metres, or `null` when it holds
 *  nothing a grid can be built from. `xsd:integer`, so a fractional metre is
 *  refused here rather than rounded on the owner's behalf (§6). */
function gridOf(text: string): number | null {
  if (text.trim() === "") return null;
  const metres = Number(text);
  return Number.isInteger(metres) && metres > 0 ? metres : null;
}

/** `500` → `~500 m`, `10000` → `~10 km`. The tilde is the honest part: what is
 *  published is a cell of about this size, not a distance from anywhere. */
function precisionLabel(metres: number): string {
  return metres >= 1000 && metres % 100 === 0 ? `~${metres / 1000} km` : `~${metres} m`;
}

/**
 * THE ONE END OF THE ASSOCIATION BETWEEN THE DEAD COORDINATE CONTROLS AND THE
 * SENTENCE SAYING WHY, for the reason `HOLD_REASON_ID` below is a constant: an
 * `aria-describedby` naming an id nothing renders computes to the empty string,
 * with no error and nothing on screen to show for it, and the control is back
 * to announcing itself as unavailable and no reason.
 *
 * It goes on each of the three controls and NOT on a fieldset around them. That
 * spelling reads better and is heard by nobody — a `<legend>` names a group and
 * nothing propagates a group's DESCRIPTION to its members. Measured for the
 * Save button's own hold, forty lines further down this file.
 */
const COORDINATE_NOTE_ID = "entry-coordinate-note";

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

/** Everything `Place` holds. `lib/pod/schema.ts` exports the Zod object but no
 *  type for it, and this file imports no Zod. */
type EntryPlace = NonNullable<Entry["place"]>;

/**
 * The place to write, given whatever the entry already had and whatever the
 * fuzz allowed.
 *
 * A DROP IS A REMOVAL, NOT AN OMISSION, which is the half that is easy to miss
 * on an EDIT: the entry being edited may already carry a `#geo`, and spreading
 * the old place in and merely failing to add a new one leaves the previous
 * coordinate on a world-readable resource — a leak that outlives the edit made
 * to remove it.
 *
 * A place with nothing left in it is no place at all rather than an empty
 * `<#place>` node, which would be a `schema:Place` asserting nothing.
 */
function placeFor(existing: EntryPlace | undefined, geo: EntryPlace["geo"]): EntryPlace | undefined {
  if (geo !== undefined) return { ...existing, geo };
  if (existing === undefined) return undefined;
  // Copy-and-delete rather than naming the other fields: a `Place` that grows
  // one must not lose it every time a coordinate is dropped.
  const rest: EntryPlace = { ...existing };
  delete rest.geo;
  return Object.values(rest).some((value) => value !== undefined) ? rest : undefined;
}

/* ══════════════════════════════════════════════════ what the owner is told ══ */

/**
 * The result of a save, in the two roles that ANNOUNCE it: `status` for news,
 * `alert` for something needing a decision. Text dropped into a plain <div> is
 * text a screen-reader user never hears, and the result of a save arrives long
 * after focus has moved on.
 */
type Announcement = { tone: "ok" | "problem"; text: string; detail?: string };

/**
 * SIX OUTCOMES, SIX THINGS TO SAY — keyed on WHICH STEP FAILED, never on
 * `recovery` alone.
 *
 * `recovery` has four values and §10 has six outcomes, so two pairs collide:
 * a refused write and a failed revalidation are both "retry" — and are opposite
 * situations, nothing written versus everything written — while an unverified
 * ACL and a refused index are both "rebuildIndex" but differ in whether the
 * entry is readable at all. Collapsing either pair sends the owner to the wrong
 * recovery: retyping work that is already on the Pod, or waiting out a cache
 * that will never refresh.
 *
 * So the message says what completed and what did not, and `describe(error)`
 * carries the technical detail underneath rather than into the sentence.
 */
function announce(report: SaveEntryReport, status: EntryStatus): Announcement {
  const failure = report.failed;

  /**
   * A clean save says nothing about the public site, the cache or what a
   * visitor might see — deliberately, and it is not a wording preference.
   *
   * The only difference between this outcome and a failed revalidation is
   * whether the reader is warned about staleness, so the two messages must not
   * share that vocabulary or the warning stops carrying information. Measured:
   * with "and the public site has been refreshed" here, a hook that checked
   * `res.ok` and never read the body — the exact bug §10 step 4 and the route's
   * own docblock warn about — passed the test that exists to catch it, because
   * the success message it wrongly produced still mentioned the public site.
   */
  if (failure === undefined) {
    return {
      tone: "ok",
      text:
        status === "published"
          ? "Saved and published. The entry is on your Pod, listed on its trip, and the pages that show it have been refreshed."
          : "Saved as a draft. The entry is on your Pod, readable only by you, and no row for it appears in the trip's index.",
    };
  }

  const detail = describe(failure.error);

  switch (failure.step) {
    /**
     * Nothing reached the Pod, so nothing there changed. A 412 is its own
     * sentence: the resource is not what this edit started from, and "try
     * again" is wrong advice — the identical request fails identically.
     */
    case "entry":
      return report.recovery === "refetch"
        ? {
            tone: "problem",
            text:
              "Refused: what is on your Pod at this address is no longer what you started from — " +
              "it changed elsewhere, or in another tab. Reload the entry to see the newer version, " +
              "then apply your change to that. Nothing on your Pod was overwritten, and everything " +
              "you typed is still on this screen.",
            detail,
          }
        : {
            tone: "problem",
            text:
              "The entry did not reach your Pod, and nothing there changed. Everything you typed is " +
              "still on this screen — try again.",
            detail,
          };

    /**
     * §10's published-but-unreadable. The entry IS on the Pod; what could not
     * be confirmed is who may read it, and the index was deliberately left
     * alone rather than advertising a link the public may not be able to
     * follow.
     */
    case "access":
      return {
        tone: "problem",
        text:
          "The entry is on your Pod, but its access could not be confirmed: visitors may not be able " +
          "to read it, so it has not been added to its trip either. Rebuild this trip's index to " +
          "settle both.",
        detail,
      };

    /**
     * §10's "invisible, not corrupt". The wording matters more here than
     * anywhere else on this screen: an owner who reads this as "your work went
     * nowhere" retypes an entry that is already on the Pod, and the retype
     * either collides on the precondition or overwrites the copy that is there.
     */
    case "index":
      return {
        tone: "problem",
        text:
          "The entry is saved on your Pod with the right access, but its trip's index could not be " +
          "updated, so it will not appear in the trip listing yet. Rebuild this trip's index to " +
          "list it.",
        detail,
      };

    /**
     * Everything on the Pod is consistent and only this app's cache is behind —
     * which heals on its own when the 15-minute timer rolls. The same
     * `recovery` value as a refused write, and the opposite situation.
     */
    case "revalidate":
      return {
        tone: "problem",
        text:
          "The entry is saved on your Pod and listed on its trip. Only the public site's cache could " +
          "not be cleared, so visitors may see the previous version for a few minutes.",
        detail,
      };
  }
}

/* ══════════════════════════════════════════════════════════════════ target ══ */

/**
 * Where the entry lives once it exists, and the ETag of the state we hold.
 *
 * `null` means this editor has not written it and was not handed one, i.e. a
 * create. An `etag` of `null` on an existing resource is the awkward case
 * `SaveEntryReport.etag` documents: "the write happened, but the next update
 * has nothing to condition on and must re-read rather than invent one."
 */
type Target = { url: string; etag: string | null };

/**
 * The precondition for the next write, or `null` when there is none to be had.
 *
 * `If-None-Match: *` creates; `If-Match: <etag>` updates. There is no third
 * option, and both wrong answers here are silent: reusing `{ create: true }`
 * after a create is a guaranteed 412 on a resource this editor just wrote, and
 * reusing the ETag from before the last write is a 412 the owner cannot act on
 * because the retry they try next fails identically. A blind PUT is a bug (§10).
 */
function preconditionFor(target: Target | null): Precondition | null {
  if (target === null) return { create: true };
  return target.etag === null ? null : { etag: target.etag };
}

/* ═══════════════════════════════════════════════════════════ the local draft ══ */

/**
 * How long after the last change the editor waits before keeping a local copy.
 *
 * A DEBOUNCE, NOT AN INTERVAL: each change restarts the window, so a minute of
 * typing is one write rather than seventy. Exported because the studio is what
 * ships this number and a value that lives only inside the closure is one nobody
 * can change on purpose — test/entry-editor.test.tsx drives the window and pins
 * it against this export so the two cannot drift.
 */
export const DRAFT_DEBOUNCE_MS = 800;

/** The scope of a create (`lib/studio/drafts.ts`): there is no resource yet to
 *  name, so every create in this browser shares one draft. */
const NEW_DRAFT_SCOPE = "new";

/** The eleven fields the FORM holds — `Draft` minus the stamp, which is put on
 *  at the moment of the write and never earlier (§6). */
type DraftText = Omit<Draft, "savedAt">;

/**
 * Have the eleven fields moved between two snapshots?
 *
 * Field by field rather than `JSON.stringify`, which would answer "different"
 * for the same eleven values in a different key order. The consequence of a
 * false "different" is not cosmetic: it is a local copy written back for text
 * the Pod already holds, which is exactly the resurrected draft the clear after
 * a save exists to prevent.
 *
 * The three coordinate fields are in here for the same reason the other eight
 * are: they are what the form holds. A comparison that skipped them would call
 * a form whose only change was the latitude "unchanged" and drop that change
 * from the local copy — the one field on this screen nobody can retype from
 * memory a day later.
 */
const sameText = (a: DraftText, b: DraftText) =>
  a.tripIri === b.tripIri &&
  a.slug === b.slug &&
  a.headline === b.headline &&
  a.story === b.story &&
  a.occurred === b.occurred &&
  a.tagsText === b.tagsText &&
  a.mode === b.mode &&
  a.status === b.status &&
  a.lat === b.lat &&
  a.long === b.long &&
  a.precision === b.precision;

/**
 * The browser's own storage, or `null` where there is none to be had.
 *
 * WRAPPED, BECAUSE THE ACCESS ITSELF CAN THROW — not the call, the property
 * read. Some embedded browsers and some third-party-storage settings raise a
 * SecurityError on `localStorage` before any method is reached, and an editor
 * that fell over on that would be an editor the owner cannot open at all. `null`
 * simply means no local copy is kept; nothing else about the form changes.
 */
function browserStorage(): StorageLike | null {
  try {
    // `?? null` is not belt and braces: outside a browser there is no
    // `localStorage` at all — node has one only behind a flag — so this is
    // `undefined` rather than absent, and `undefined` would sail past every
    // `=== null` guard below and be called as if it were a storage.
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * `2026-04-02T19:00:00+09:00` → `2026-04-02 at 19:00`.
 *
 * The wall clock AS IT WAS STAMPED, never shifted into whatever zone the browser
 * is in now — the same rule `wallClockOf` follows and for the same reason. The
 * machine-readable instant is on the `<time dateTime>` beside it, offset and
 * all, which is what the offset requirement on `savedAt` exists for.
 */
const savedAtText = (savedAt: string) => `${savedAt.slice(0, 10)} at ${savedAt.slice(11, 16)}`;

/**
 * THE ONE END OF THE ASSOCIATION BETWEEN THE HELD SAVE BUTTON AND THE SENTENCE
 * THAT EXPLAINS THE HOLD, spelled once because both ends have to agree and
 * neither of them says so when they stop agreeing.
 *
 * An `aria-describedby` naming an id nothing renders computes to the empty
 * string — no error, no warning, nothing on screen different, and a screen
 * reader back to announcing "Save entry, button, unavailable" and no reason.
 * That is the silent way this breaks, so the id is a constant rather than two
 * string literals thirty lines apart.
 */
const HOLD_REASON_ID = "entry-draft-hold";

/* ════════════════════════════════════════════════════════════════ the form ══ */

export default function EntryEditor({
  session,
  trips,
  settingsUrl,
  initial,
  storage,
}: EntryEditorProps) {
  const existing = initial?.entry;

  const [tripIri, setTripIri] = useState(() =>
    existing?.trip !== undefined && trips.some((t) => t.iri === existing.trip) ? existing.trip : "",
  );
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [headline, setHeadline] = useState(existing?.headline.value ?? "");
  const [story, setStory] = useState(existing?.articleBody?.value ?? "");
  const [occurred, setOccurred] = useState(() => wallClockOf(existing?.occurredAt));
  const [tagsText, setTagsText] = useState(existing?.tags.join(", ") ?? "");
  const [mode, setMode] = useState<Mode | "">(existing?.travelModeFrom ?? "");
  const [status, setStatus] = useState<EntryStatus>(existing?.status ?? "draft");
  /**
   * THE COORDINATE, AS TYPED — and EMPTY on an edit, even for an entry that
   * already has one.
   *
   * Prefilling from `existing.place.geo` is the obvious spelling and is the
   * bug. What is stored there is the PUBLISHED pair, already snapped, and not
   * necessarily on the grid the settings name today: putting it in the box
   * makes it indistinguishable from something the owner typed, so every save
   * re-snaps it and the pin walks. Measured on the §7.3 fixture —
   * `snapToPrecision(35.6938, 139.7034, 500)` is 35.69423/139.70348, half a
   * cell from where it started.
   *
   * Empty therefore means "leave the coordinate alone", which is the same
   * treatment `created` and `datePublished` get and is said on the control's
   * own hint. Typing means "replace it", and typing something inside the home
   * region means "remove it" — see `save()`.
   */
  const [lat, setLat] = useState("");
  const [long, setLong] = useState("");
  /**
   * The grid in metres, as the select's value. `""` until §7.6 answers, which
   * is also the state the control keeps for ever when it cannot be read: there
   * is deliberately no built-in default, because "a fallback is a distance this
   * project would be choosing for someone else's front door".
   */
  const [precision, setPrecision] = useState("");

  const [target, setTarget] = useState<Target | null>(
    initial === undefined ? null : { url: documentUrlOf(initial.entry.iri), etag: initial.etag },
  );
  /**
   * THE TWO TIMESTAMPS THAT MUST NOT MOVE, held here because after the first
   * save this component is the only thing that knows them.
   *
   * `saveEntry` sets `created` on a create and carries forward whatever the
   * caller supplies — but on the SECOND save of an entry this editor just
   * created, the caller is this form, `initial` is still absent, and a form
   * that supplies neither leaves `created` undefined on an update. The
   * serialiser then omits the triple and the first save's value is gone: §7.3's
   * distinction between "when the record came into being" and "when it became
   * public" destroyed on the second click, silently and permanently.
   * `datePublished` is the same bug in the other direction — recomputed from
   * the clock, it would creep forward on every save.
   *
   * Measured with a throwaway probe before this state existed: the second PUT
   * carried no `dcterms:created` at all.
   */
  const [provenance, setProvenance] = useState<{ created?: string; datePublished?: string }>({
    created: existing?.created,
    datePublished: existing?.datePublished,
  });
  const [outcome, setOutcome] = useState<Announcement | null>(null);
  const [saving, setSaving] = useState(false);
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
   * shape components/studio/studio-shell.tsx uses for `enumerateTrips`, and
   * `restoreSession`'s for the same reason — makes both invocations await the
   * same request.
   *
   * `session.fetch`, NEVER THE AMBIENT ONE. §7.6 is owner-only: anonymously
   * this is a 401, and on ESS a 401 does not even distinguish private from
   * missing. Either way it lands in the `closed` branch, which is the right
   * answer to both.
   */
  const settingsRead = useRef<{ url: string; result: ReturnType<typeof readPrivacySettings> } | null>(
    null,
  );
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
      setPrecision(String(result.value.defaultPrecisionMeters));
    });
    return () => {
      live = false;
    };
  }, [settingsUrl, session]);

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
   * The ids one coordinate control describes itself by: its own hint, if it has
   * one, and the note above while there is one.
   *
   * Built rather than written out because BOTH HALVES ARE SILENT WHEN WRONG. An
   * id that names nothing computes to the empty string, and an attribute left
   * on permanently reads as correct markup while announcing a reason that has
   * stopped being true. `undefined` rather than `""` for the same reason: no
   * attribute at all is the honest spelling of "nothing to say".
   */
  const coordinateHelp = (ownHintId?: string): string | undefined => {
    const ids = [ownHintId, coordinateNote === null ? undefined : COORDINATE_NOTE_ID].filter(
      (id): id is string => id !== undefined,
    );
    return ids.length === 0 ? undefined : ids.join(" ");
  };

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

  /** The offset the stored timestamp carries, kept across the edit. See
   *  toOffsetDateTime for why it is not recomputed from this machine. */
  const storedOffset = offsetOf(existing?.occurredAt);
  const trip = trips.find((t) => t.iri === tripIri);
  /** The address is fixed once the resource exists: this editor writes, and
   *  moving a resource is a copy and a delete it does not do. */
  const addressFixed = target !== null;

  /* ────────────────────────────────────────────────────── the local draft ── */

  /** Off the session and nowhere else, exactly like `dcterms:creator`. Absent
   *  means nobody is signed in, and nobody's draft is anybody's. */
  const webId = session.info.webId;
  /**
   * WHICH draft this editor owns: the shared create key until a resource
   * exists, and the entry's own document URL from the moment one does.
   *
   * DERIVED FROM `target`, WHICH IS THE THING THAT MOVES — and this comment
   * used to argue the exact opposite, so it is worth saying plainly why that
   * was wrong. It claimed that keying on `target` "would clear a key nothing
   * was ever stored under and leave the real draft behind". On an EDIT that is
   * false: `target.url` starts life as `documentUrlOf(initial.entry.iri)`,
   * which is the expression this line used to be, so the two derivations agree
   * — everywhere except in one place.
   *
   * That one place was the defect. `target` is set the moment §10 step 1
   * completes; with the scope left on `new`, everything typed after a
   * successful create was autosaved under the CREATE key while carrying the
   * created entry's slug. Close the tab, open a fresh create form tomorrow,
   * Restore, Save — `If-None-Match: *` against a URL that now exists, a 412,
   * and the owner is told the entry "changed elsewhere, or in another tab",
   * which is not what happened and is not something they can act on.
   *
   * What the old comment was right about is that the SAVE must clear the key it
   * had been WRITING under rather than the one it is moving to. That is
   * `settleDraft`'s job, and it is spelled out there.
   */
  const scope = target === null ? NEW_DRAFT_SCOPE : target.url;
  const store = useMemo(() => storage ?? browserStorage(), [storage]);

  /** A stored draft the owner has not yet accepted or thrown away. The form is
   *  untouched while this is up — restoring on mount would silently overwrite
   *  whatever they opened the editor with. */
  const [offered, setOffered] = useState<Draft | null>(null);
  const [storageRefused, setStorageRefused] = useState(false);
  /**
   * HAS ANYBODY ACTUALLY TYPED? A ref, not state: it changes nothing on screen
   * and re-rendering for it would be noise.
   *
   * The effect below is keyed on the form values, so it fires once on mount —
   * and without this guard the editor would store a copy of whatever it opened
   * with. Opening an entry to read it and navigating away would then leave an
   * "Unsaved draft" banner waiting next time, offering to restore exactly what
   * is already on the Pod; once that banner appears for entries nobody edited it
   * stops meaning anything and gets clicked away by reflex.
   */
  const touched = useRef(false);
  /** The debounce in flight, held so a save can cancel it — and so the unmount
   *  below can tell a window that never fired from one that did. See
   *  `settleDraft`. */
  const pendingWrite = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * ONE LOOK PER EDITOR, and the ref is what makes it one.
   *
   * The effect below is a snapshot, not a subscription: it asks storage what was
   * left behind, offers it, and never asks again. Without this guard the effect
   * would run again whenever its dependencies changed identity — a caller that
   * builds `storage={{ getItem… }}` inline gets a fresh object on every render —
   * and each run would re-offer a banner the owner had just discarded, which
   * from the owner's side is a dismissal that does not work.
   *
   * It is also what keeps the read out of StrictMode's second invocation.
   */
  const draftRead = useRef(false);

  /**
   * THE FORM AS IT IS RIGHT NOW, for the two paths that have to read it from
   * OUTSIDE a render: the unmount flush below, and the save's check for text
   * typed while the Pod was answering.
   *
   * Both of those run after later renders have happened, and a closure made
   * during a render holds that render's values for ever — which is precisely
   * the bug in each case: "flush whatever was on the form when the editor
   * mounted", and "assume the form still equals what was sent".
   *
   * Refreshed in an effect with NO dependency array, which is how "after every
   * render" is spelled. Writing to a ref during the render itself is the thing
   * that is not allowed; writing to one in an effect is ordinary.
   */
  const text: DraftText = {
    tripIri,
    slug,
    headline,
    story,
    occurred,
    tagsText,
    mode,
    status,
    lat,
    long,
    precision,
  };
  const live = useRef({ store, webId, scope, text });
  useEffect(() => {
    live.current = { store, webId, scope, text };
  });

  /**
   * ON MOUNT, IN AN EFFECT, NEVER DURING RENDER. Storage is a browser thing and
   * reading it while rendering would make this component's output depend on
   * something React cannot see. `readDraft` answers `null` for everything
   * unusable rather than throwing, so a value truncated by a tab killed
   * mid-write cannot stop the editor from opening.
   *
   * A ONE-SHOT READ IS NOT A SUBSCRIPTION, which is why this is not
   * `useSyncExternalStore` — the shape react-hooks/set-state-in-effect points at
   * for external data. Its `getSnapshot` is re-read on every render, so the
   * banner would reappear the instant the autosave below wrote, offering to
   * restore the very text the owner is in the middle of typing. What is wanted
   * is the draft AS IT WAS WHEN THE EDITOR OPENED, held until the owner answers
   * it, and that is state.
   */
  useEffect(() => {
    if (store === null || webId === undefined || draftRead.current) return;
    draftRead.current = true;
    setOffered(readDraft(store, { webId, scope }));
  }, [store, webId, scope]);

  /**
   * THE AUTOSAVE. Keyed on the form values, so every change restarts the window
   * and the typing coalesces into one write.
   *
   * What goes in is the twelve fields of `Draft` and nothing else. The ETag, the
   * `dcterms:created` and the `schema:datePublished` this component is holding
   * right now are deliberately absent: they come from the read that produced
   * this state (§10), a draft outlives that read by however long the browser was
   * closed, and `lib/studio/drafts.ts` strips them even if they are handed in.
   */
  useEffect(() => {
    if (store === null || webId === undefined) return;
    if (!touched.current) return;

    const handle = setTimeout(() => {
      pendingWrite.current = null;
      const kept = writeDraft(
        store,
        { webId, scope },
        // The caller stamps the moment; the store holds no clock, so this is the
        // same spelling every other timestamp in this file gets (§6).
        {
          tripIri,
          slug,
          headline,
          story,
          occurred,
          tagsText,
          mode,
          status,
          lat,
          long,
          precision,
          savedAt: nowWithOffset(),
        },
      );
      /**
       * IT KEEPS TRYING ON LATER WINDOWS, and that is deliberate rather than an
       * oversight. A quota condition can clear — a tab closed, a cache evicted —
       * and switching the backup off for the rest of the session because one
       * write failed is worse than a cheap throw every 800ms. The note below
       * appears once and stays; the attempts continue.
       */
      if (!kept) setStorageRefused(true);
    }, DRAFT_DEBOUNCE_MS);

    pendingWrite.current = handle;
    /**
     * THE TIMER IS CANCELLED HERE; THE REF IS NOT CLEARED HERE, AND THAT
     * ASYMMETRY IS WHAT THE UNMOUNT FLUSH BELOW READS.
     *
     * React runs this cleanup on every dependency change — every keystroke —
     * and the body re-arms immediately afterwards, so a stale handle in the ref
     * lives for the width of one re-render and is then overwritten. On an
     * UNMOUNT the body does not re-run, and a ref that is still non-null means
     * exactly one thing: a window was scheduled and never fired. Nulling it
     * here would erase that distinction, and the flush would have nothing left
     * to test — an unmount would look identical whether the last window had
     * fired or not.
     *
     * `pendingWrite.current = null` therefore belongs to the two places where a
     * window genuinely stops being outstanding: the timer firing, and
     * `settleDraft` cancelling it after the Pod took the text.
     */
    return () => {
      clearTimeout(handle);
    };
  }, [
    store,
    webId,
    scope,
    tripIri,
    slug,
    headline,
    story,
    occurred,
    tagsText,
    mode,
    status,
    lat,
    long,
    precision,
  ]);

  /**
   * AN UNMOUNT IS NOT A REASON TO THROW THE LAST 800ms AWAY.
   *
   * Routine rather than exotic: components/studio/studio-shell.tsx flips
   * `view.status` when the Solid session expires and stops rendering the
   * editor, so an expiring token would otherwise take the sentence in progress
   * with it — the loss `docs/decisions.md` §10 names as the whole reason this
   * feature exists.
   *
   * WHY NOT IN THE EFFECT ABOVE'S CLEANUP, which is where it looks as though it
   * belongs: React runs that cleanup on every dependency change, and the
   * dependencies are the form's own fields. Flushing there would write once per
   * keystroke — the debounce deleted, and the autosave turned into the thing it
   * was deliberately written not to be.
   *
   * `[]`, so this cleanup runs only when the component really goes away, and it
   * reads `live.current` rather than its own closure, which is from the first
   * render and knows nothing that has been typed since.
   *
   * DELIBERATELY NOT `pagehide`/`visibilitychange`. Closing a tab does not
   * unmount a React tree, so that half stays open by decision: a tab close
   * costs at most one window of typing, and a listener that fires on every tab
   * switch is a different feature with different failure modes.
   *
   * IT SETS NO STATE. `writeDraft` can report a refusal and there is nowhere
   * left to show it — the component is being destroyed and its `role="note"`
   * line with it. What that line says is that the Pod save is unaffected, which
   * remains true.
   */
  useEffect(() => {
    return () => {
      const at = live.current;
      if (at.store === null || at.webId === undefined) return;
      /**
       * Nothing outstanding: the last window either fired or was cancelled by a
       * save that succeeded. Writing here would resurrect a draft the Pod has
       * already made redundant — the trap `settleDraft` exists to avoid.
       */
      if (pendingWrite.current === null) return;
      // Belt and braces: the cleanup above may or may not have run first, and
      // `clearTimeout` on a handle already cleared is a no-op either way.
      clearTimeout(pendingWrite.current);
      pendingWrite.current = null;
      writeDraft(
        at.store,
        { webId: at.webId, scope: at.scope },
        { ...at.text, savedAt: nowWithOffset() },
      );
    };
  }, []);

  /**
   * THE MOMENT THE POD HOLDS THE TEXT, the local copy stops being a backup and
   * becomes a trap: it is now older than the resource, and restoring it later
   * silently reverts an entry that was saved correctly.
   *
   * THE PENDING WINDOW IS CANCELLED FIRST, and that ordering is the whole point
   * of holding the timer in a ref. A save typically finishes well inside 800ms,
   * so a debounce left running would fire just after this clear and write the
   * draft straight back — a draft resurrected from a timer, under the key the
   * next mount reads, offering to restore text the Pod already has.
   *
   * `scope` HERE IS THE KEY THIS EDITOR HAS BEEN WRITING UNDER, NOT THE ONE IT
   * IS ABOUT TO OWN, and on a create those differ. This runs inside the save,
   * so `scope` is the value the render that started the save closed over —
   * `new` — while `nextScope` is where the entry now lives. Clearing
   * `nextScope` instead would remove a key nothing was ever stored under and
   * strand the create's draft under `new` for ever, which is the offer a fresh
   * create form would then get tomorrow.
   *
   * AND WHAT WAS TYPED WHILE THE POD WAS ANSWERING SURVIVES. `save()` snapshots
   * the form before it awaits, so `sent` is what actually reached the Pod;
   * anything typed during the round trip is in neither the Pod nor — once this
   * clear lands — storage, and with `touched` reset nothing would be armed
   * again until the next keystroke. Close the tab on that sentence and it never
   * existed. So when the form has moved on, it is re-kept at once, under the
   * key this editor owns from here on.
   */
  function settleDraft(sent: DraftText, nextScope: string) {
    if (store === null || webId === undefined) return;
    if (pendingWrite.current !== null) {
      clearTimeout(pendingWrite.current);
      pendingWrite.current = null;
    }
    clearDraft(store, { webId, scope });
    setOffered(null);

    const typed = live.current.text;
    if (sameText(typed, sent)) {
      // The Pod holds exactly what is on the screen. Nothing to back up until
      // the owner types again.
      touched.current = false;
      return;
    }

    // Still dirty, so the next keystroke must restart a window rather than be
    // the first thing that arms one.
    touched.current = true;
    const kept = writeDraft(
      store,
      { webId, scope: nextScope },
      { ...typed, savedAt: nowWithOffset() },
    );
    // Same reasoning as the debounced write: the note appears once, and the
    // attempts behind it continue.
    if (!kept) setStorageRefused(true);
  }

  /**
   * The owner accepting the draft. It fills the fields that are TEXT and stops
   * there: `target`, `provenance` and the ETag are untouched, because a restored
   * draft must not resurrect a precondition. What conditions the next write is
   * still the ETag from the read that produced this state (§10).
   */
  function restore(draft: Draft) {
    /**
     * ON AN EDIT, THE TRIP AND THE SLUG ARE NOT TEXT — they are where the
     * resource LIVES. §11 guardrail 7 makes `dy:slug` the filename, both
     * controls are disabled for that reason, and a restore that wrote through
     * them would put the form's idea of the address out of step with the
     * resource it is about to PUT.
     */
    if (!addressFixed) {
      // Mirrors the initial state: a trip that is no longer on offer leaves the
      // picker unchosen rather than setting a value the control cannot show.
      setTripIri(trips.some((choice) => choice.iri === draft.tripIri) ? draft.tripIri : "");
      setSlug(draft.slug);
    }
    setHeadline(draft.headline);
    setStory(draft.story);
    setOccurred(draft.occurred);
    setTagsText(draft.tagsText);
    setMode(draft.mode);
    setStatus(draft.status);
    /**
     * The coordinate goes back AS IT WAS TYPED, which is what was kept — see
     * the note on `Draft.lat` in lib/studio/drafts.ts. It is put through the
     * fuzz on the save that follows, exactly as if it had just been typed: a
     * value that reached the Pod by way of `localStorage` without passing the
     * boundary would be the same leak by a longer route.
     */
    setLat(draft.lat);
    setLong(draft.long);
    /**
     * WHAT THE CONTROL SHOWS HAS TO BE WHAT IS APPLIED (§9 step 3), so a
     * precision the select cannot show is refused rather than restored. Two
     * ways to get one: a draft kept while the settings were unreadable, which
     * holds `""`, and a draft from a build whose option list has moved on.
     * Restoring either would leave the number the owner can see and the number
     * `fuzzForPublication` is given disagreeing, which is the shape §9 calls a
     * lie in whichever direction is worse.
     */
    setPrecision(gridOf(draft.precision) === null ? presetPrecision : draft.precision);
    // Restored once. Leaving the banner up invites a second click that would
    // overwrite whatever the owner typed after the first.
    setOffered(null);
  }

  /** The owner saying "that is not what I want", so the draft has to be GONE
   *  rather than hidden — a banner dismissed without clearing storage comes back
   *  on the next mount. The form is left exactly as it is: this throws away the
   *  STORED draft, not the text on the screen. */
  function discard() {
    if (store !== null && webId !== undefined) clearDraft(store, { webId, scope });
    setOffered(null);
  }

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

  async function save() {
    // The previous result stops being true the moment a new save starts, and
    // leaving it up would also let a caller mistake it for this save's.
    setOutcome(null);

    const missing = [
      trip === undefined ? "a trip" : null,
      slug.trim() === "" ? "a slug" : null,
      headline.trim() === "" ? "a headline" : null,
    ].filter((what): what is string => what !== null);

    if (trip === undefined || missing.length > 0) {
      setOutcome({
        tone: "problem",
        text: `This entry needs ${missing.join(", ")} before it can be saved. Nothing has been sent to your Pod.`,
      });
      return;
    }

    const precondition = preconditionFor(target);
    if (precondition === null) {
      setOutcome({
        tone: "problem",
        text:
          "This entry is on your Pod, but your Pod did not return a version tag for the last write, " +
          "so there is nothing to condition the next one on. Reload the entry before editing it " +
          "further: saving without a precondition would silently overwrite whatever is there now.",
      });
      return;
    }

    const url = target?.url ?? entryUrlIn(trip, slug.trim());
    const language = existing?.headline.language ?? LANGUAGE;
    const body = story.trim();

    /**
     * ONE INSTANT for this whole save, and it is handed to `saveEntry` rather
     * than left to its default so that the value this form remembers is the
     * value that reaches the Pod. The default is a `Z` normalised to `+00:00`;
     * this carries the owner's own offset, like every other timestamp §7.3
     * shows.
     */
    const stamp = nowWithOffset();
    const creating = target === null;
    // Mirrors saveEntry's own rule rather than replacing it: invent `created`
    // only when creating. An older entry that has none must not be given one
    // now — that would claim the record came into being today.
    const created = provenance.created ?? (creating ? stamp : undefined);
    // "When it became public", fixed at the first publication and never
    // recomputed. Unpublishing does not clear it: it is a fact about the past.
    const datePublished =
      provenance.datePublished ?? (status === "published" ? stamp : undefined);

    /**
     * §9, AND IT HAPPENS HERE — before the `Entry` below exists, so `saveEntry`
     * is never handed a precise coordinate and the only copy of one is in this
     * component's state and in the input the owner is looking at. "The studio
     * applies fuzzing before the write and discards the precise original."
     *
     * THREE OUTCOMES, AND `undefined` MEANS TWO DIFFERENT THINGS, which is why
     * `touchedCoordinate` is computed separately rather than inferred from a
     * missing geometry:
     *
     *   nothing typed  → the place travels through UNTOUCHED, coordinates and
     *                    all. They were snapped when they were stored and are
     *                    not necessarily on today's grid, so re-snapping them
     *                    would walk the pin on every save (see the note on the
     *                    `lat` state).
     *   snap           → the published pair replaces whatever was there.
     *   drop           → the geometry is REMOVED. §9 step 2: not coarsened, and
     *                    the place keeps its name — "it is the geometry that is
     *                    absent, not the entry". On an edit that means deleting
     *                    a `#geo` that is already on the Pod, which is the half
     *                    an "add the new one" spelling silently skips.
     *
     * FAIL CLOSED ON EVERYTHING ELSE. A form that somehow holds a coordinate
     * without trustworthy settings — a restored draft, a control re-enabled by
     * hand — publishes none: `fuzzForPublication` refuses settings that do not
     * parse, and the two guards above it refuse a gate that never opened and a
     * precision that is not a positive integer of metres. Every one of those is
     * a drop, and a drop still saves the entry.
     */
    const touchedCoordinate = lat.trim() !== "" || long.trim() !== "";
    const place = touchedCoordinate
      ? placeFor(existing?.place, fuzzed({ lat: Number(lat), long: Number(long) }))
      : existing?.place;

    /**
     * `dcterms:created` AND the fields this form does not offer are carried
     * through from the entry being edited. §7.3: created "is when the record
     * came into being and datePublished is when it became public. They differ
     * by however long the draft sat." An edit that rewrites the resource
     * without them destroys them silently and permanently — the place and its
     * (already fuzzed) coordinates, the photos, the original creator.
     */
    const entry: Entry = {
      iri: `${url}#it`,
      slug: slug.trim(),
      status,
      schemaVersion: SCHEMA_VERSION,
      headline: { value: headline.trim(), language },
      articleBody: body === "" ? undefined : { value: body, language },
      trip: trip.iri,
      occurredAt: occurred === "" ? undefined : toOffsetDateTime(occurred, storedOffset),
      datePublished,
      travelModeFrom: mode === "" ? undefined : mode,
      place,
      photos: existing?.photos ?? [],
      tags: parseTags(tagsText),
      created,
      creator: existing?.creator ?? session.info.webId,
      // Stamped by saveEntry, which shares one instant with the index it writes.
      modified: existing?.modified,
    };

    setSaving(true);
    let report: SaveEntryReport;
    try {
      report = await saveEntry({
        // The visitor's own authenticated fetch, and never the ambient one:
        // anonymous reads as "not found" on a hosted Pod (invariant 4).
        fetch: session.fetch,
        entry,
        precondition,
        indexUrl: trip.indexUrl,
        tripIri: trip.iri,
        tripSlug: trip.slug,
        webId: session.info.webId,
        // Step 4 posts to this app's own route, unauthenticated by design.
        revalidate: revalidatePublicSite,
        now: () => stamp,
      });
    } catch (cause) {
      /**
       * `saveEntry` reports every failure it knows about as a value, so
       * reaching here means something threw where nothing is meant to — and the
       * honest answer is that what reached the Pod is unknown, not that the
       * save failed.
       *
       * Caught for the reason the shell catches its two verbs: an unhandled
       * rejection would leave the button disabled and the screen looking as
       * though the click had done nothing at all.
       */
      setOutcome({
        tone: "problem",
        text:
          "The save stopped unexpectedly, so what reached your Pod is unknown. Reload the entry " +
          "to see what is there before saving again.",
        detail: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    } finally {
      setSaving(false);
    }

    // The resource exists from the moment step 1 succeeds, whatever happened
    // after it — so the next save is an update, with whatever ETag came back.
    if (report.completed.includes("entry")) {
      /**
       * STEP 1 IS THE WHOLE TEST, including the two §10 outcomes where a LATER
       * step failed — an unverified ACL, a refused index. The text is on the
       * Pod in both, and keying this on "the save reported no failure" would
       * leave a stale draft behind in exactly the two cases the owner is already
       * being asked to do something about. When step 1 itself failed the draft
       * is kept, because then the form and this copy are the only ones there
       * are: §10's 412 tells the owner to reload, and the draft is what survives
       * the reload.
       *
       * `text` is this render's snapshot of the eight fields — the same values
       * the entry above was assembled from, because `save()` is synchronous up
       * to the await — so it is what reached the Pod. `settleDraft` compares it
       * with what is on the form now and keeps the difference.
       *
       * THE ORDER OF THESE THREE LINES IS COSMETIC RATHER THAN LOAD-BEARING:
       * `settleDraft` clears `scope` as this render closed over it, so
       * `setTarget` cannot move the key out from under it whichever way round
       * they go. It reads as though it could, which is the only reason it is
       * written this way round.
       */
      settleDraft(text, report.entryUrl);
      setTarget({ url: report.entryUrl, etag: report.etag ?? null });
      // What the Pod now holds, so the next save carries it rather than
      // dropping it. See the note on `provenance`.
      setProvenance({ created, datePublished });
    }
    setOutcome(announce(report, status));
  }

  return (
    <section className="mt-8 border-t border-hairline pt-6">
      <h2 className="text-xl">{initial === undefined ? "New entry" : "Edit entry"}</h2>

      {/*
        NAMED BY `title`, NOT BY `aria-label`, AND THAT IS LOAD-BEARING.

        The name has to say "draft" — that is what tells the owner what this is —
        and every ARIA naming mechanism puts the named element into
        @testing-library's `getByLabelText` results: it matches `aria-label` and
        `aria-labelledby` on ANY element, not only on form controls. This screen
        already has a control whose label matches the same words, the Status
        select, so an `aria-label` here makes `getByLabelText(/status|draft/)`
        ambiguous and every test that fills the form while the banner is up fails
        on "found multiple elements" rather than on anything real. Measured with
        a throwaway probe: `aria-label` yields two matches, `title` one.

        `role="region"` is explicit for the same probe's other half — a bare
        `<section>` named only by `title` is not given the region role, so it
        would be unfindable as the landmark it is. The name still resolves from
        `title` in the accessible-name computation, which is where a tooltip
        belongs in that algorithm.
      */}
      {offered !== null && (
        <section
          role="region"
          title="Unsaved draft"
          className="mt-4 border border-hairline bg-surface p-4"
        >
          <p>
            {"This browser kept what you were writing here, from "}
            <time dateTime={offered.savedAt}>{savedAtText(offered.savedAt)}</time>
            {". Nothing on this form has been changed."}
          </p>
          {/*
            THE HOLD, SAID OUT LOUD AND SAID HERE.

            The sentence above explains the DRAFT and stops there — it kept your
            text, the form is untouched — which accounts for the banner but not
            for the nine controls underneath it going dead. Someone who reads
            only that sentence has been told what happened and not what is now
            being withheld, and the fieldset does not announce itself.

            IT LIVES IN THE BANNER RATHER THAN NEXT TO THE BUTTON, and the
            difference is not layout. The Save button names this element (see
            the note on the button), so what a screen reader reads out as the
            reason is this text and not a paraphrase of it: a second copy parked
            beside the button is a text that drifts from the one it duplicates,
            and the copy nobody edits is the copy the owner hears. Keeping it
            inside also makes the hold explanation structural — it cannot
            outlive the offer, because it is rendered by the same condition.
          */}
          <p id={HOLD_REASON_ID} className="mt-2">
            {"Restore it or discard it to carry on: while it is waiting, the form below is " +
              "held and cannot be saved, so that one storage slot is not written by two hands."}
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" className={BUTTON} onClick={() => restore(offered)}>
              {"Restore"}
            </button>
            <button type="button" className={BUTTON} onClick={discard}>
              {"Discard"}
            </button>
          </div>
        </section>
      )}

      <form
        className="mt-4"
        /*
          ONE PLACE THAT MARKS THE FORM AS TOUCHED, rather than a line in each of
          eight handlers. React's `onChange` is delivered to ancestors, so this
          catches every control on the form including ones added later — and a
          field whose handler forgot the line would be a field whose typing is
          silently not backed up. `restore()` deliberately does NOT come through
          here: it sets state without a DOM event, and what it puts on the form
          is what storage already holds.
        */
        onChange={() => {
          touched.current = true;
        }}
        onSubmit={(event) => {
          // Prevented, so jsdom and the browser both stay on this page and the
          // save is this component's to run.
          event.preventDefault();
          void save();
        }}
      >
        {/*
          HELD WHILE A DRAFT IS OFFERED — one storage slot, so only one of the
          two may hold the pen.

          THE LOSS IT PREVENTS. The banner and the autosave share a key. A draft
          survives a crash; the next day the owner opens the studio, sees the
          banner, decides to deal with it later and starts typing something
          else. 800ms later the autosave puts the near-empty new form at that
          key and the old text is gone from storage — `offered` still holds it
          in memory, so Restore works for as long as this tab lives, and a
          reload, a session expiry or a second crash loses the long entry
          `docs/decisions.md` §10 names as the reason this feature exists.
          Restore or Discard unlocks the form; the cost is one click.

          A `<fieldset disabled>`, NOT A GUARD IN `onChange` OR IN THE AUTOSAVE
          EFFECT, and the difference is what the owner is shown. A guard that
          refuses the CHANGE leaves them typing into a form that silently drops
          the keystroke, with nothing on screen saying anything is being
          withheld. A guard that refuses only the WRITE is worse in the other
          direction: the text appears and nothing is backing it up, which is the
          silent half of the same loss. The fieldset stops the keystroke where a
          browser stops it, and says so through the controls' own appearance and
          to a screen reader.

          THE SAVE BUTTON IS IN HERE TOO — the ninth control, held by the same
          attribute for the same reason. See the note on the button itself for
          the one click that closes.

          `grid gap-4` MOVED HERE FROM THE FORM. The eight fields were the
          form's direct grid children; a wrapper around them is otherwise the
          grid's only item, every field collapses into one cell and the gaps
          disappear. `display: contents` would have kept the form as the grid,
          and is declined: `fieldset` is the one element where browser support
          for it has historically differed, and a plain grid box behaves the
          same everywhere. `min-w-0` because a fieldset's UA
          `min-inline-size: min-content` is not among the things Tailwind's
          preflight resets (checked in node_modules/tailwindcss/preflight.css,
          which names no fieldset rule at all), and with `w-full` controls
          inside it that floor can stop the textarea shrinking.
        */}
        <fieldset disabled={offered !== null} className="grid min-w-0 gap-4">
          <Field id="entry-trip" label="Trip">
            <select
              id="entry-trip"
              name="entry-trip"
              className={CONTROL}
              value={tripIri}
              disabled={addressFixed}
              onChange={(event) => setTripIri(event.target.value)}
            >
              <option value="">{"Choose a trip"}</option>
              {/* IN TEXT, NOT IN A COLOUR. An `<option>` carries no styling a
                  screen reader announces and no styling a colour-blind reader
                  can rely on, so the one thing that distinguishes a draft trip
                  from a published one has to be part of its name here. */}
              {trips.map((choice) => (
                <option key={choice.iri} value={choice.iri}>
                  {choice.status === "draft" ? `${choice.name} (draft)` : choice.name}
                </option>
              ))}
            </select>
          </Field>

          <Field id="entry-slug" label="Slug" hint="Becomes the entry's address, and is fixed once it is saved.">
            <input
              id="entry-slug"
              name="entry-slug"
              type="text"
              className={CONTROL}
              value={slug}
              disabled={addressFixed}
              aria-describedby="entry-slug-hint"
              onChange={(event) => setSlug(event.target.value)}
            />
          </Field>

          <Field id="entry-headline" label="Headline">
            <input
              id="entry-headline"
              name="entry-headline"
              type="text"
              className={CONTROL}
              value={headline}
              onChange={(event) => setHeadline(event.target.value)}
            />
          </Field>

          <Field id="entry-story" label="Story">
            <textarea
              id="entry-story"
              name="entry-story"
              rows={8}
              className={CONTROL}
              value={story}
              onChange={(event) => setStory(event.target.value)}
            />
          </Field>

          <Field
            id="entry-when"
            label="When it happened"
            hint="Kept with the offset of the place it happened in, so it always reads as that time of day."
          >
            <input
              id="entry-when"
              name="entry-when"
              type="datetime-local"
              className={CONTROL}
              value={occurred}
              aria-describedby="entry-when-hint"
              onChange={(event) => setOccurred(event.target.value)}
            />
          </Field>

          {/*
            THE THREE COORDINATE CONTROLS, INSIDE THE HELD FIELDSET WITH THE
            OTHERS. Nothing about them is special enough to stand outside it:
            one storage slot, so an unanswered banner must not be typed past
            here either, and a latitude typed behind the banner is a latitude
            the local copy is not keeping.

            THEY CARRY A SECOND, INDEPENDENT HOLD — `disabled={!coordinatesLive}`
            — and the two COMPOSE rather than replace one another, exactly as
            `saving` and the fieldset do on the Save button. The fieldset says
            "answer the banner first"; this says "there are no settings to
            publish a coordinate against". Respelling either as the other passes
            every attribute assertion and reopens the case it was not spelled
            for.

            NO NESTED `<fieldset disabled>` AROUND THE THREE, tempting as it is:
            it would carry the `disabled` once, and it would carry the REASON
            nowhere. Nothing propagates a group's description to its members —
            measured for the Save button's hold, and the same measurement
            applies here — so the association has to be on each control
            regardless, and a `<legend>` would add a fourth thing named
            "coordinates" for the form's own queries to trip over.
          */}
          <Field
            id="entry-latitude"
            label="Latitude"
            hint={
              existing?.place?.geo === undefined
                ? "Snapped to the precision below before it is saved. Your Pod never holds the point you type here."
                : "Snapped to the precision below before it is saved. Leave both boxes empty to keep the coordinate this entry already has."
            }
          >
            <input
              id="entry-latitude"
              name="entry-latitude"
              type="number"
              step="any"
              inputMode="decimal"
              className={CONTROL}
              value={lat}
              disabled={!coordinatesLive}
              aria-describedby={coordinateHelp("entry-latitude-hint")}
              onChange={(event) => setLat(event.target.value)}
            />
          </Field>

          <Field id="entry-longitude" label="Longitude">
            <input
              id="entry-longitude"
              name="entry-longitude"
              type="number"
              step="any"
              inputMode="decimal"
              className={CONTROL}
              value={long}
              disabled={!coordinatesLive}
              aria-describedby={coordinateHelp()}
              onChange={(event) => setLong(event.target.value)}
            />
          </Field>

          {/* §9 step 3: whatever this says, `dy:precisionMeters` says the same
              and the pair beside it is that grid's. The owner's own
              `dy:defaultPrecisionMeters` is preselected and is in the list
              VERBATIM — see `precisionOptions` for why it is not rounded onto
              the fixed grids in either direction. */}
          <Field
            id="entry-precision"
            label="Precision"
            hint="How large a cell the point is published in. Coarser is never a leak; finer is."
          >
            <select
              id="entry-precision"
              name="entry-precision"
              className={CONTROL}
              value={precision}
              disabled={!coordinatesLive}
              aria-describedby={coordinateHelp("entry-precision-hint")}
              onChange={(event) => setPrecision(event.target.value)}
            >
              {/* Only ever reachable with the control dead: §7.6 has no default
                  and this app supplies none, so an empty value means the
                  settings have not answered or could not be read. A controlled
                  <select> whose value matches no option renders blank, which
                  reads as a list someone forgot to fill in. */}
              {precision === "" && <option value="">{"Unavailable"}</option>}
              {precisionOptions.map((metres) => (
                <option key={metres} value={String(metres)}>
                  {precisionLabel(metres)}
                </option>
              ))}
            </select>
          </Field>

          {/*
            WHY THE THREE ABOVE ARE DEAD, ON SCREEN AND ASSOCIATED WITH THEM.
            §9: "an entry silently losing its map pin becomes a bug report,
            whereas 'you have not set a home region yet' is a one-time setup
            step with an obvious fix."

            Rendered exactly when something points at it — a live
            `aria-describedby` naming an element that is not there computes to
            the empty string, silently, and the control is back to announcing
            itself as unavailable with no reason given.
          */}
          {coordinateNote !== null && (
            <p id={COORDINATE_NOTE_ID} className="text-sm text-muted-foreground">
              {coordinateNote}
            </p>
          )}
          {/* The failure as `describe()` renders it — a URL and a status code.
              Outside the association for the same reason the save's detail is
              outside the announced region: the sentence above is what a person
              can act on, and a screen reader should not read a Pod URL out
              character by character to deliver it. */}
          {gate.kind === "closed" && (
            <p className="text-sm text-muted-foreground">{gate.detail}</p>
          )}

          <Field id="entry-tags" label="Tags" hint="Separated by commas.">
            <input
              id="entry-tags"
              name="entry-tags"
              type="text"
              className={CONTROL}
              value={tagsText}
              aria-describedby="entry-tags-hint"
              onChange={(event) => setTagsText(event.target.value)}
            />
          </Field>

          {/* The leg that ARRIVED here (§7.3), which is why it is worded that
              way rather than as "how you left". */}
          <Field id="entry-mode" label="Travel mode you arrived by">
            <select
              id="entry-mode"
              name="entry-mode"
              className={CONTROL}
              value={mode}
              onChange={(event) => {
                const chosen = TravelMode.safeParse(event.target.value);
                setMode(chosen.success ? chosen.data : "");
              }}
            >
              <option value="">{"Not recorded"}</option>
              {TravelMode.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>

          {/* §7.4: the index is the publication boundary, and §5 pairs the status
              with the ACL. Both follow from this one control. */}
          <Field id="entry-status" label="Status">
            <select
              id="entry-status"
              name="entry-status"
              className={CONTROL}
              value={status}
              onChange={(event) => {
                const chosen = Status.safeParse(event.target.value);
                if (chosen.success) setStatus(chosen.data);
              }}
            >
              {Status.options.map((option) => (
                <option key={option} value={option}>
                  {option === "draft" ? "Draft" : "Published"}
                </option>
              ))}
            </select>
          </Field>

          {/*
            THE NINTH CONTROL, HELD WITH THE OTHER EIGHT AND BY THE SAME
            ATTRIBUTE. It carries no margin of its own: the fieldset is the
            grid, so this row takes its gap from `gap-4` like every field above
            it, and the `mt-4` it wore while it stood outside would now be a
            second gap on top of that one. The wrapper `<div>` stays, bare —
            the grid stretches its items, so a button promoted to a direct child
            of the fieldset becomes a full-width bar.

            THE LOSS IT CLOSES, which is why it moved. The eight fields shipped
            held and this button did not, and that left exactly one click
            between an unanswered banner and the text it was offering. On a
            CREATE the click is harmless — the form behind the banner is empty
            and `save()`'s pre-flight guard refuses it. On an EDIT it is not:
            the form is already full of the entry that was opened, so the save
            writes it as it stands, `settleDraft` clears the key, and the copy
            that survived the crash is deleted before the owner has read the
            sentence offering it. One unprompted click, nothing typed, no way
            back — the same loss the fieldset exists to prevent, reached by a
            shorter route.

            THE HOLD IS REAL RATHER THAN COSMETIC, AND THAT IS THE MEASUREMENT
            (jsdom 30.0.1, @testing-library/react 16.3.3, throwaway probe).
            Inside a `<fieldset disabled>` an <input> still takes
            `fireEvent.change` and a <button> still receives the click event —
            but jsdom refuses the button's ACTIVATION behaviour, because
            "actually disabled" walks up to the fieldset. The probe measured 0
            submissions held against 1 free. So from behind the banner this
            button dispatches no `submit` at all, which is what lets section 8e
            assert the consequence — nothing to the Pod, the draft still on
            disk — instead of an attribute. The same measurement once read as
            the reason the button could not live here: section 8c used to fill
            the held form with `fireEvent` and save, which only passed because
            `fireEvent` ignores disabled state. It now clicks Restore first,
            which is the path the owner actually has, and all six §10 scenarios
            still reach the Pod.

            `disabled={saving}` AND `aria-busy={saving}` STAY, AND THEY COMPOSE
            WITH THE FIELDSET RATHER THAN BEING REPLACED BY IT. Two different
            conditions on one control: the fieldset says "answer the banner
            first", `saving` says "this one is in flight". Respelling the hold
            as `disabled={offered !== null}` here would pass every assertion
            about the banner and re-open the double submit this button has been
            guarded against since it was written — 8g and the last test of 8e
            pin `saving` at the one moment it is true. `aria-busy` in particular
            keeps meaning `saving` and nothing else: a form waiting for a person
            to answer a banner is not busy, and the fieldset must not become the
            thing that reports busy-ness.
          */}
          <div>
            {/*
              THE REASON IS ON THE BUTTON, NOT ON THE FIELDSET THAT DOES THE
              HOLDING, AND IT MUST NOT BE TIDIED UPWARD. It reads as though it
              belongs there — one element holds nine controls, so one element
              should carry the reason once — and that spelling is heard by
              nobody. Measured (jsdom 30.0.1, dom-accessibility-api 0.5.16;
              it is the ARIA computation rather than a jsdom quirk):

                <fieldset disabled aria-describedby="reason"><button>   ""
                <fieldset disabled><button aria-describedby="reason">   "…"

              A `<legend>` names a group; nothing propagates a group's
              DESCRIPTION to its members. Moving this attribute up therefore
              deletes the explanation while leaving markup that reads as if it
              were still there — the accessibility-shaped version of a rule
              exercised at a path it does not cover.

              THIS BUTTON ALONE, not all nine. The banner sits directly above
              the eight fields and its own sentence is about them; Save is the
              one whose refusal has a consequence the owner will go looking for.
              And one reason attached to nine controls is that reason announced
              nine times to anyone reading the form linearly.

              CONDITIONAL, BOTH WAYS. With no offer the element it would name is
              not rendered, and a dangling IDREF computes to "" — so the honest
              spelling is no attribute at all. It would also be wrong if it did
              resolve: a description carried permanently is a hold announced on
              every encounter with the button, including the encounters where
              nothing is holding it.

              THE TEST DOES NOT CATCH THE UNCONDITIONAL SPELLING, and this
              comment is where that is written down. Measured: with
              `aria-describedby={HOLD_REASON_ID}` unconditional, 8e-bis still
              passes end to end, because with no offer the banner is not
              rendered, the IDREF dangles and the description computes to ""
              anyway. The allow-case is structural, exactly as that docblock
              says. The condition is kept because a live attribute pointing at
              nothing is a lie in the markup that the next reader has to
              disprove.

              `disabled={saving}` and `aria-busy={saving}` are a DIFFERENT
              condition and stay exactly as they are — see the block above.
            */}
            <button
              type="submit"
              disabled={saving}
              aria-busy={saving}
              aria-describedby={offered === null ? undefined : HOLD_REASON_ID}
              className={BUTTON}
            >
              {"Save entry"}
            </button>
          </div>
        </fieldset>
      </form>

      {/*
        `role="note"`, WHICH IS NEITHER `status` NOR `alert` AND MUST NOT BECOME
        ONE. Those two belong to the save, and a browser that will not keep a
        local copy has no bearing on the Pod at all: the entry saves exactly as
        it would otherwise. An assertive announcement would interrupt a screen
        reader mid-sentence to report something that changed nothing.

        It has to be said, though — quietly is not silently. The whole value of
        this feature is the belief that the text is safe, and a backup that is
        not happening while the owner believes it is is worse than no backup at
        all. Once it appears it stays; the attempts behind it continue.
      */}
      {storageRefused && (
        <p role="note" className="mt-6 text-sm text-muted-foreground">
          {"This browser is not keeping a local copy of what you type — private browsing, or " +
            "storage that is full or switched off. Saving to your Pod is unaffected, but " +
            "anything you have not saved will not survive closing this tab."}
        </p>
      )}

      {/*
        `status` for news, `alert` for something needing a decision: `alert` is
        assertive and interrupts a screen reader mid-sentence, which a save that
        worked has not earned.

        THE TECHNICAL DETAIL IS DELIBERATELY OUTSIDE THE ANNOUNCED REGION. It is
        the failure as `describe()` renders it — a URL and a status code — and
        an alert should carry the sentence a person can act on, not read out a
        Pod URL character by character. Keeping it out also keeps the six §10
        outcomes distinguishable BY THEIR WORDING: inside the region, a
        per-scenario URL would make any two identically worded outcomes look
        different to a test reading that region, which is exactly the
        distinction test/entry-editor.test.tsx exists to hold. Measured, not
        supposed — with the detail inside, keying the message off `recovery`
        alone still passed that test.
      */}
      {outcome !== null &&
        (outcome.tone === "ok" ? (
          <p role="status" className="mt-6">
            {outcome.text}
          </p>
        ) : (
          <>
            <p role="alert" className="mt-6">
              {outcome.text}
            </p>
            {outcome.detail !== undefined && (
              <p className="mt-2 text-sm text-muted-foreground">{outcome.detail}</p>
            )}
          </>
        ))}
    </section>
  );
}

/**
 * Tokens from app/globals.css, no arbitrary values: the fixed dark palette
 * lives at `:root` and this screen stays plain until phase 7.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ARBITRARY-VALUE GUARDRAIL DOES NOT REACH THESE TWO CONSTANTS. Keep
 * arbitrary values out of them by hand.
 *
 * eslint.config.mjs bans `w-[137px]` and its kind with the selector
 * `JSXAttribute[name.name='className'] Literal[value=/…-\[…\]/]`, which matches
 * a string written INSIDE the attribute. These are module consts spent as
 * `className={CONTROL}` — an Identifier, not a Literal — so the rule never
 * looks at them. Measured with a throwaway probe: `disabled:bg-[#222]` in here
 * produces zero errors and the same string inline produces one. The rule is not
 * changed to suit this file; that is a separate decision with its own failing
 * test, and this note is here so the gap is known rather than discovered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `disabled:` HAS TO BE SPELLED OUT AT ALL, when every browser greys a
 * disabled control for free.
 *
 * It greys it by supplying its OWN background and text colour, and this theme
 * has already overridden both: `bg-surface` outranks the UA background, and
 * Tailwind's preflight sets `color: inherit` on form controls, so the UA's
 * disabled text colour never lands either. On a light default that would still
 * leave something visibly off; on a fixed dark palette it leaves nothing.
 *
 * Measured in a real browser, against the local Community Solid Server, with a
 * draft seeded and the banner up — `getComputedStyle` on held and free controls
 * side by side:
 *
 *     headline (held)  bg lab(6.67 -1.11 -4.74)  color lab(90.7 …)  opacity 1
 *     save     (held)  bg lab(6.67 -1.11 -4.74)  color lab(90.7 …)  opacity 1
 *     restore  (free)  bg lab(6.67 -1.11 -4.74)  color lab(90.7 …)  opacity 1
 *
 * Byte-identical. Nine controls that look perfectly editable while swallowing
 * every keystroke — which is a worse failure than an ugly one, because the
 * owner's conclusion is that the app is broken rather than that something is
 * being asked of them. The programmatic half of the same defect is the Save
 * button's `aria-describedby`, above.
 *
 * ONE VARIANT COVERS ALL EIGHT FIELDS BECAUSE `:disabled` IS INHERITED IN FACT
 * IF NOT IN NAME: a control inside a `<fieldset disabled>` is "actually
 * disabled" per HTML, so `:disabled` matches it without the attribute being on
 * the control. That is the same mechanism the hold itself relies on.
 *
 * BOTH OVERRIDES WIN ON SPECIFICITY, NOT ON SOURCE ORDER, which is worth
 * knowing because source order is the thing a Tailwind upgrade may re-sort.
 * Compiled with this project's own Tailwind 4.3.3 and read out of the emitted
 * stylesheet:
 *
 *     .cursor-pointer                          0,1,0
 *     .disabled\:cursor-not-allowed:disabled    0,2,0   wins
 *     .hover\:bg-hairline:hover                 0,2,0
 *     .disabled\:hover\:bg-surface:disabled:hover 0,3,0  wins
 *
 * The hover override earns its place: `:hover` still matches a disabled button,
 * so without it the held Save button lights up under the pointer — a control
 * that is faded and inert and still reacts, which reads as pressable.
 *
 * NONE OF THIS IS TESTED, DELIBERATELY AND ON THE RECORD. jsdom computes no
 * cascade, so the only assertion available is `toHaveClass("disabled:opacity-60")`,
 * which restates the string on the next line and would pass against a variant
 * that resolves to nothing, a token absent from `@theme`, or a rule a later
 * Tailwind outranks. The reasoning is in test/entry-editor.test.tsx's 8e-bis
 * docblock; the pin there covers the half a stylesheet cannot silently remove.
 */
const CONTROL = "w-full border border-hairline bg-surface px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60";

/** The same plain button for Save, Restore and Discard. Shared so the two
 *  draft controls cannot drift into looking like something other than the
 *  buttons they are — which is also why the `disabled:` variants are here and
 *  not on the Save button alone: Restore and Discard are never disabled, so
 *  these three utilities only ever fire on Save, and putting them on the shared
 *  constant is what stops the next button added here from shipping inert and
 *  looking live. See CONTROL above for why the browser does not do it for us. */
const BUTTON =
  "cursor-pointer border border-hairline bg-surface px-4 py-2 hover:bg-hairline " +
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface";

/** A control with a real `<label>` — the studio is navigable by keyboard and
 *  by screen reader, and a field a screen reader cannot name is a field only
 *  some people can fill in. The hint is `aria-describedby`, not part of the
 *  label: it is guidance, not the name of the thing. */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
