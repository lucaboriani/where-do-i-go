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
 *      components/studio/studio-client/studio-client.tsx draws.
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
 * ─────────────────────────────────────────────────────────────────────────────
 * PHOTOS, AND WHY THE PICK IS THE UPLOAD.
 *
 * Until 2026-09-06 this file said photos were phase 3 because they need the
 * resize/EXIF pipeline. That pipeline now exists — lib/media/pipeline.ts for
 * the bytes, lib/media/upload.ts for the two PUTs — so the reason is gone and
 * the comment with it. What replaces it is the ordering decision, which is the
 * part that is easy to undo by accident:
 *
 *   A PICKED FILE IS PROCESSED AND UPLOADED IMMEDIATELY, and this component
 *   then holds URLs and JSON — a `Photo` — rather than a `File` or a `Blob`.
 *   Holding the file until Save is the obvious spelling and it breaks the
 *   autosave: `localStorage` takes strings, a Blob serialises to `{}` without
 *   throwing, and the draft would report success while restoring a photo with
 *   no URL on it. The derivatives are content-addressed (§7.3), so a re-pick of
 *   the same photo is a 412 read as reuse rather than a second copy.
 *
 *   ONLY `ready` SLOTS ARE SAVED. A file the pipeline refused is announced and
 *   left out — of the entry, and of the draft. An optimistic slot carrying a
 *   local `blob:` preview into the entry would write a photo that 404s for
 *   every reader, on a resource that reports itself saved.
 *
 *   AN EXISTING ENTRY'S PHOTOS ARE CARRIED, NEVER REPLACED. Picking a photo
 *   appends; picking none leaves `existing.photos` exactly as it arrived, the
 *   same rule the place, `created` and `datePublished` follow. The binaries
 *   have no other reference, so dropping the triple orphans the bytes.
 *
 * A PHOTO'S EXIF `DateTimeOriginal` IS STILL NOT WIRED TO THE PHOTO'S OWN
 * `schema:dateCreated`, AND AS OF 2026-09-07 IT DOES REACH THE ENTRY'S
 * TIMESTAMP — THROUGH THE FORM, exactly as the GPS below does. §6 requires a UTC
 * offset on every `xsd:dateTime`, and lib/media/exif.ts yields an offset-less
 * wall clock — EXIF has no zone and `OffsetTimeOriginal` is usually absent
 * (§11.5) — so inventing this machine's offset for a photo taken elsewhere
 * would stamp the wrong instant onto a permanent record. That argument still
 * forbids the direct write, and an existing `dateCreated` is carried through
 * untouched. What it never forbade is the pair of CONTROLS: the wall clock
 * lands in "When it happened", the half EXIF does not carry is the offset
 * select beside it, and the owner is TOLD when that half is only this machine's
 * guess instead of reading `21:38 +02:00` in which both halves look like data
 * (§11.5: "worse than not auto-dating at all, because it looks right"). See
 * `offerTimestamp`, `TimeAuthor` and `OFFSET_GUESS_ID`.
 *
 * A PHOTO'S GPS *IS* WIRED, AS OF 2026-09-07, AND IT IS WIRED TO THE FORM.
 * This paragraph used to end "neither wire is stage 1's", which was true of
 * stage 1 and is now false of the coordinate half: `derived.metadata.gps`
 * fills the two coordinate boxes when nothing else has (§11.3), and it fills
 * NOTHING ELSE.
 *
 *   IT FEEDS THE FORM, NEVER THE WRITE PATH, and that is the whole of the
 *   privacy argument. A photo's GPS arrives looking authoritative — it is a
 *   real reading, from a real receiver — and the tempting spelling puts it on
 *   `place.geo` directly, which publishes the exact spot a picture was taken.
 *   Landing it in the inputs instead means it reaches the Pod by the ONE route
 *   a typed coordinate does: `fuzzed()` at save time, §9 steps 1–4, snapped or
 *   dropped. There is no second path, and §9's guarantee is that there is not.
 *
 *   FIRST WRITER WINS, IN EVERY DIRECTION (§11.3, and ruling T3-B for the last
 *   of them). Auto-fill only ever writes into a coordinate nobody has supplied:
 *   not one the owner typed, not one an earlier photo offered, and not one the
 *   entry being edited already has — an edit's boxes are empty by design, and
 *   what they mean when empty is "the pair on the Pod stands". See
 *   `coordinateAuthor`.
 *
 *   AND IT ASKS THE SAME GATE EVERY OTHER COORDINATE WRITER ASKS. Settings that
 *   cannot be read leave the three controls dead (§9's fail-closed posture), and
 *   a photo does not get past that either — `offerCoordinate`.
 *
 *   AND IT SAYS SO ON SCREEN. A value that appeared without being typed has to
 *   name where it came from, or the owner cannot tell it from something they
 *   did yesterday — `COORDINATE_SOURCE_ID`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PLAIN CONTROLS ON PURPOSE. TODO.md keeps layout deliberately unstyled until
 * phase 7, and native `<select>`, `<input>` and `<textarea>` need no Radix on a
 * screen of sixteen controls. Every one of them has a real `<label>`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPipeline } from "@/lib/media/pipeline";
import { uploadPhoto } from "@/lib/media/upload";
import { documentUrlOf } from "@/lib/pod/entry-model";
import { fuzzForPublication } from "@/lib/pod/fuzz";
import { readPrivacySettings } from "@/lib/pod/read";
import { describe } from "@/lib/pod/result";
import { Status, TravelMode } from "@/lib/pod/schema";
import { saveEntry } from "@/lib/pod/save-entry";
import { clearDraft, readDraft, writeDraft } from "@/lib/studio/drafts";
import { revalidatePublicSite } from "@/lib/studio/revalidate";
import { SCHEMA_VERSION } from "@/lib/vocab";
import type { Pipeline, PipelineResult } from "@/lib/media/pipeline";
import type { ReactNode } from "react";
import type {
  Entry,
  Photo,
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
   * The Pod's storage root, which is where `travel/media/` hangs (§4: media is
   * ONE global container, outside any trip, so publishing never has to move
   * binaries or rewrite references).
   *
   * REQUIRED, AND A PROP, for exactly the reasons `settingsUrl` above is both.
   * `POD_ROOT` is not `NEXT_PUBLIC_` and `lib/config.ts` throws the moment it is
   * reached in a browser, so the shell — which already holds it, since
   * `settingsUrl` is derived from it — passes it down. Optional would mean a
   * shell that forgot it uploads photos to a path built from `undefined`, and
   * nothing renders a wire nobody passed, so tsc is the only check that covers
   * the omission.
   */
  podRoot: string;
  /**
   * The resize/EXIF pipeline, injected so that a test can supply output it
   * knows byte for byte. `undefined` is what ships: one is created lazily on
   * the first pick, because a worker at mount is a thread and a chunk spent on
   * the majority of edits, which touch no photo at all.
   *
   * OWNERSHIP FOLLOWS CREATION, AND THAT IS THE WHOLE POINT OF THE SEAM. An
   * injected pipeline is disposed by whoever injected it; the unmount cleanup
   * below only ever disposes one this component created. `dispose()` is not a
   * cancel — it terminates the worker and rejects everything pending — so
   * disposing a caller's instance would break a photo it was still processing.
   */
  pipeline?: Pipeline;
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
 * most of the meaning. So only the OFFSET is supplied here, and it is the one
 * the owner's own control is holding.
 *
 * THE OFFSET IS REQUIRED, AND THE FALLBACK THAT USED TO BE ON THIS LINE HAS
 * MOVED RATHER THAN GONE. It read `storedOffset ?? offsetHere(wall)` — the
 * entry's own offset, else the EDITING MACHINE'S — which is the guess the
 * offset control exists to replace, and it fired where nobody could see it. The
 * same chain is now the control's INITIAL VALUE, where the owner can read it
 * and correct it. Keeping a copy here as well would be a second chain that has
 * to agree with the first and says nothing when it stops: the rule §9 step 3
 * states for the precision — what the control shows is what gets applied —
 * spelled for the offset.
 */
function toOffsetDateTime(local: string, offset: string): string | undefined {
  const parts = LOCAL_DATETIME.exec(local);
  if (!parts) return undefined;
  const wall = `${parts[1]}T${parts[2]}${parts[3] ?? ":00"}`;
  return `${wall}${offset}`;
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
 * This machine's clock, right now, as a wall clock with no offset on it.
 *
 * SPLIT OUT OF `nowWithOffset` FOR THE OFFSET CONTROL'S INITIAL VALUE, which
 * needs the offset of the current instant and has no wall clock of its own to
 * ask about: `occurred` is `""` on a create, and `offsetHere("")` is `+00:00`
 * rather than this machine's zone — measured, not reasoned about, because
 * `offsetHere` treats an unparseable date as zero minutes. A new entry
 * defaulting to UTC while the owner sits in Tokyo is the exact silent
 * wrong-offset bug the control exists to remove.
 */
function wallClockNow(): string {
  const at = new Date();
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  );
}

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
  const wall = wallClockNow();
  return `${wall}${offsetHere(wall)}`;
}

/**
 * THE OFFSETS ACTUALLY IN USE, west to east, and the odd ones are the point.
 *
 * `+05:45` is Nepal, `+08:45` is Eucla, `+12:45` is the Chathams, `-09:30` is
 * the Marquesas, `+05:30` is India. A list of whole hours makes those places
 * unwritable, which for a travel diary is the wrong corner to cut, and it is
 * also why this is a `<select>` over a fixed list rather than a stepper: a
 * numeric control that admits `+05:45` admits `+05:61` with it.
 *
 * BOTH HALVES OF A ZONE'S YEAR, AND THIS LIST WAS WRONG ON THAT TWICE OVER
 * UNTIL 2026-09-07 (F2). `-02:30` is Newfoundland DAYLIGHT Time, May to
 * November, and `-03:30` — the same island in the other half of its year — was
 * already here. `+13:45` is Chatham DAYLIGHT Time, September to April, beside
 * the `+12:45` the paragraph above names as one of the odd ones the list exists
 * for. So two of the places argued for were writable for half a year each, and
 * the cost is not a wall clock — §7.3's guarantee survives: the owner writing
 * up the Chathams in January picks the nearest offered value and the INSTANT is
 * an hour out, which is what any cross-trip ordering uses. Nothing on screen
 * says so, and `offsetOptions`' union cannot rescue it either, because on a
 * create there is no stored value and no photo to supply one.
 *
 * "ACTUALLY IN USE" IS A MEASURED CLAIM AS OF THAT DATE, AND THE WAY IT WAS
 * WRONG IS WORTH MORE THAN THE TWO STRINGS. Task 2's review verified this list
 * programmatically *against the brief text*, so the brief was the oracle rather
 * than the world — and neither could name a value neither of them knew about.
 * The oracle is the set of offsets in real civil use, daylight ones included;
 * the durable form of the claim is `ODD_OFFSETS` in components/studio/entry-editor/entry-editor.test.tsx,
 * which lists the non-whole-hour zones and goes red if one stops being offered.
 * A COUNT IS NOT THE CLAIM, so there is none here: the length moved the moment
 * these two were added and it moves again the next time a legislature moves a
 * zone.
 *
 * `+00:00`, NEVER `Z`. Both are valid `xsd:dateTime` offsets and mean the same
 * instant, but §6 and lib/pod/rdf.ts want the explicit spelling and `offsetOf`
 * normalises a stored `Z` onto it — so a list offering `Z` would be a second
 * spelling of one value, and the control would blank on every entry written
 * with the other one.
 *
 * IN ORDER, RATHER THAN SORTED AT USE. The strings do not sort into this order:
 * `-` precedes `+` in ASCII, so a string sort puts the western hemisphere first
 * and then orders it backwards, `-01:00` before `-12:00`. `offsetMinutes` below
 * is the comparator for the one case that cannot be written out here — an
 * offset the entry carries that is not on this list.
 */
const OFFSETS = [
  "-12:00", "-11:00", "-10:00", "-09:30", "-09:00", "-08:00", "-07:00",
  "-06:00", "-05:00", "-04:00", "-03:30", "-03:00", "-02:30", "-02:00",
  "-01:00", "+00:00", "+01:00", "+02:00", "+03:00", "+03:30", "+04:00",
  "+04:30", "+05:00", "+05:30", "+05:45", "+06:00", "+06:30", "+07:00",
  "+08:00", "+08:45", "+09:00", "+09:30", "+10:00", "+10:30", "+11:00",
  "+12:00", "+12:45", "+13:00", "+13:45", "+14:00",
] as const;

/** What an offset has to LOOK like to be one, which is a wider fence than
 *  `OFFSETS` on purpose: `+05:15` is not a zone anyone uses today and an entry
 *  can still carry it, because some other tool wrote it. This editor's job is
 *  to show such a value and put it back unchanged — so the shape is what is
 *  checked, and the list is only what is OFFERED. */
const OFFSET_SHAPE = /^[+-]\d{2}:\d{2}$/;

/** `+05:45` → 345, `-09:30` → -570. A sort key and nothing else: no triple
 *  carries minutes, and `toOffsetDateTime` concatenates the string itself. */
function offsetMinutes(offset: string): number {
  const sign = offset.startsWith("-") ? -1 : 1;
  return sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
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

/**
 * THE PROVENANCE NOTE'S END OF THE ASSOCIATION — one element for the PAIR, not
 * one per box, and both boxes point at it.
 *
 * ONE, BECAUSE THE COORDINATE IS ONE VALUE. A latitude and a longitude are two
 * halves of one point: `coordinateAuthor` records a single author for the pair
 * (a photo can never supply half a coordinate — lib/media/exif.ts sets `gps`
 * only when both tags are present — so mixing sources is something only the
 * owner could cause, and refusing both boxes is the cure), and two sentences
 * saying the same thing beside each other is noise for anyone hearing them read
 * out one after the other.
 *
 * `aria-describedby`, THROUGH `coordinateHelp`, AND NOT AN `aria-label` ON A
 * WRAPPER. This file has the receipt for the wrapper spelling: a
 * `<section aria-label="Photos">` around the picker made six tests fail with
 * "found multiple elements", because a wrapper with a name shadows the control
 * inside it. A description adds no accessible name and cannot collide with any
 * label on the form.
 *
 * NOT RENDERED WHEN THERE IS NOTHING TO SAY, for `COORDINATE_NOTE_ID`'s reason:
 * an id naming an element that is not there computes to the empty string,
 * silently, and an attribute left on permanently announces provenance for a
 * number the owner has since typed themselves.
 */
const COORDINATE_SOURCE_ID = "entry-coordinate-source";

/** Names the FILE, which is what the owner recognises — the photo has no other
 *  name on screen, and its `contentUrl` is a content-addressed hash nobody can
 *  read. The second sentence is there because the first one otherwise reads as
 *  a hold: the boxes are live, and typing replaces this. */
const coordinateSourceNote = (name: string) =>
  `Latitude and longitude came from ${name}. Type in either box to replace them.`;

/**
 * THE TIMESTAMP'S THREE NOTES, ONE PER CLAIM — `COORDINATE_SOURCE_ID`'s shape
 * and all of its reasons: `aria-describedby` from the control itself and never
 * an `aria-label` on a wrapper (a `<section aria-label="Photos">` around the
 * picker once cost this file six tests, because a named wrapper shadows the
 * control inside it), and each one RENDERED EXACTLY WHEN SOMETHING POINTS AT
 * IT, because an id naming an element that is not there computes to the empty
 * string — silently, with nothing on screen to show for it.
 *
 * THREE, BECAUSE THERE ARE THREE CLAIMS AND THEY STOP BEING TRUE AT THREE
 * DIFFERENT MOMENTS. One element per claim is what makes each of them
 * removable on its own; a single sentence covering all three would have to
 * outlive the shortest-lived thing in it.
 *
 *   `OCCURRED_SOURCE_ID` — "the time came from a.jpg". Dies at the first
 *     keystroke in the clock: §11.3's provenance rule (the owner is told a
 *     photo supplied a value, "so a wrong pin is attributable to the photo
 *     instead of to the editor") is what puts it there, and the coordinate's
 *     rule — "a note left standing beside a number the owner typed over is a
 *     claim they have no way to check" — is what takes it away.
 *   `OFFSET_SOURCE_ID` — "the offset came from a.jpg". §11.3 again, for the
 *     half a modern phone does write. Dies when the owner chooses an offset.
 *   `OFFSET_GUESS_ID` — "the offset beside this time is this machine's guess"
 *     (§11.5). Dies ONLY when the offset acquires an author, which is ruling
 *     T4-G: a keystroke in the CLOCK says nothing about who supplied the
 *     OFFSET, so the warning is still true after one and stays. It loses the
 *     photo's NAME at that keystroke, for `OCCURRED_SOURCE_ID`'s reason, and
 *     keeps saying the thing that is still checkable.
 *
 * WHY §11.3's CREDIT IS NOT OPTIONAL HERE, recorded because this file argued
 * the other way for a day: the guess mark is `null` whenever the photo supplied
 * BOTH halves, so a camera reset to factory time publishes a wrong
 * `dy:occurredAt` — the most load-bearing fact on the entry — attributable to
 * the editor rather than to the file. §11.5 is silent about provenance because
 * it does not restate its parent, exactly as it does not restate "never
 * overwrites"; reading that silence as a withdrawal would withdraw the
 * no-overwrite rule with it.
 *
 * AND THE SENTENCES ARE ONE HALF OF THE GUESS; THE `data-offset-unconfirmed`
 * ATTRIBUTE ON THE CONTROL IS THE OTHER. Wording alone cannot carry that state,
 * and this control is the proof: its PERMANENT hint already says the offset is
 * "not of wherever you are writing this", so a reader — or a test — fenced on
 * phrasing would find the same words in the confirmed cases as in the guessed
 * one. Every one of these is written by `creditTime`, which is what stops them
 * drifting from each other or from the records.
 */
const OCCURRED_SOURCE_ID = "entry-when-source";
const OFFSET_SOURCE_ID = "entry-offset-source";
const OFFSET_GUESS_ID = "entry-offset-guess";

/** Names the FILE, which is the only name a photo has on screen — its
 *  `contentUrl` is a content-addressed hash nobody can read. The second
 *  sentence is there because the first otherwise reads as a hold: the control
 *  is live, and typing replaces this. `coordinateSourceNote`'s shape. */
const occurredSourceNote = (name: string) =>
  `The time came from ${name}. Type in the box to replace it.`;

const offsetSourceNote = (name: string) =>
  `The offset came from ${name}. Choose another to replace it.`;

/**
 * THE GUESS, AND IT SAYS WHICH HALF THE PHOTO DID NOT SUPPLY rather than only
 * where the value came from: §11.5's whole argument is that `21:38 +02:00`
 * reads as data in both halves, so a note that credited the photo without
 * saying that would leave the owner unable to act on it.
 *
 * `null` IS THE STATE AFTER THE OWNER TYPES IN THE CLOCK, not a missing name.
 * The claim "the offset is not from a.jpg" needs a.jpg's clock to still be in
 * the box to mean anything; the claim "the offset is this machine's guess" does
 * not, and it is the one that is still true (T4-G). So the name goes and the
 * warning stays, in one sentence that no longer promises something the owner
 * cannot check.
 */
const offsetGuessNote = (name: string | null) =>
  name === null
    ? `The offset is this machine's guess for the time above, not the time zone of the place ` +
      `it happened in. Choose that offset if it was somewhere else.`
    : `The offset is not from ${name} — the photo carries no time zone of its own, so this is ` +
      `this machine's guess. Choose the offset of the place it happened in.`;

/**
 * WHO PUT THE COORDINATE IN THE BOXES — the record §11.3 turns on, and a
 * different question from `touchedCoordinate`.
 *
 * `touchedCoordinate` (in `save()`) is `lat.trim() !== "" || long.trim() !== ""`
 * and is HALF of what decides whether a coordinate is WRITTEN AT ALL: the other
 * half is pair-completeness — ruling F-A — which sits at the composition beside
 * it rather than inside it, because half a pair is not a point and `Number("")`
 * is `0`. An auto-filled coordinate should be written, so neither of those must
 * be given this record's meaning. This one decides whether auto-fill MAY WRITE
 * HERE, and the three answers are not reducible to two:
 *
 *   nobody — nothing has supplied a coordinate: the boxes are empty, no photo
 *            has offered one, and the entry being edited, if there is one, has
 *            none either. Fill.
 *   owner  — the owner typed, or accepted a restored draft that holds a
 *            coordinate, OR THE ENTRY ARRIVED WITH ONE. Never overwrite: a
 *            photo picked afterwards would silently replace a place they CHOSE
 *            with the place a camera happened to be, and §9 would then fuzz and
 *            publish it, so the only surface showing the substitution would be
 *            a public triple.
 *   photo  — an earlier photo filled it. Never overwrite either, which is the
 *            direction §11.3 names explicitly: filling on every `ready` moves
 *            the entry to wherever the LAST picture was taken, a different
 *            place every time one is added on a day's walk, with the note
 *            updating politely as it goes.
 *
 * IT IS EXPLICIT RATHER THAN INFERRED FROM EMPTINESS, IN BOTH DIRECTIONS — and
 * the second direction was a live defect for a day (ruling T3-B) before it was
 * written down here.
 *
 * A box can be NON-EMPTY because the owner typed, because a photo filled it, or
 * because a draft was restored into it; the first two forbid a fill, and the
 * value alone tells none of them apart. AND A BOX CAN BE EMPTY AND STILL FORBID
 * ONE: on an EDIT both boxes start empty by design — see the `lat` state, which
 * explains that prefilling the stored pair would walk the pin — and `save()`
 * reads empty as "leave the stored coordinate alone". So on an edit emptiness
 * does not mean "there is no value"; it means "the value on the Pod stands",
 * and filling it IS an overwrite of something the owner has not touched, merely
 * spelled as an offer. The latitude's own hint promises exactly that: "Leave
 * both boxes empty to keep the coordinate this entry already has."
 *
 * WHAT GETTING THAT WRONG COSTS IS PUBLISHED DATA, not a convenience. The fill
 * flips `touchedCoordinate` to true, `fuzzed()` runs, and `placeFor` reads a
 * `drop` as a REMOVAL — so a photo taken inside the home region, which is the
 * ordinary case of attaching a picture from home to an entry you are
 * correcting, takes the entry's `#geo` off a world-readable resource and off
 * the §7.4 index row the public trip page renders its pin from. No message, no
 * failed save, both boxes exactly as they were. A photo taken elsewhere is the
 * same shape one step less destructive: the pin MOVES to wherever the picture
 * was taken.
 *
 * "Is it empty?" therefore cannot answer this question in either direction,
 * which is why the record is a value in its own right and is SEEDED FROM THE
 * ENTRY rather than from the form.
 */
type CoordinateAuthor = { kind: "nobody" } | { kind: "owner" } | { kind: "photo"; name: string };

/**
 * WHO SUPPLIED EACH HALF OF THE TIMESTAMP — `CoordinateAuthor`'s question, with
 * its three answers and its whole argument for asking it explicitly rather than
 * reading it off an empty box, asked TWICE.
 *
 * TWO RECORDS, NOT ONE, AND THE SYMMETRY WITH THE COORDINATE IS THE TRAP
 * (ruling T4-C). `coordinateAuthor` is deliberately ONE record for a pair,
 * because a latitude from the owner beside a longitude from a photo is a point
 * that is nowhere. A timestamp does not compose that way: a wall clock is "the
 * time at the place" and the offset is "the place's zone", so the owner
 * correcting WHEN while the photo supplies WHERE is coherent, and so is the
 * reverse. Fusing them into one flag would refuse a fill that is honest and buy
 * nothing at all.
 *
 * SEEDED FROM THE ENTRY, AND THAT CONDITION IS RULING T4-B — the defect
 * `coordinateAuthor` shipped with for a day (T3-B), on a field where it is
 * worse shaped. `occurred` and `offset` are NOT empty on an edit: both are
 * seeded from `existing.occurredAt`, so "nothing has been typed here" cannot
 * mean "there is nothing here". A record reading `nobody` on an edit lets a
 * photo replace `dy:occurredAt` — "when the moment happened", the single most
 * load-bearing fact on a travel diary entry — with the value it replaced
 * visible on screen the whole time. The coordinate's version of this at least
 * hid behind an empty box.
 *
 * AND IT IS NOT `initial === undefined ? nobody : owner`, WHICH IS THE LAZY
 * SPELLING THE FIX ROUND MEASURED: it switches auto-date off for every edit ever
 * made, silently, while every refusal a test can make of these records still
 * passes. What separates the two is the ALLOW-CASE — an edit of an entry with
 * no `dy:occurredAt` at all (the field is `.optional()`), where there is nothing
 * to protect and the photo may still date it.
 *
 * `nobody` MEANS ONE MORE THING ON THE OFFSET THAN IT DOES ON THE CLOCK, and
 * `offsetGuess` is what does something with it: the offset control always shows
 * a value, so an unauthored offset is not an absence — it is
 * `offsetHere(wallClockNow())`, THIS MACHINE'S GUESS, which is the state §11.5
 * says the owner must be able to see.
 *
 * AND `photo` CARRIES TWO THINGS AS OF 2026-09-07 — ruling T4-E, and the
 * correction it needed the same day. A fill has to ask not only WHETHER the
 * other half is a photo's but WHOSE: photo A's clock beside photo B's zone is
 * the one composition in this task with no authority anywhere in it (see
 * `offerTimestamp`). T4-E asked that question with the FILE NAME — and
 * `PhotoSlot`'s docblock, further down this file, says a file name is not an
 * identity: the picker is `multiple`, it deduplicates nothing, and two cameras
 * both calling their first photo `IMG_0001.jpg` walked back through the guard
 * as one file. So the COMPARISON is on `key`, the per-editor slot identity
 * `attach` mints and React reconciles on, unique by construction; `name` stays
 * for the NOTES, which are §11.3's sentences and want the file the owner
 * recognises. `CoordinateAuthor` needs no `key` — it uses the name for display
 * only and never compares it.
 */
type TimeAuthor =
  | { kind: "nobody" }
  | { kind: "owner" }
  | { kind: "photo"; key: string; name: string };

/** Everything `Place` holds. `lib/pod/schema.ts` exports the Zod object but no
 *  type for it, and this file imports no Zod. */
type EntryPlace = NonNullable<Entry["place"]>;

/** The three things this form can SAY about a place, as terms rather than as
 *  form strings: the empty box has already become `undefined` by the time one
 *  of these is built, because `""` is not a name — see `placeTextOf`. */
type PlaceText = Pick<EntryPlace, "name" | "locality" | "country">;

/**
 * The place to write, given whatever the entry already had, whatever the fuzz
 * allowed, and whatever the three text controls are holding.
 *
 * `undefined` IS A REMOVAL, NOT AN OMISSION, ON ALL FOUR FIELDS. That is the
 * half that is easy to miss on an EDIT: the entry being edited may already
 * carry a `#geo` or a `schema:name`, and spreading the old place in and merely
 * failing to add a new value leaves the old one on a world-readable resource —
 * a leak, or a name the owner has deleted from the form and cannot delete from
 * their Pod, either way outliving the edit made to remove it.
 *
 * THE FOUR ARE REMOVED INDEPENDENTLY, which is why the geometry and the text
 * arrive as separate arguments and are never folded into one flag. Clearing a
 * name must not take the coordinate with it, and §9's drop must not take the
 * name: "it is the geometry that is absent, not the entry." The original
 * comment here said the same thing about growth — "a `Place` that grows one
 * must not lose it every time a coordinate is dropped" — and the spread of
 * `existing` below is still what keeps that true for a fifth field this form
 * does not hold.
 *
 * THAT SENTENCE NAMED A "copy-and-delete shape" UNTIL 2026-09-07 (F7), AND
 * THERE IS NO DELETE. The behaviour it claims is real, but the mechanism was
 * removed as a no-op — see the comment inside the body, which says so in as
 * many words and therefore contradicted this one. Correct behaviour defended by a
 * false reason is the shape both halves of this pair were an instance of: the
 * loop that stood here had a comment claiming it did something, and its removal
 * left a docblock claiming it was still there.
 *
 * A place with nothing left in it is no place at all rather than an empty
 * `<#place>` node, which would be a `schema:Place` asserting nothing.
 */
function placeFor(
  existing: EntryPlace | undefined,
  geo: EntryPlace["geo"],
  text: PlaceText,
): EntryPlace | undefined {
  // Start from what the entry already had, so a field this form does not hold
  // survives; then let this save's answer overwrite it, `undefined` INCLUDED.
  // Spreading `undefined` over a stored value is what makes a removal a
  // removal rather than an omission, so this is not a merge and must not
  // become one.
  const place: EntryPlace = { ...existing, ...text, geo };
  /* A KEY PRESENT WITH AN `undefined` VALUE IS NOT CONTENT, and needs no
     delete pass to say so — a loop that deleted them stood here and was a
     no-op with a comment claiming otherwise, which is worse than either half
     alone. `Object.values({ name: undefined }).some((v) => v !== undefined)`
     is already `false`, so an emptied place is `undefined` here rather than a
     bare `<#place>` asserting nothing; and `lib/pod/entry-model.ts` guards
     every field on truthiness or `!== undefined` before it writes a triple, so
     the surviving keys produce no triples either. */
  return Object.values(place).some((value) => value !== undefined) ? place : undefined;
}

/**
 * The three boxes as RDF terms, with `""` MEANING REMOVE.
 *
 * The one place `""` and `undefined` are translated between, and the reason it
 * is a function rather than three ternaries inlined in `save()`: they are
 * different instructions on three fields, and a spelling that got one of them
 * wrong would either publish `""@en` — an entry claiming to be somewhere called
 * nothing — or make a name impossible to retract once written.
 *
 * TRIMMED, AND NOTHING DOWNSTREAM WOULD CATCH IT IF IT WERE NOT. `Place.name`
 * is `min(1)` and `" ".length === 1`, so `Place.safeParse({ name: { value: " " } })`
 * SUCCEEDS — measured, not assumed. An untrimmed one-space box therefore
 * publishes `schema:name " "@en` on a world-readable resource: a name that
 * renders as nothing everywhere, that no reader can see to delete, and that a
 * `value === ""` check does not find either. Every guard between here and the
 * Turtle asks "is it absent", and a space is not absent. This is the guard.
 *
 * THE LANGUAGE IS THE ENTRY'S OWN, exactly as the headline and the body get it,
 * so an entry written in another language keeps its tag. `locality` and
 * `country` carry none here: the locality is tagged by `text()` at
 * serialisation, and the country is a CODE and is deliberately untagged —
 * `"JP"@en` is a different RDF term from `"JP"`, so every consumer filtering on
 * the plain literal would stop matching entries this studio wrote (§7.3).
 */
const placeTextOf = (
  form: { placeName: string; locality: string; country: string },
  language: string,
): PlaceText => ({
  name:
    form.placeName.trim() === "" ? undefined : { value: form.placeName.trim(), language },
  locality: form.locality.trim() === "" ? undefined : form.locality.trim(),
  country: form.country.trim() === "" ? undefined : form.country.trim(),
});

/* ═══════════════════════════════════════════════════════════════ the photos ══ */

/**
 * ONE PICKED FILE, IN THE FOUR STATES IT PASSES THROUGH.
 *
 * A STATE MACHINE RATHER THAN A `Photo | null` PLUS A FLAG, because the owner
 * has to be able to tell three different waits apart from a failure — and
 * because only `ready` may be saved. Every slot the entry is allowed to
 * reference carries its `Photo`, so there is no branch anywhere in which a
 * half-finished upload can be serialised: the shape refuses it rather than a
 * condition remembering to.
 *
 * `key` IS NOT THE FILE NAME. Two files picked from two directories can share
 * one, and the same file can be picked twice while the first is still decoding;
 * a name-keyed list would then update the wrong row. React's reconciler needs a
 * stable identity here too, since a slot moves through three renders.
 */
type PhotoSlot =
  | { key: string; name: string; state: "decoding" }
  | { key: string; name: string; state: "uploading" }
  | { key: string; name: string; state: "ready"; photo: Photo }
  | { key: string; name: string; state: "failed"; message: string };

/** What a restored draft can still say about a photo whose file name is long
 *  gone: the caption if it has one, and its position otherwise. `Photo` has no
 *  file-name field on purpose — §7.3 describes the resource, not the pick. */
const restoredName = (photo: Photo, index: number) =>
  photo.caption?.value ?? `Photo ${index + 1}`;

/**
 * The photos the entry will carry: the ones it arrived with, then the ones
 * picked in this editor, in the order they were picked.
 *
 * PICKING APPENDS; IT NEVER REPLACES. An edit that rewrites the resource
 * without the photos it arrived with destroys them silently — and for photos it
 * destroys the binaries' only reference too, since nothing else on the Pod
 * points at `travel/media/<hash>/`. Pick nothing and `carried` travels through
 * exactly as it arrived, which is the treatment `created`, `datePublished` and
 * the place already get.
 *
 * ONCE EACH, HOWEVER MANY TIMES IT IS PICKED. The media path is
 * content-addressed, so re-picking a photo the entry already carries uploads
 * nothing new — `putGuarded` answers 412 and `uploadPhoto` reads that as reuse —
 * and returns the SAME `contentUrl`. Appending it blindly would write two
 * `#photo-N` fragments pointing at one binary: the same picture twice on the
 * public listing, and, with no removal control in this editor, nothing the owner
 * can do about it except abandon the edit. The `Set` covers both ways in, since
 * the same file picked twice in one session is the same defect on a create,
 * where there is nothing carried to compare against.
 *
 * `sortOrder` IS THE POSITION AT SAVE TIME, NOT AT PICK TIME, so a file the
 * pipeline refused leaves no gap in the sequence — and the CARRIED photos keep
 * the numbers they were stored with, because renumbering them would rewrite
 * §7.3 data the owner never touched.
 *
 * WHICH NUMBER IS FREE IS NOT `carried.length`, AND THAT IS MEASURED RATHER
 * THAN ARGUED. lib/pod/entry-model.ts writes `photo.sortOrder ?? i + 1` — a
 * carried photo with no number of its own is serialised with its ONE-BASED
 * POSITION, not left unwritten — so a list of one unnumbered photo is written as
 * `dy:sortOrder 1`, and `carried.length` is 1: the collision, in the very case
 * the fallback exists for. So the seed is what the serialiser will actually
 * write, and the sequence is one-based like every other `dy:sortOrder` in §7.3
 * (`#photo-1` carries 1). The `0` seed is what makes a first photo on a create
 * come out as 1 rather than 0.
 */
function photosFor(carried: readonly Photo[], attached: readonly Photo[]): Photo[] {
  const already = new Set(carried.map((photo) => photo.contentUrl));
  const fresh: Photo[] = [];
  for (const photo of attached) {
    if (already.has(photo.contentUrl)) continue;
    already.add(photo.contentUrl);
    fresh.push(photo);
  }

  const highest = carried.reduce((best, photo, at) => Math.max(best, photo.sortOrder ?? at + 1), 0);
  return [...carried, ...fresh.map((photo, at) => ({ ...photo, sortOrder: highest + 1 + at }))];
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
 * can change on purpose — components/studio/entry-editor/entry-editor.test.tsx drives the window and pins
 * it against this export so the two cannot drift.
 */
export const DRAFT_DEBOUNCE_MS = 800;

/** The scope of a create (`lib/studio/drafts.ts`): there is no resource yet to
 *  name, so every create in this browser shares one draft. */
const NEW_DRAFT_SCOPE = "new";

/** The sixteen fields the FORM holds — `Draft` minus the stamp, which is put on
 *  at the moment of the write and never earlier (§6). It read "twelve" until
 *  2026-09-07, having missed `photos`, the three place fields and `offset`. */
type DraftText = Omit<Draft, "savedAt">;

/**
 * Two photo lists, compared by the only identity a photo has: where it lives on
 * the Pod.
 *
 * BY `contentUrl` RATHER THAN BY VALUE, and the difference is not laziness. The
 * URL is content-addressed — `travel/media/<sha256(source)[0..16]>/` — so two
 * entries with the same URL are the same bytes, and nothing else about a photo
 * can change without the owner picking a different file. Order matters because
 * `sortOrder` is the position, so a reordering is a change.
 */
const samePhotos = (a: readonly Photo[], b: readonly Photo[]) =>
  a.length === b.length && a.every((photo, at) => photo.contentUrl === b[at]?.contentUrl);

/**
 * Have the sixteen fields moved between two snapshots?
 *
 * Field by field rather than `JSON.stringify`, which would answer "different"
 * for the same sixteen values in a different key order. The consequence of a
 * false "different" is not cosmetic: it is a local copy written back for text
 * the Pod already holds, which is exactly the resurrected draft the clear after
 * a save exists to prevent.
 *
 * The three coordinate fields are in here for the same reason the other nine
 * are: they are what the form holds. A comparison that skipped them would call
 * a form whose only change was the latitude "unchanged" and drop that change
 * from the local copy — the one field on this screen nobody can retype from
 * memory a day later. So are the three place fields, and there the loss is the
 * one §9 leans on: near home the coordinate is dropped and the NAME is all the
 * entry has left to say where it was.
 *
 * So are the photos, and there the consequence is worse than retyping: a photo
 * attached while the Pod was answering is bytes that are already uploaded and
 * about to be referenced by nothing at all.
 *
 * And so is the offset, which is half of the timestamp: an offset corrected
 * while the Pod was answering, dropped from this comparison, would leave the
 * local copy holding the guess the owner had just replaced.
 */
const sameText = (a: DraftText, b: DraftText) =>
  a.tripIri === b.tripIri &&
  a.slug === b.slug &&
  a.headline === b.headline &&
  a.story === b.story &&
  a.occurred === b.occurred &&
  a.offset === b.offset &&
  a.tagsText === b.tagsText &&
  a.mode === b.mode &&
  a.status === b.status &&
  a.lat === b.lat &&
  a.long === b.long &&
  a.precision === b.precision &&
  a.placeName === b.placeName &&
  a.locality === b.locality &&
  a.country === b.country &&
  samePhotos(a.photos, b.photos);

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
 *
 * TAKES A `string`, NOT `string | undefined`, AND STAYS THAT WAY (task 2.5):
 * `lib/studio/drafts.ts`'s `Draft.savedAt` became `.optional()`, but this
 * function's one caller only reaches it inside an `offered.savedAt !==
 * undefined` check (ruling 2.5-A, below), so the absent case never arrives
 * here at all rather than arriving and being handled.
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
  podRoot,
  pipeline,
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
  /**
   * THE OTHER HALF OF THE TIMESTAMP, AND NOW AN ANSWER RATHER THAN A GUESS.
   *
   * §7.3: `dy:occurredAt` "carries the local UTC offset of the place", because
   * normalising to UTC destroys the fact that it was evening. Until this state
   * existed the offset was computed at save time as
   * `offsetOf(existing?.occurredAt) ?? offsetHere(wall)` — the entry's own,
   * else THE EDITING MACHINE'S — so writing up a Japan trip from the sofa at
   * home stamped an evening in Tokyo `+02:00`, silently, and no control on the
   * form could correct it.
   *
   * THE INITIAL VALUE IS THAT SAME CHAIN, UNCHANGED. The behaviour has not
   * moved; the guess has become visible and correctable, which is the whole
   * change. On an edit it is the offset the entry already carries, so an edit
   * that never opens this control writes the timestamp back exactly as stored.
   *
   * `wallClockNow()` RATHER THAN `occurred`, and that is not interchangeable:
   * `occurred` is `""` on a create and `offsetHere("")` is `+00:00`, not this
   * machine's zone. The control has a value at MOUNT, when there may be no date
   * on the form at all, so the honest wall clock to ask about is the current
   * instant.
   *
   * ONE CONSEQUENCE OF THAT, ON THE RECORD: in a zone with DST, a create
   * defaults to TODAY'S offset rather than the one in force on the date the
   * owner then types. The old code asked about the entry's own wall clock and
   * so got that right by accident, in the one case where its answer was
   * defensible at all. It is a fair trade because the value is now on screen
   * and one click from correct, where before it was neither.
   */
  const [offset, setOffset] = useState(
    () => offsetOf(existing?.occurredAt) ?? offsetHere(wallClockNow()),
  );
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

  /**
   * WHERE THE OWNER WAS, IN WORDS — and unlike the coordinate above, SEEDED
   * FROM THE ENTRY BEING EDITED.
   *
   * The asymmetry is the whole of the "untouched versus removed" logic for
   * text, so it is worth saying why it goes the other way. The stored
   * coordinate must not be prefilled because what is on the Pod is the
   * PUBLISHED pair, already snapped, and putting it in the box makes it
   * indistinguishable from something typed — so every save re-snaps it and the
   * pin walks. A name has no such transformation: what is on the Pod is exactly
   * what was typed, so showing it costs nothing and buys the two things the
   * coordinate has to buy with a separate `touchedCoordinate` flag. A box the
   * owner never opens still holds the stored value, so saving writes it back
   * unchanged — untouched. A box the owner EMPTIES holds `""`, which `save()`
   * turns into `undefined` and `placeFor` turns into a removal.
   *
   * Prefilling is therefore not a convenience here; it is what makes the two
   * instructions distinguishable at all. An editor that left these empty on an
   * edit would delete the place name of every entry whose headline was
   * corrected — silently, and only discoverable by reading the Pod.
   *
   * "SEEDED FROM THE ENTRY" STOPS BEING TRUE AT EXACTLY ONE MOMENT: `restore()`,
   * which writes these controls from a stored draft rather than from the entry.
   * That is where the missing flag would otherwise have been needed, and it is
   * handled there instead — a draft field that is ABSENT leaves the control
   * alone, and only an explicitly empty one empties it.
   */
  const [placeName, setPlaceName] = useState(existing?.place?.name?.value ?? "");
  const [locality, setLocality] = useState(existing?.place?.locality ?? "");
  /** A CODE, not prose (§7.3) — `schema:addressCountry` is written untagged,
   *  so what belongs in this box is `JP`, not `Japan`. */
  const [country, setCountry] = useState(existing?.place?.country ?? "");

  /**
   * THE PHOTOS PICKED IN THIS EDITOR, and NOT the ones the entry arrived with.
   *
   * Seeding this from `existing.photos` is the obvious spelling and is wrong
   * twice over. It would renumber their `sortOrder` from the list position on
   * every save, walking §7.3 data nobody touched — the same defect the `lat`
   * state's note describes for the coordinate — and each seeded row would
   * render a settled `role="status"` at mount, so the editor would announce, to
   * a screen reader, news about photos that have not changed. What the entry
   * arrived with is carried at save time instead, by `photosFor`.
   */
  const [slots, setSlots] = useState<PhotoSlot[]>([]);
  /** Slot identity, monotonic per editor. Not the file name, and not an index:
   *  see `PhotoSlot`. */
  const nextSlotKey = useRef(0);
  /**
   * HAS ANYBODY ACTUALLY TYPED? A ref, not state: it changes nothing on screen
   * and re-rendering for it would be noise.
   *
   * The autosave effect further down is keyed on the form values, so it fires
   * once on mount — and without this guard the editor would store a copy of
   * whatever it opened with. Opening an entry to read it and navigating away
   * would then leave an "Unsaved draft" banner waiting next time, offering to
   * restore exactly what is already on the Pod; once that banner appears for
   * entries nobody edited it stops meaning anything and gets clicked away by
   * reflex.
   *
   * DECLARED HERE, ABOVE `attach`, AND NOT DOWN IN THE DRAFT SECTION WHERE THE
   * REST OF ITS MACHINERY LIVES — because `attach` arms it when a slot settles,
   * and `react-hooks/immutability` refuses a `.current` write inside a function
   * that closes over a `useRef` declared BELOW it. Measured rather than
   * reasoned about: with the declaration left in the draft section, `npm run
   * lint` reported two errors, and neither was on the new line — it flagged the
   * PRE-EXISTING writes in `settleDraft` and in the form's `onChange`, both of
   * which had been clean for the life of the file. Moving this one line up made
   * all three legal again. `nextSlotKey` is the same kind of ref mutated from
   * the same `attach`, and is declared just above for the same reason.
   */
  const touched = useRef(false);

  /**
   * WHO SUPPLIED THE COORDINATE — see `CoordinateAuthor` for what the three
   * answers mean and why "is the box empty?" is not one of them.
   *
   * A REF, AND READ AT THE MOMENT OF THE FILL RATHER THAN FROM A CLOSURE. This
   * is `touched`'s reason plus one more that is specific to this record. A fill
   * happens in `attach`'s continuation, after two awaits — the decode and two
   * PUTs — and the handler that started it closed over the render BEFORE the
   * pick. So a closure would answer "who supplied the coordinate?" as of a
   * moment that can be several seconds old, and the two things that can happen
   * inside that window are exactly the two this record exists to refuse: the
   * owner typing while the photo uploads, and a second photo settling. Reading
   * a ref written synchronously means the first writer wins even when the two
   * writers overlap.
   *
   * DECLARED HERE, ABOVE `attach`, for the reason `touched`'s note gives at
   * length: `react-hooks/immutability` refuses a `.current` write inside a
   * function that closes over a `useRef` declared below it, and it reports the
   * pre-existing writes rather than the new declaration when you get it wrong.
   *
   * SEEDED FROM THE ENTRY, AND THAT CONDITION IS THE WHOLE OF RULING T3-B.
   * `nobody` unconditionally is the spelling this shipped with for a day, and
   * it let a photo move — or, from inside the home region, DELETE — a pin an
   * edit was loaded with. See `CoordinateAuthor` for the mechanism; the short
   * version is that on an edit an empty box means "the stored pair stands", so
   * there is a value to protect even though the form holds none.
   *
   * IT IS `existing?.place?.geo`, NOT `lat`/`long`, AND NOT UNCONDITIONAL.
   * Both boxes are `""` on an edit by design, so seeding from them is the same
   * defect spelled differently. And an unconditional `{ kind: "owner" }` would
   * switch auto-fill off for EVERY edit, silently — including an entry that has
   * no pin to protect, which is the case with nothing to lose and the one place
   * the fill is still wanted on an edit. Every refusal a test can make of this
   * record passes under that lazy spelling; what catches it is the allow-case,
   * an edit of an entry with no geometry where the photo must still fill.
   */
  const coordinateAuthor = useRef<CoordinateAuthor>(
    existing?.place?.geo === undefined ? { kind: "nobody" } : { kind: "owner" },
  );
  /**
   * The same fact again, as state, because the note is RENDERED and a ref
   * changing re-renders nothing.
   *
   * THEY CANNOT DRIFT, BECAUSE THERE IS ONE WRITER: `creditCoordinate` below is
   * the only thing that assigns either, and it assigns both. This file argues
   * against two things that have to agree and say nothing when they stop — the
   * offset chain, the precision select — and the argument holds here: what makes
   * this pair safe is not that it is small, it is that neither member has a
   * setter of its own.
   */
  const [coordinateSource, setCoordinateSource] = useState<string | null>(null);
  /**
   * THE ONE WRITER. Everything that puts a coordinate in the boxes says so
   * through this: the two `onChange` handlers, `restore()`, and the auto-fill.
   *
   * The note follows the record rather than being cleared separately, so
   * "the owner has typed" and "the note has stopped being true" cannot come
   * apart — a note left standing beside a number the owner typed over is a
   * claim they have no way to check.
   */
  function creditCoordinate(to: CoordinateAuthor) {
    coordinateAuthor.current = to;
    setCoordinateSource(to.kind === "photo" ? to.name : null);
  }

  /**
   * WHO SUPPLIED THE WALL CLOCK, AND WHO SUPPLIED THE OFFSET — see `TimeAuthor`
   * for why these are two records rather than one, and for why they are seeded
   * from the entry rather than from the boxes.
   *
   * REFS, AND READ AT THE MOMENT OF THE FILL, for `coordinateAuthor`'s reason:
   * a fill happens in `attach`'s continuation, after the decode and two PUTs,
   * so a closure would answer "who supplied this?" as of a moment that can be
   * several seconds old — and the two things that happen inside that window are
   * exactly the two these records exist to refuse, the owner typing while the
   * photo uploads and a second photo settling.
   *
   * DECLARED HERE, ABOVE `attach`, for the reason `touched`'s note gives at
   * length: `react-hooks/immutability` refuses a `.current` write inside a
   * function that closes over a `useRef` declared BELOW it, and it reports the
   * pre-existing writes rather than the new declaration when you get it wrong.
   */
  const occurredAuthor = useRef<TimeAuthor>(
    existing?.occurredAt === undefined ? { kind: "nobody" } : { kind: "owner" },
  );
  const offsetAuthor = useRef<TimeAuthor>(
    existing?.occurredAt === undefined ? { kind: "nobody" } : { kind: "owner" },
  );
  /**
   * THE SAME TWO FACTS AGAIN AS STATE, BECAUSE THE NOTES ARE RENDERED and a ref
   * changing re-renders nothing — `coordinateSource`'s reason, twice. Which
   * photo the clock came from, and which the offset came from; `null` for a
   * value no photo supplied.
   */
  const [occurredSource, setOccurredSource] = useState<string | null>(null);
  const [offsetSource, setOffsetSource] = useState<string | null>(null);
  /**
   * IS THE OFFSET THIS MACHINE'S GUESS, STANDING BESIDE A CLOCK A PHOTO
   * SUPPLIED? §11.5's state, and the one the owner must be able to see.
   *
   * A BOOLEAN AND NOT A NAME, as of ruling T4-G. It held the photo's name until
   * 2026-09-07, which fused two facts with two lifetimes into one value: the
   * name is only checkable while the photo's clock is still in the box, and the
   * warning is true for as long as nobody has answered the offset. The name now
   * comes from `occurredSource` — so a keystroke in the clock takes the name
   * out of the sentence and leaves the warning standing.
   *
   * IT IS A RECORD, NOT A COMPARISON, and that is not a detail: marking the
   * offset whenever it equals `offsetHere(wallClockNow())` would tell an owner
   * who deliberately chose the zone they are sitting in — for most entries the
   * right answer — that their own choice is a guess.
   */
  const [offsetGuess, setOffsetGuess] = useState(false);
  /**
   * THE ONE WRITER for the two records and all three surfaces —
   * `creditCoordinate`'s deal, with more to keep true: the mark reads BOTH
   * records, so deriving it anywhere else would be a second copy of the rule
   * that says nothing when the two stop agreeing.
   *
   * THE TWO CREDITS ARE THE RECORDS, RESTATED. `photo` means a file supplied
   * this half and is named for it (§11.3); `owner` and `nobody` both mean
   * nothing on screen may credit a photo for it.
   *
   * THE MARK, IN ONE LINE: the offset is a guess while NOBODY has supplied it
   * and a photo has supplied the clock beside it. Three halves, all
   * load-bearing:
   *
   *   - `nobody` on the offset IS this machine's guess (see `TimeAuthor`), so
   *     the mark is ruling T4-A's "the displayed offset is the machine's own"
   *     without interrogating the value. On an edit the entry's stored offset is
   *     seeded `owner`, so a photo that lacks the tag casts no doubt on it —
   *     badging confirmed data because a photo said nothing is §11.5's error
   *     with the sign flipped.
   *   - `photo` on the wall clock is what makes this §11.5's composition rather
   *     than the ordinary default every create opens with. A photo that carried
   *     no time at all leaves the offset exactly as it was and has said nothing
   *     about it, so it marks nothing.
   *   - `|| was` IS RULING T4-G, and it is the whole of it. The clock's own
   *     `onChange` credits the owner, which used to clear the mark — so the
   *     owner nudging `07:05` to `07:06`, because they remember it was a minute
   *     later, left `07:06 +09:00` with §11.5's composition fully intact and
   *     the warning gone. A keystroke in the clock says nothing about who
   *     supplied the OFFSET, so the warning is still true; what it does say is
   *     that the note may no longer name the photo, and `occurredSource`
   *     handles that on its own line. Choosing an offset is what ends the mark,
   *     which is what scenario 3 says in words.
   *
   * A CALLER THAT CHANGES ONE RECORD PASSES THE OTHER'S CURRENT VALUE, which is
   * how two independent records (T4-C) share one writer without becoming one
   * flag.
   */
  function creditTime(occurredTo: TimeAuthor, offsetTo: TimeAuthor) {
    occurredAuthor.current = occurredTo;
    offsetAuthor.current = offsetTo;
    setOccurredSource(occurredTo.kind === "photo" ? occurredTo.name : null);
    setOffsetSource(offsetTo.kind === "photo" ? offsetTo.name : null);
    setOffsetGuess((was) => offsetTo.kind === "nobody" && (occurredTo.kind === "photo" || was));
  }

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
   * shape components/studio/studio-shell/studio-shell.tsx uses for `enumerateTrips`, and
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
   * one, the note above while there is one, and — for the two BOXES — the
   * provenance note while a photo is credited with what they hold.
   *
   * Built rather than written out because EVERY HALF IS SILENT WHEN WRONG. An
   * id that names nothing computes to the empty string, and an attribute left
   * on permanently reads as correct markup while announcing a reason that has
   * stopped being true. `undefined` rather than `""` for the same reason: no
   * attribute at all is the honest spelling of "nothing to say".
   *
   * THE SOURCE NOTE IS PASSED IN RATHER THAN READ HERE, because it belongs to
   * two of the three controls and not to the third: the precision select is
   * about the grid a point is published in, and a photo has no opinion about
   * that. A helper that added it unconditionally would have the select announce
   * where a coordinate came from, which is true of neither its value nor its
   * effect.
   */
  const coordinateHelp = (ownHintId?: string, sourceNoteId?: string): string | undefined => {
    const ids = [
      ownHintId,
      coordinateNote === null ? undefined : COORDINATE_NOTE_ID,
      sourceNoteId,
    ].filter((id): id is string => id !== undefined);
    return ids.length === 0 ? undefined : ids.join(" ");
  };

  /** The provenance note's id while there is a note, for the two boxes to name.
   *  `undefined` is what keeps `coordinateHelp` from pointing at an element that
   *  is not rendered — the two are decided by the same value on purpose. */
  const coordinateSourceId = coordinateSource === null ? undefined : COORDINATE_SOURCE_ID;

  /**
   * EACH CONTROL'S PERMANENT HINT, PLUS WHATEVER IS CURRENTLY TRUE ABOUT WHERE
   * ITS VALUE CAME FROM — `coordinateHelp`'s shape, for its reason: every half
   * of this is silent when it is wrong. An id that names nothing computes to
   * the empty string, and an attribute left on permanently reads as correct
   * markup while announcing a reason that has stopped being true.
   *
   * THE HINT IS ALWAYS FIRST, so the credit or the warning is heard as an
   * addition to what the control is for rather than in place of it.
   *
   * ONE FUNCTION PER CONTROL RATHER THAN `coordinateHelp`'s PARAMETERS: there
   * are two controls and each has its own set of things that can be true of it,
   * and the guess note belongs to the offset alone — the clock is not in doubt,
   * it is the thing the offset is in doubt BESIDE.
   */
  const occurredHelp = (): string =>
    ["entry-when-hint", occurredSource === null ? undefined : OCCURRED_SOURCE_ID]
      .filter((id): id is string => id !== undefined)
      .join(" ");

  /* The guess and the credit are mutually exclusive by construction — the mark
     requires the offset to be NOBODY's and the credit requires it to be a
     photo's — but both are listed rather than branched, because that exclusion
     lives in `creditTime` and a second copy of it here is a second thing to
     keep true. */
  const offsetHelp = (): string =>
    [
      "entry-offset-hint",
      offsetGuess ? OFFSET_GUESS_ID : undefined,
      offsetSource === null ? undefined : OFFSET_SOURCE_ID,
    ]
      .filter((id): id is string => id !== undefined)
      .join(" ");

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
   * What the offset control offers: `OFFSETS`, plus whatever it is
   * currently holding.
   *
   * `precisionOptions`' SHAPE EXACTLY, including why it is a `Set`. It does not
   * special-case the value it cannot offer — it unions the held value into the
   * list, and the `Set` is what stops an offset that IS on the list appearing
   * twice. That single shape covers all three things this control has to do
   * with `+05:15`: render it rather than blanking, survive an edit that never
   * touched it, and not duplicate `+09:00`.
   *
   * SILENT SUBSTITUTION IS THE FAILURE THIS PREVENTS, AND IT IS NOT THE BLANK
   * CONTROL EVERYONE EXPECTS — measured, on this file's own tests, by deleting
   * the `add` above and rendering an entry stored with `+05:15`: the control
   * showed **`-12:00`**, the FIRST option, not an empty box. React marks no
   * option as selected when the value matches none of them, and a single
   * `<select>` with nothing selected displays and reports its first option. So
   * the failure mode is an offset the owner never chose, in a control that
   * looks answered.
   *
   * THE UNION IS THEREFORE UNCONDITIONAL, which is where this parts company
   * with `precisionOptions`: that one adds `gridOf(precision)` only when it is
   * a usable grid, because §9 step 3 refuses a precision the select cannot show
   * and the value is validated again at save time. Here what the control shows
   * has to equal what `toOffsetDateTime` concatenates for EVERY state it can be
   * in, including one no code path can produce — a shape check on this line
   * would buy a tidier option list at the price of a control disagreeing with
   * the timestamp it is about to write.
   *
   * SORTED BY MINUTES, because `OFFSETS` is already in order and the one value
   * that may not be on it has to land WHERE A READER WILL LOOK: `+05:15`
   * belongs between `+05:00` and `+05:30`, and appending it after `+14:00`
   * looks like a bug in the list. A string sort is not available — see
   * `offsetMinutes`.
   */
  const offsetOptions = useMemo(() => {
    const all = new Set<string>(OFFSETS);
    all.add(offset);
    return [...all].sort((a, b) => offsetMinutes(a) - offsetMinutes(b));
  }, [offset]);
  const trip = trips.find((t) => t.iri === tripIri);
  /** The address is fixed once the resource exists: this editor writes, and
   *  moving a resource is a copy and a delete it does not do. */
  const addressFixed = target !== null;

  /* ─────────────────────────────────────────────────── the photo pipeline ── */

  /**
   * THE ONE THIS COMPONENT CREATED, AND NOTHING ELSE EVER GOES IN HERE.
   *
   * That is what makes the cleanup below safe. `Pipeline.dispose()` is not a
   * cancel: it terminates the worker and rejects everything already pending, so
   * calling it on an instance a caller injected would break a photo that caller
   * is still processing. Whoever creates, disposes — so an injected `pipeline`
   * is returned as it is and never stored here.
   */
  const ownPipeline = useRef<Pipeline | null>(null);

  /** Lazily, on the first pick. A worker at mount costs a thread and a chunk on
   *  every edit, and most edits touch no photo at all. */
  function pipelineFor(): Pipeline {
    if (pipeline !== undefined) return pipeline;
    if (ownPipeline.current === null) ownPipeline.current = createPipeline();
    return ownPipeline.current;
  }

  useEffect(() => {
    /**
     * DISPOSAL, NOT TIDINESS: the worker holds a decoded bitmap, which for a
     * 50 MP photo is on the order of 200 MB, and an editor closed mid-decode
     * would otherwise leak it for the life of the tab.
     *
     * UNMOUNT IS THE ONLY CORRECT CALLER TODAY, and `Pipeline.dispose()`'s own
     * docblock says why: a photo queued but not yet pending is not in the map
     * to reject, so its send still runs, re-spawns a worker, and can resolve
     * after this returns. Harmless here — the component is going away — and a
     * defect anywhere else. A cancel button needs a generation counter first.
     *
     * `ownPipeline.current` is null under StrictMode's first cleanup unless a
     * photo was picked between the two effect invocations, so the double-invoke
     * is a no-op rather than a disposed pipeline the second mount inherits.
     */
    return () => {
      ownPipeline.current?.dispose();
      ownPipeline.current = null;
    };
  }, []);

  /**
   * The picked photos that have URLs on the Pod, in pick order.
   *
   * `ready` ONLY. This is what the draft keeps and what the save carries, so
   * the filter is the fence: a decoding slot has no `Photo` at all and a failed
   * one must not reach either, or the entry references a photo that 404s for
   * every reader.
   */
  const attached = useMemo(
    () => slots.flatMap((slot) => (slot.state === "ready" ? [slot.photo] : [])),
    [slots],
  );

  /**
   * §11.3, AND IT IS AN OFFER RATHER THAN AN ASSIGNMENT: a photo may fill a
   * coordinate nobody has supplied, and may never take one away.
   *
   * WHAT IT WRITES IS THE PHOTO'S OWN READING, AT FULL PRECISION, INTO THE
   * FORM. Not a rounded one, and not `place.geo`:
   *
   *   - THE FORM, because that is the only route to the Pod that goes through
   *     §9. `fuzzed()` runs at save time over whatever these two boxes hold, so
   *     a photo's GPS is snapped or dropped exactly as a typed one is, and
   *     nothing downstream needs to know which it was. Putting `metadata.gps`
   *     on the `Entry` instead would publish the exact spot a picture was
   *     taken — no render-time mitigation behind it, and no second chance after
   *     the PUT.
   *   - AT FULL PRECISION, because a value rounded on the way IN is a snap the
   *     owner did not choose, applied before the grid they did choose, and
   *     invisible afterwards: 45.5155 and 45.51 look equally deliberate in a
   *     number box. `String` rather than `toFixed`, so the digits the reader
   *     returned are the digits shown.
   *
   * `gps` IS OPTIONAL AND THE GUARD IS NOT DECORATION. `readMetadata` returns
   * `{}` for a file it cannot read at all — screenshots, scans, location
   * services off — which is the case this meets most often. The obvious
   * `setLat(String(metadata.gps?.lat))` writes the string "undefined" into a
   * `type="number"` box, which a browser then shows as empty: a coordinate
   * silently cleared by attaching a scan.
   */
  function offerCoordinate(name: string, metadata: PipelineResult["metadata"]) {
    /**
     * §9 FAILS CLOSED, AND A PHOTO IS NOT AN EXCEPTION TO IT. This is the same
     * gate the two boxes wear as `disabled={!coordinatesLive}`, asked by the
     * one writer that does not arrive as a keystroke.
     *
     * WITHOUT IT THE EDITOR CONTRADICTS ITSELF IN ONE ACCESSIBLE DESCRIPTION.
     * The controls are dead and already say "This entry will be saved without a
     * map pin: your privacy settings could not be read", and the note would
     * compose a second sentence into that same description telling the owner to
     * type in a box the browser will not let them type in.
     *
     * AND IT IS A MECHANISM, NOT ONLY A CONTRADICTION. `fuzzed()` returns
     * `undefined` for any gate that is not `ready`, and `placeFor` reads
     * `undefined` as a REMOVAL — so on an EDIT this fill would delete the
     * entry's stored `#geo` by the fail-closed branch, which was harmless
     * before the picker existed only because these boxes could not become
     * non-empty. That is the sort of safety that stops being safety without
     * anything changing where it was written.
     *
     * THE GATE IS READ FROM THE RENDER THAT STARTED THE PICK, and unlike
     * `coordinateAuthor` that needs no ref: `gate` goes `checking` → `ready` or
     * `closed` exactly once, on mount, and never back. So a stale read can only
     * be `checking` where the truth is now `ready` — a refusal where a fill was
     * permissible, which is the direction §9 says to err in.
     */
    if (!coordinatesLive) return;

    const gps = metadata.gps;
    if (gps === undefined) return;
    /* FIRST WRITER WINS. `nobody` is the only answer that admits a fill — see
       `CoordinateAuthor` for why the other two are both refusals, and why this
       is one record for the pair rather than one per box. */
    if (coordinateAuthor.current.kind !== "nobody") return;

    creditCoordinate({ kind: "photo", name });
    setLat(String(gps.lat));
    setLong(String(gps.long));
    /**
     * A FILL IS A CHANGE TO THE FORM, and every change arms the autosave.
     *
     * IT IS ALREADY ARMED TWICE OVER BY THE TIME THIS RUNS, measured rather
     * than assumed, and that is recorded here so that nobody reads a green
     * draft test as proof of this line: the pick itself is a `change` event on
     * a control inside the `<form>`, which the form's own handler turns into
     * `touched.current = true`, and `move` did it again on the `ready` above
     * for the reason its docblock gives. So removing this line changes no test
     * — and it stays, because an idempotent write of `true` cannot disagree
     * with the other two, and the alternative is a fill whose arming depends on
     * where in `attach` it happens to be called from.
     */
    touched.current = true;
  }

  /**
   * §11.5, AND IT IS THE SAME OFFER `offerCoordinate` MAKES, MADE TWICE: a
   * photo may fill a half nobody has supplied, and may never take one away.
   *
   * THE WALL CLOCK GOES IN UNSHIFTED, WHICH IS WHAT THE FIELD MEANS. §7.3:
   * `dy:occurredAt` "carries the local UTC offset of the place", so the value is
   * the time it was THERE and `toOffsetDateTime` copies it rather than
   * recomputing it — see its docblock, whose reasoning this fill depends on.
   * Routing the photo's `07:05` through a `Date` would rewrite five past seven
   * in Tokyo as whatever o'clock it is here, and for any photo taken on the far
   * side of this machine's midnight it would move the DATE, not merely the hour.
   *
   * TO THE MINUTE, THROUGH `wallClockOf`, WHICH IS THE ONE SPELLING OF "a
   * timestamp, as this control shows it". Keeping the photo's `:33` is legal end
   * to end — `LOCAL_DATETIME` accepts optional seconds and passes them through
   * — but a `datetime-local` with no `step` neither displays nor edits seconds,
   * so they would be a third of a minute the owner cannot see and the first
   * keystroke would silently drop. `toOffsetDateTime` supplies the `:00` §6
   * wants, exactly as it does for a hand-typed clock.
   *
   * NO §9 GATE HERE, AND THAT IS A DECISION RATHER THAN AN OMISSION.
   * `offerCoordinate` asks `coordinatesLive` because the fail-closed posture is
   * about publishing a POINT; an offset is not a coordinate and neither is a
   * wall clock. The offset control is deliberately not tied to that gate either
   * — see its own note in the form — because an owner whose privacy settings
   * cannot be read still gets to say what time of day it was.
   *
   * AND A HALF MAY ONLY JOIN THE OTHER HALF IT BELONGS WITH — ruling T4-E, and
   * the guard that closes the one reachable data defect this task shipped.
   * `offerCoordinate` needs no analogue: a photo either carries both GPS tags
   * or neither (lib/media/exif.ts sets `gps` only when both are present), so
   * `coordinateAuthor` is one record for a pair and a mixed coordinate cannot
   * be composed from two photos at all. The timestamp's two halves arrive
   * independently, and any day's walk produces the sequence:
   *
   *   1. `tokyo.jpg` — a clock and no zone. The clock fills, the offset is
   *      left as this machine's guess, and the mark and the note go on.
   *   2. `chathams.jpg` — a phone that writes both. Its clock is refused,
   *      correctly, because the first photo already supplied one.
   *   3. Its ZONE was then accepted, because the offset was still `nobody`'s —
   *      which composed Tokyo's `07:05` with the Chathams' `+12:45`, an instant
   *      that happened at NEITHER place, and cleared the mark in the same
   *      motion, because the mark reads "a photo dated it and nobody offset
   *      it". §11.5's stated failure, reached by two photos, with the warning
   *      removed by the act of composing it.
   *
   * T4-C IS NOT WHAT PERMITTED THAT, AND STANDS. It says the wall clock and the
   * offset are independent because the owner correcting WHEN beside a photo
   * supplying WHERE is coherent — one side is a competent authority who can see
   * both halves and fix either. Photo A's clock beside photo B's zone has no
   * authority anywhere in it: it is T3-A's "value that is nowhere", and neither
   * the value nor any warning about it survives. So each branch asks WHOSE the
   * other half is, not merely whether it is spoken for, and `{ kind: "photo" }`
   * carrying the slot's `key` is what makes that askable.
   *
   * `key`, AND NOT THE FILE NAME, WHICH IS HOW T4-E's OWN GUARD DEGENERATED FOR
   * A DAY (F1). It compared `file.name`, and `PhotoSlot`'s docblock — up where
   * the slot type is declared — says a name is not an identity: the picker is
   * `multiple` and deduplicates nothing. Two cameras both calling their first photo
   * `IMG_0001.jpg` is the ordinary case, not a contrived one, and it walked the
   * sequence above straight back through the guard: A's clock in, B's clock
   * refused, B's ZONE accepted because `"IMG_0001.jpg" === "IMG_0001.jpg"`, and
   * the mark cleared in the same motion. The guard passed both of its tests and
   * failed on the pair of names any two cameras produce. `key` is minted per
   * slot in `attach` and cannot collide, which makes the comparison ask the
   * question the ruling meant.
   *
   * BOTH BRANCHES, OR NEITHER. Guarding only the zone leaves the mirror — a
   * zone-only photo, then a clock-only one — exactly as it was, and the order
   * the owner picks two photos in is an accident. The same-`key` comparison is
   * what keeps ONE photo supplying both halves legal: by the zone branch the
   * clock's record already names the slot being offered, and the wall branch
   * sees an offset no photo has touched yet.
   *
   * BOTH TAGS ARE OPTIONAL AND NEITHER GUARD IS DECORATION. `readMetadata`
   * returns `{}` for a file it cannot read at all — a scan, a screenshot, a
   * camera whose clock was never set, which it rejects by sentinel — and that is
   * the case this meets most often. The obvious
   * `setOccurred(String(metadata.dateTimeOriginal))` writes the nine characters
   * `undefined` into the state; a `datetime-local` reads that back as empty, so
   * the box CANNOT show the defect and the autosaved draft is the only surface
   * that can.
   */
  function offerTimestamp(key: string, name: string, metadata: PipelineResult["metadata"]) {
    /* FIRST WRITER WINS, PER HALF — `nobody` is the only answer that admits a
       fill, and `TimeAuthor` is where the other two are argued out, including
       why an edit's NON-empty box is not the question being asked here. */
    let occurredTo = occurredAuthor.current;
    let offsetTo = offsetAuthor.current;
    let filled = false;

    const wall = metadata.dateTimeOriginal;
    if (
      wall !== undefined &&
      occurredTo.kind === "nobody" &&
      /* …and not beside ANOTHER photo's zone (T4-E). `offsetTo` is untouched by
         this photo at this line, so a `photo` here is always an earlier one.
         On the slot's `key` and never on `name`, which two cameras share — F1,
         argued in the docblock. */
      (offsetTo.kind !== "photo" || offsetTo.key === key)
    ) {
      setOccurred(wallClockOf(wall));
      occurredTo = { kind: "photo", key, name };
      filled = true;
    }

    /* THE HALF EXIF USUALLY HAS NOTHING TO SAY ABOUT (§11.5), and when it does
       say something it is already `+09:00`-shaped: lib/media/exif.ts reads tag
       0x9011 and validates it against `/^[+-]\d{2}:\d{2}$/`, so what arrives
       here is an offset or nothing. It goes in AS READ — never through
       `offsetHere` or a `Date`, either of which answers with this machine's zone
       — and `offsetOptions` unions whatever the control holds into the list, so
       an offset the list does not carry renders instead of the select silently
       showing its first option.

       SHAPE-VALID IS NOT IN RANGE, AND `+99:99` IS WHAT THAT COSTS (F4). That
       regex is the WHOLE of exif.ts's validation, so a camera — or this
       project's own fixture builder — can put 6 039 minutes east of Greenwich
       into the control, `offsetOptions` unions it into the select beside thirty
       real zones, and `toOffsetDateTime` concatenates it onto the wall clock the
       same photo supplied. It then fails CLOSED, which is the good half:
       `serialiseEntry`'s `Entry.safeParse` refuses the timestamp and nothing
       reaches the Pod. The defect is the advice the owner is then given —
       `announce`'s "The entry did not reach your Pod … try again", which is
       false on the first retry and on every one after it, with nothing on the
       form pointing at a select quietly showing `+99:99`. So the range is
       checked HERE, on the way in, and NOT in `OFFSET_SHAPE`: that fence is
       deliberately wider, because an entry some other tool wrote may carry
       `+05:15` and this editor's job is to show such a value and put it back
       unchanged (§1c). What may not happen is ACCEPTING one from a photo. 840
       minutes is `+14:00`, the eastern end of `OFFSETS` and of the world.

       THE TOTAL-MINUTES FENCE ABOVE MISSES A SECOND WAY TO BE SHAPE-VALID AND
       IMPOSSIBLE, AND `+05:61` IS WHAT THAT COSTS (closing item 4, still F4).
       exif.ts's regex accepts any two digits in the minutes pair, so `61` is
       shape-valid, and `offsetMinutes` composes it as `5 * 60 + 61 = 361` —
       comfortably inside ±840, the same fence that stops `+99:99`. Nothing
       between here and the Pod catches it except `Entry.safeParse`'s
       `z.iso.datetime({ offset: true })`, at the very end of the chain, after
       Save — so `+05:61` fills the control, gets unioned into the select, and
       reproduces the exact "did not reach your Pod … try again" on every
       retry that the paragraph above exists to prevent. So the minutes digits
       are range-checked separately, right here, rather than by widening the
       total-minutes fence to catch them incidentally — `Number(zone.slice(4,
       6)) < 60` reads the same two characters `offsetMinutes` does, checked
       on their own before they are composed into it.

       THIS IS THE SAME LOOSE/STRICT SPLIT AS `+99:99`'S, ONE FIELD OVER, AND
       `OFFSET_SHAPE` STAYS AS WIDE AS IT WAS: loose for what this editor
       DISPLAYS — a stored `+05:15`, or for that matter a stored `+05:61` some
       other tool once wrote, must still render and round-trip unchanged
       (§1c) — strict for what it ACCEPTS FROM A PHOTO, which is this
       conjunct and only this conjunct. Tightening `OFFSET_SHAPE` instead
       would refuse to RENDER a value this editor is only obliged to show. */
    const zone = metadata.offsetTimeOriginal;
    if (
      zone !== undefined &&
      Math.abs(offsetMinutes(zone)) <= 840 &&
      Number(zone.slice(4, 6)) < 60 &&
      offsetTo.kind === "nobody" &&
      /* …and not beside ANOTHER photo's clock (T4-E, on `key` — F1). The wall
         branch has already run, so for a photo carrying both tags `occurredTo`
         names THIS slot and the comparison lets it through — which is what
         keeps 12b's one-photo case, and this guard, from being in each other's
         way. */
      (occurredTo.kind !== "photo" || occurredTo.key === key)
    ) {
      setOffset(zone);
      offsetTo = { kind: "photo", key, name };
      filled = true;
    }

    /* UNCONDITIONAL, AND IDEMPOTENT WHEN NOTHING FILLED: the mark is derived
       from these two records in one place, so re-crediting them with what they
       already hold recomputes the same answer. What it must not do is leave a
       fill uncredited, which is why it is not inside either branch. */
    creditTime(occurredTo, offsetTo);
    /* A fill is a change to the form, and every change arms the autosave —
       `offerCoordinate`'s line, with its reasoning: armed twice over already by
       the time this runs, and an idempotent write of `true` cannot disagree with
       the other two. Guarded by `filled` because a photo that supplied neither
       half has changed nothing to keep. */
    if (filled) touched.current = true;
  }

  /**
   * PROCESS, UPLOAD, THEN HOLD A `Photo` — never the `File`.
   *
   * The order is the decision recorded at the top of this file: by the time
   * this resolves the bytes are on the Pod and this component holds URLs and
   * JSON, which is what keeps the autosaved draft restorable. The source
   * ArrayBuffer is read here rather than in the worker because the container
   * path is `sha256(ORIGINAL)[0..16]` — the derivative's hash would defeat the
   * re-pick idempotence that makes a retry free.
   *
   * NOTHING THROWS OUT OF HERE. `uploadPhoto` reports its failures as a
   * `Result`, but the pipeline REJECTS (that is `createPipeline`'s contract),
   * and an unhandled rejection would leave a slot decoding for ever with
   * nothing on screen saying why.
   */
  async function attach(file: File) {
    const key = `photo-${nextSlotKey.current++}`;
    const name = file.name;
    const move = (next: PhotoSlot) => {
      /**
       * A SETTLE IS A CHANGE TO THE FORM, AND HAS TO ARM THE AUTOSAVE LIKE ANY
       * OTHER ONE.
       *
       * The pick itself already set `touched` — the file input's `change` event
       * bubbles to the `<form>` handler below — but a save can land between the
       * pick and the settle and put it back to `false`. `settleDraft` does that
       * legitimately: at the moment it runs, the Pod holds exactly what the form
       * holds, because a slot still `decoding` contributes nothing to `attached`
       * and `sameText` is therefore true.
       *
       * Then the photo settles. `attached` gains a `Photo`, the autosave effect
       * re-runs — and returns at `if (!touched.current)` having armed nothing.
       * The row says "is attached to this entry" and the binaries really are on
       * the Pod, but the entry resource does not reference them and nothing is
       * in `localStorage` either. Close the tab and the photo is orphaned and
       * silently absent, with no surface anywhere that says so.
       *
       * Reachable by ordinary use, not by a race that needs help: Save is only
       * `disabled={saving}`, so picking a photo, typing the headline and
       * pressing Save before the decode finishes is a sequence the UI invites.
       *
       * `ready` ONLY. `uploading` and `failed` leave `attached` unchanged, so
       * there is nothing new to back up and arming on them would re-open the
       * window over text the Pod already has. The narrower race — a settle
       * DURING the round trip — is handled by `live.current.text` and
       * `samePhotos` inside `save()`, and is not this.
       */
      if (next.state === "ready") touched.current = true;
      setSlots((held) => held.map((slot) => (slot.key === key ? next : slot)));
    };

    setSlots((held) => [...held, { key, name, state: "decoding" }]);
    try {
      const source = await file.arrayBuffer();
      const derived = await pipelineFor().process(file);
      move({ key, name, state: "uploading" });
      const stored = await uploadPhoto({
        // The visitor's own authenticated fetch, never the ambient one
        // (invariant 4): a media PUT is a write, and anonymously it is a 401.
        fetch: session.fetch,
        podRoot,
        // The ORIGINAL bytes, hashed for the path and never uploaded — the
        // derivatives are what go up, and the re-encode is what strips the EXIF.
        source,
        derivatives: { web: derived.web, thumb: derived.thumb },
        blurDataUrl: derived.blurDataUrl,
        // `derived.metadata` is not uploaded, and that is what stripping means:
        // the derivatives are re-encoded without it. Its GPS and its two time
        // tags are READ below, into the form and nowhere else: `DateTimeOriginal`
        // has no UTC offset and §6 requires one, so the offset comes from the
        // control beside the clock — the photo's own when it carried one, and
        // otherwise a guess the owner is told about (`offerTimestamp`).
      });
      if (!stored.ok) {
        move({ key, name, state: "failed", message: describe(stored.error) });
        return;
      }
      move({ key, name, state: "ready", photo: stored.value });
      /**
       * ON `ready`, AND NOT A LINE EARLIER. The metadata has been in hand since
       * the decode, so filling from it before the upload is spelled in one line
       * fewer — and it offers the owner a coordinate for a photo that is about
       * to fail its PUT and be announced as not attached. A coordinate from a
       * photo that is not on the entry has nothing on screen to explain it,
       * and its note names a file the form no longer holds.
       */
      offerCoordinate(name, derived.metadata);
      /* THE TWO OFFERS ARE INDEPENDENT AND BOTH ARE MADE, in either order: a
         photo may carry GPS and no clock, a clock and no GPS, both or neither
         (lib/media/exif.ts reads them from different IFDs and guards each
         separately), and neither half may stand in for the other or clear it.

         THE `key` GOES IN BESIDE THE NAME because that is photo identity here
         and the name is not — see `TimeAuthor`. `offerCoordinate` takes the
         name alone on purpose: it displays it and never compares it. */
      offerTimestamp(key, name, derived.metadata);
    } catch (cause) {
      move({
        key,
        name,
        state: "failed",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

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
  /** `touched` — the "has anybody typed?" guard this section's autosave reads —
   *  is declared up with `nextSlotKey`, not here. Its docblock says why; the
   *  short version is that `attach` writes to it and the lint rule cares about
   *  which line the `useRef` is on. */
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
    // The offset the owner chose, beside the wall clock rather than folded into
    // it: the control they type the time into has none, and a draft that kept
    // only the wall clock would hand back the machine's guess.
    offset,
    tagsText,
    mode,
    status,
    lat,
    long,
    precision,
    // Where the owner was, in words. Kept for the reason §9 makes sharpest: a
    // crash near home would otherwise leave an entry with no coordinate AND no
    // name, which is a placeless entry rather than a coarse one.
    placeName,
    locality,
    country,
    /**
     * THE PHOTOS, AS `Photo` OBJECTS — which is only possible because the pick
     * uploaded them. A `File` here would serialise to `{}` without throwing,
     * and the draft would report success while restoring a photo with no URL.
     */
    photos: attached,
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
   * What goes in is the seventeen fields of `Draft` and nothing else — the
   * sixteen the form holds, plus the `savedAt` stamp put on below. The ETag, the
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
          offset,
          tagsText,
          mode,
          status,
          lat,
          long,
          precision,
          placeName,
          locality,
          country,
          photos: attached,
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
    // Changing the offset alone has to arm a window: it is not typing, and this
    // is the dependency that makes the state change reach the debounce.
    offset,
    tagsText,
    mode,
    status,
    lat,
    long,
    precision,
    placeName,
    locality,
    country,
    // The ready photos, so attaching one arms a window like any other change.
    // Its identity moves on every slot transition, not only on a settle, so a
    // photo in flight restarts the window — which is what a debounce is for.
    attached,
  ]);

  /**
   * AN UNMOUNT IS NOT A REASON TO THROW THE LAST 800ms AWAY.
   *
   * Routine rather than exotic: components/studio/studio-shell/studio-shell.tsx flips
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
    /**
     * THE OFFSET GOES BACK ONLY IF THE DRAFT HAS ONE TO GIVE, and `""` is not
     * one. This is the load-bearing half of `Draft.offset` being
     * `.default("")` — see its docblock in lib/studio/drafts.ts.
     *
     * `""` ARRIVES FROM TWO PLACES AND MEANS THE SAME THING IN BOTH: a payload
     * written before this control existed (the schema's default fills the
     * absent key), and one somebody emptied by hand. Neither is an instruction,
     * because there is no "remove the offset" — §3 and §6 require
     * `dy:occurredAt` to carry one — so both mean "this draft has nothing to
     * say about the offset".
     *
     * WRITING `""` THROUGH IS THE FAILURE, and it is a blank control under a
     * banner that has just said the draft came back — measured, by making this
     * line unconditional and running section 8j: `shownValue` read `""`. The
     * save after it composes a timestamp out of a wall clock and nothing, which
     * §3 and §6 refuse on the next read.
     *
     * THE FALL-THROUGH IS THE CONTROL'S CURRENT VALUE, which is `?? placeName`'s
     * reasoning rather than `presetPrecision`'s, and the choice matters:
     *
     *   - "leave the control showing what it is showing" is the honest reading
     *     of a draft with no opinion, and on an untouched form that value IS
     *     `offsetOf(existing?.occurredAt) ?? offsetHere(…)` — the entry's own
     *     offset on an edit, this machine's on a create — because that is what
     *     the state was initialised with;
     *   - re-deriving the chain here would be a SECOND copy of it, two things
     *     that have to agree and say nothing when they stop, and it would
     *     discard an offset the owner had corrected before clicking Restore.
     *     Overwriting an explicit choice with a re-derived guess is the exact
     *     class of bug this control was added to remove.
     *
     * `presetPrecision` is not the model here because the precision case is
     * about a value that is UNUSABLE — what the control shows has to be what
     * `fuzzForPublication` is given (§9 step 3) — whereas this is a value that
     * is ABSENT, which is the place fields' case.
     *
     * THE SHAPE, NOT THE LIST, IS THE TEST. `+05:15` is not one of the offsets
     * `OFFSETS` offers and must still be restored; `banana` from a hand-edited
     * payload must not — not because it would reach `dy:occurredAt` (it would
     * reach the composer and fail the save: `serialiseEntry` re-validates with
     * `Entry.safeParse`, lib/pod/entry-model.ts, so a shape-invalid offset is
     * refused there, not written to the Pod), but because showing it in the
     * control would be indistinguishable from an offset this editor actually
     * offers. One expression covers `""` and that, which is what collapsing
     * absent into `""` bought.
     */
    setOffset(OFFSET_SHAPE.test(draft.offset) ? draft.offset : offset);
    /**
     * AND A RESTORED TIMESTAMP IS NOT ONE A PHOTO MAY REPLACE — the coordinate's
     * credit further down, for its reason: `restore()` writes these controls
     * without a DOM event, so it comes through neither `onChange`, and without
     * this the records would still read `nobody` over a form that visibly holds
     * a date. Attach a photo and it takes both halves: the overwrite §11.3
     * forbids, reached by the one path that does not look like typing.
     *
     * EACH RECORD MIRRORS ITS OWN SETTER, which is why the two lines are not
     * spelled alike. `setOccurred` above writes UNCONDITIONALLY, so the record
     * has to say whatever the payload said — and `""` is a draft with no date
     * in it, the common case, which leaves the clock open rather than switching
     * auto-date off for the rest of the session. `setOffset` writes only when
     * the payload's offset has the shape, so when it has nothing to say the
     * control keeps its value and the record keeps its author.
     *
     * A RESTORED OFFSET IS THE OWNER'S ALTHOUGH THE PAYLOAD CANNOT SAY WHETHER
     * THEY CHOSE IT OR THIS MACHINE GUESSED IT — `Draft` keeps no provenance —
     * and the cost is recorded rather than hidden: a draft whose offset was an
     * unconfirmed guess comes back WITHOUT the mark. The other way round is
     * worse in the direction §11.3 cares about, a photo silently replacing an
     * offset the owner chose, corrected, and accepted back off the banner.
     *
     * AND WITHIN A SESSION THAT CLEARING IS A NO-OP, which is the fact that
     * settles it rather than merely excusing it (contributed by the review,
     * 2026-09-07). The draft read is one-shot, so the banner exists only from
     * mount; while it is up the whole form sits inside
     * `<fieldset disabled={offered !== null}>`, which includes the photo
     * picker — so no photo can have been attached yet, `offsetGuess` is
     * ALWAYS `false` when this runs, and there is no mark here to lose. The
     * loss is strictly cross-session, and cross-session no code change can
     * recover it: after a reload the editor cannot know the restored clock came
     * from a photo. A `Draft` provenance field is not one option among several,
     * it is the only one, and lib/studio/drafts.ts treats every field addition
     * as a deliberate versioning decision.
     */
    creditTime(
      draft.occurred.trim() === "" ? { kind: "nobody" } : { kind: "owner" },
      OFFSET_SHAPE.test(draft.offset) ? { kind: "owner" } : offsetAuthor.current,
    );
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
     * AND A RESTORED COORDINATE IS NOT A COORDINATE A PHOTO MAY REPLACE.
     *
     * `restore()` writes these boxes without a DOM event, so it comes through
     * neither `onChange` — the form's own note says so about `touched` — and
     * without this line the record would still read `nobody` over a form that
     * visibly holds a pair. Attach a photo and it takes the boxes: the exact
     * overwrite §11.3 forbids, reached by the one path that does not look like
     * typing.
     *
     * CREDITED TO THE OWNER, ALTHOUGH THE DRAFT CANNOT SAY WHETHER THEY TYPED
     * IT OR A PHOTO FILLED IT — because both answers are refusals and the third
     * is not available. `Draft` keeps `lat`/`long` as text and nothing about
     * where they came from, and adding a provenance field to the payload would
     * be a schema change to store something no reader needs: what the record
     * has to answer is "may auto-fill write here", and for a restored pair that
     * is no either way.
     *
     * AN EMPTY DRAFT IS NOT A RESTORED COORDINATE. `""`/`""` is a draft with no
     * coordinate in it — the common case, since most entries have none — and
     * marking that as the owner's would make Restore silently switch auto-fill
     * off for the rest of the session.
     */
    if (draft.lat.trim() !== "" || draft.long.trim() !== "") {
      creditCoordinate({ kind: "owner" });
    }
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
    /**
     * THE PLACE TEXT GOES BACK VERBATIM — EXCEPT WHERE THE PAYLOAD CANNOT SPEAK
     * FOR THE FIELD AT ALL, and that exception is the whole of it.
     *
     * `""` and absent are DIFFERENT INSTRUCTIONS here, which is why
     * lib/studio/drafts.ts makes these three `.optional()` rather than giving
     * them a default. An empty string is a box the owner emptied, and in
     * `placeTextOf` that is REMOVE; an absent field is a `v2` payload written
     * before these controls existed, which has no opinion about the place
     * because there was no control to form one with.
     *
     * WRITING `undefined` THROUGH AS `""` IS A SILENT DELETION FROM THE POD.
     * Restore such a draft onto an entry that already has a name and the boxes
     * go empty, and the next save removes `schema:name` and the whole
     * `<#address>` — the half-restore the version segment exists to prevent,
     * arrived at by the operator chosen to avoid a version bump. `?? placeName`
     * is therefore "leave the control showing whatever it is showing", which on
     * an edit is the stored value.
     *
     * IT IS ALSO WHAT KEEPS THE `placeName` STATE'S ARGUMENT TRUE. That note
     * says these controls need no `touchedPlaceText` flag because they are
     * seeded from the entry — and a restore is the one moment that stops being
     * true, since it writes the controls from something other than the entry.
     * Leaving an absent field alone is what closes that gap.
     */
    setPlaceName(draft.placeName ?? placeName);
    setLocality(draft.locality ?? locality);
    setCountry(draft.country ?? country);
    /**
     * THE PHOTOS COME BACK ALREADY UPLOADED, which is the whole reason the pick
     * is the upload: these are URLs on the Pod, so a draft restored in a new tab
     * a day later still has its pictures. `readDraft` has already put every one
     * of them through `Photo`, so a devtools-mangled photo was refused with the
     * rest of the payload rather than restored into a form that would save it.
     *
     * A DRAFT WRITTEN BEFORE THIS CONTROL EXISTED RESTORES AN EMPTY LIST, and
     * that is exactly right rather than a half-restore: no payload under the
     * current key can carry photos, because there was no way to attach one. It
     * is why the key stayed at `v2` — see lib/studio/drafts.ts.
     */
    setSlots(
      draft.photos.map((photo, at) => ({
        key: `restored-${at}`,
        name: restoredName(photo, at),
        state: "ready",
        photo,
      })),
    );
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
     *                    `lat` state). ONE BOX OF THE PAIR counts as this, and
     *                    the paragraph at the end of this block is why.
     *   snap           → the published pair replaces whatever was there.
     *   drop           → the geometry is REMOVED. §9 step 2: not coarsened, and
     *                    the place keeps its name — "it is the geometry that is
     *                    absent, not the entry". On an edit that means deleting
     *                    a `#geo` that is already on the Pod, which is the half
     *                    an "add the new one" spelling silently skips.
     *
     * THE THREE TEXT FIELDS HAVE THE SAME THREE OUTCOMES AND ARE DECIDED
     * SEPARATELY, because a coordinate and a name are removed independently:
     * §9's drop keeps the name — "the entry is still written, with its place
     * name if it has one" — and clearing a name must leave the coordinate
     * alone. Their "untouched" is carried by the controls themselves rather
     * than by a flag; see the `placeName` state.
     *
     * FAIL CLOSED ON EVERYTHING ELSE. A form that somehow holds a coordinate
     * without trustworthy settings — a restored draft, a control re-enabled by
     * hand — publishes none: `fuzzForPublication` refuses settings that do not
     * parse, and the two guards above it refuse a gate that never opened and a
     * precision that is not a positive integer of metres. Every one of those is
     * a drop, and a drop still saves the entry.
     *
     * "TYPED" HERE MEANS "IN THE BOXES", AND THAT INCLUDES A PAIR A PHOTO
     * FILLED. This flag asks whether there is a coordinate to publish, and an
     * auto-filled one is a coordinate to publish — it is on the form, the owner
     * can see it, it is credited to the photo it came from, and it goes through
     * `fuzzed()` on this line like any other. `coordinateAuthor` is the record
     * that distinguishes the two, and it is deliberately not consulted here:
     * this line decides WHETHER a coordinate is written, that record decides
     * whether AUTO-FILL may write into the form, and collapsing them would
     * either publish nothing for every photo-filled entry or re-fuzz a stored
     * pair on every save.
     *
     * AND HALF A PAIR IS "NOTHING TYPED" — RULING F-A, AND THE TWO DIRECTIONS
     * DO NOT EVEN LAND IN THE SAME OCEAN. `Number("")` is `0`, so one typed
     * latitude composes `{ lat: 45.5155, long: 0 }`, which is finite and in
     * range and which `fuzzForPublication` therefore snaps and publishes.
     * Measured through the real function against §7.6's own settings:
     * `{45.5155, 0} → 45.51486 / 0.00000` and `{0, 9.2103} → 0.00000 /
     * 9.20909`. Both publish; neither drops. LATITUDE ONLY lands at 0° east of
     * the owner's own latitude — inland south-west France, a plausible-looking
     * pin on land, not open water. LONGITUDE ONLY lands in the Gulf of Guinea,
     * a few tens of km off Gabon — not the 700-odd km that belongs to `{0, 0}`
     * elsewhere in this codebase. The land pin is the worse of the two: nothing
     * distinguishes it on the map or in the data from a coordinate the owner
     * actually chose. Either way `dy:precisionMeters 500` stands beside it,
     * describing a pin the owner never typed as accurate to within half a
     * kilometre. Ruling T3-A's stated cost was that such an owner "must type
     * the second, rather than getting a silently wrong location" — which
     * assumed they are forced to notice, and nothing forces them: the outcome
     * region says saved and nothing on the form is red.
     *
     * F-A makes a half pair behave as the absence it already is, which is what
     * §9 does everywhere else — an unreadable gate, an unusable grid and
     * `insideHome` all drop rather than approximate. It may NOT be spelled as
     * the `drop` the table above defines: on an edit that deletes the pin the
     * entry already has, which is a removal the owner did not ask for either.
     * TELLING them, rather than silently dropping, is the better long-term
     * answer; it belongs in TODO.md as an open item and is not this line.
     */
    const touchedCoordinate = lat.trim() !== "" || long.trim() !== "";
    const place = placeFor(
      existing?.place,
      /* "Nothing typed" is spelled as THE GEOMETRY THE ENTRY ALREADY HAD, which
         `placeFor` carries through unchanged. It is deliberately not spelled as
         `undefined`: that is the DROP, and collapsing the two would delete a
         coordinate from the Pod every time an entry was edited without
         retyping one.

         THE PAIR-COMPLETENESS CONJUNCTS ARE RULING F-A, argued at the end of
         the docblock above: both boxes, or this is the untouched case.

         `touchedCoordinate` IS SUBSUMED BY THEM RATHER THAN LOAD-BEARING, and
         that is said out loud because this file has already carried one no-op
         defended by a comment claiming otherwise (see `placeFor`). A whole pair
         is necessarily a touched one, so the flag narrows nothing on this line.
         It stays because it names the question the docblock above argues —
         "is there a coordinate to publish at all" — and because folding the
         AND into its definition would give one name to two different rules:
         "the owner has been in these boxes", which is what that argument is
         about, and "what is in them is a point", which is this line. Ruling
         F-A fences the flag for the first reason; the second is why it would
         still be worth two names.

         THE REDUNDANCY IS CONDITIONAL ON `touchedCoordinate`'S CURRENT
         DEFINITION, NOT A PERMANENT PROPERTY OF THIS LINE: it holds only
         because a whole pair (both trims non-empty) always implies it under
         today's OR of the two trims. Any future redefinition of
         `touchedCoordinate` that is not implied by a whole pair — a third box
         added to the OR, a debounce, anything that can be false while both
         boxes hold text — changes what this conjunct does, and it would stop
         being a no-op the moment that happens. */
      touchedCoordinate && lat.trim() !== "" && long.trim() !== ""
        ? fuzzed({ lat: Number(lat), long: Number(long) })
        : existing?.place?.geo,
      /* AND THE TEXT NEEDS NO SUCH FLAG, which is the asymmetry the `placeName`
         state's note explains rather than an omission here: these three
         controls ARE seeded from the entry, so a box nobody opened already
         holds the stored value and writing it back is the untouched case. What
         `touchedCoordinate` has to reconstruct, the form carries. */
      placeTextOf({ placeName, locality, country }, language),
    );

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
      // WHAT THE TWO CONTROLS HOLD, concatenated and never converted — see
      // `toOffsetDateTime`. Either half may have been typed or chosen by the
      // owner, filled by a photo's EXIF (`offerTimestamp`), or left exactly as
      // the entry arrived: `offset` starts as the entry's own on an edit, so an
      // edit that never opened either control writes the timestamp back as it
      // was stored. What this line must not become is a THIRD source — §9 step
      // 3's rule for the precision, spelled for the timestamp: what the owner
      // can see is what gets published, which is also why a photo's EXIF is
      // never read here.
      occurredAt: occurred === "" ? undefined : toOffsetDateTime(occurred, offset),
      datePublished,
      travelModeFrom: mode === "" ? undefined : mode,
      place,
      /**
       * WHAT THE ENTRY ARRIVED WITH, THEN WHAT WAS PICKED HERE — and only the
       * `ready` picks, since `attached` is the filter. A failed slot reaches
       * neither the entry nor the index row: an optimistic slot saved with a
       * local preview URL would write `schema:contentUrl <blob:…>` into a
       * publicly readable resource, which 404s for every reader while the entry
       * reports itself saved.
       *
       * Pick nothing and this is `existing.photos`, unchanged and renumbered by
       * nothing — see `photosFor`.
       */
      photos: photosFor(existing?.photos ?? [], attached),
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
       * `text` is this render's snapshot of the sixteen fields — the same values
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
          {/*
            RULING 2.5-A (task 2.5): the banner still appears when `savedAt`
            is absent; only the `<time>` goes away. `lib/studio/drafts.ts`
            made the field `.optional()` for a payload written by another
            build or hand-edited in devtools — never one this editor wrote,
            since `nowWithOffset()` stamps every write site here — and such a
            payload must not crash the mount effect that offers it back.

            THE SPELLING CHOSEN: the whole ", from <time>…</time>" clause is
            conditional on `offered.savedAt !== undefined`, not just the
            `<time>` tag, so the sentence reads as a complete claim either
            way — "kept what you were writing here" rather than a comma
            trailing into nothing. An empty `<time>` was rejected: a `<time>`
            with no `dateTime` to point at is markup with nothing to say.
            An invented timestamp was rejected too: it would tell the owner a
            moment that never happened, which is worse than omitting the
            nicety this field is.
          */}
          <p>
            {"This browser kept what you were writing here"}
            {offered.savedAt !== undefined && (
              <>
                {", from "}
                <time dateTime={offered.savedAt}>{savedAtText(offered.savedAt)}</time>
              </>
            )}
            {". Nothing on this form has been changed."}
          </p>
          {/*
            THE HOLD, SAID OUT LOUD AND SAID HERE.

            The sentence above explains the DRAFT and stops there — it kept your
            text, the form is untouched — which accounts for the banner but not
            for the seventeen controls underneath it going dead. Someone who reads
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
          sixteen handlers. React's `onChange` is delivered to ancestors, so this
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

          THE SAVE BUTTON IS IN HERE TOO — the seventeenth control and the last
          one, held by the same attribute for the same reason. See the note on
          the button itself for the one click that closes. It said "the ninth"
          from the day the fieldset landed until 2026-09-07, by which point the
          picker, the three place fields and the UTC offset had made it wrong by
          eight: sixteen `Field`s are the fieldset's grid children now, and the
          button is what follows them.

          `grid gap-4` MOVED HERE FROM THE FORM, when there were eight fields
          and they were the form's direct grid children; a wrapper around them
          is otherwise the
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
              aria-describedby={occurredHelp()}
              /* THE KEYSTROKE IS WHAT MAKES THE CLOCK THE OWNER'S, recorded
                 here rather than in the form's own `onChange` for the reason the
                 coordinate boxes give: that handler catches every control on the
                 form, and this record is about this one. §11.3 in one line —
                 from now on a photo may offer no wall clock.
                 AND THE OFFSET'S RECORD PASSES THROUGH UNTOUCHED (T4-C): the
                 owner correcting WHEN says nothing about the zone.
                 WHICH IS ALSO WHY THIS KEYSTROKE TAKES THE CREDIT AND LEAVES
                 THE WARNING — ruling T4-G, and the comment that used to be here
                 was the argument against it: it claimed a typed-over clock
                 leaves "the default every create opens with, which the
                 permanent hint already covers". THAT EQUIVALENCE DOES NOT HOLD.
                 On a create the owner types a clock from memory beside a guess
                 they were never misled about; here `07:05` nudged to `07:06`
                 leaves the clock substantially the photo's, and clearing the
                 mark would leave §11.5's composition intact with the warning
                 gone. "The time came from a.jpg" is what a keystroke makes
                 uncheckable; "the offset is this machine's guess" is untouched
                 by it and still true. `creditTime` keeps them apart. */
              onChange={(event) => {
                creditTime({ kind: "owner" }, offsetAuthor.current);
                setOccurred(event.target.value);
              }}
            />
          </Field>

          {/*
            WHERE THE TIME ABOVE CAME FROM, WHILE A PHOTO IS THE ANSWER.

            §11.3: "the owner is told a photo supplied a value, so a wrong pin
            is attributable to the photo instead of to the editor" — and for
            this control the wrong value is `dy:occurredAt` itself, which a
            camera reset to factory time supplies with every confidence. The
            guess mark cannot carry this: it is `null` exactly when the photo
            supplied BOTH halves, which is the case with nothing else on the
            form to explain the date.

            RENDERED EXACTLY WHEN `occurredHelp()` NAMES IT, and the pair of
            them is decided by one value for `COORDINATE_SOURCE_ID`'s reason.
          */}
          {occurredSource !== null && (
            <p id={OCCURRED_SOURCE_ID} className="text-sm text-muted-foreground">
              {occurredSourceNote(occurredSource)}
            </p>
          )}

          {/*
            THE OTHER HALF OF THE TIMESTAMP, IMMEDIATELY BELOW THE CLOCK IT
            BELONGS TO. §7.3: `dy:occurredAt` "carries the local UTC offset of
            the place", and the control above hands back a wall clock with no
            offset at all — so without this one the offset was the entry's own
            or, failing that, the zone of whatever machine the form happened to
            be open on. An evening in Tokyo written up at home became
            `21:40+02:00`: the same instant, spelled as the wrong time of day,
            which for a travel diary is most of the meaning.

            INSIDE THE `<form>`, WHICH IS WHAT ARMS THE AUTOSAVE. React
            delivers `onChange` to ancestors and the form's own handler is the
            one place `touched` is set, so a "toolbar" spelling of this control
            beside the datetime input but outside the form would move the state
            and arm nothing: the owner corrects `+02:00` to `+09:00`, closes the
            tab, and gets `+02:00` back. That is a bug this project has already
            shipped once, in the photo pipeline, for exactly this reason.

            NO `aria-label` HERE OR ON ANYTHING WRAPPING IT, and no
            `<fieldset>`/`<legend>` pairing it with the clock. `getByLabelText`
            matches `aria-label` on ANY element, this file has already lost six
            tests to a wrapper that shadowed a real control, and a group named
            "When" would be a second thing answering to the label above. The
            `<label>` inside `Field` is the only name here.

            HELD BY THE DRAFT FIELDSET AND BY NOTHING ELSE. It is deliberately
            NOT tied to `coordinatesLive`: the privacy settings decide whether a
            POINT may be published, and an offset is not a coordinate. An owner
            whose settings cannot be read still gets to say what time of day it
            was.
          */}
          <Field
            id="entry-offset"
            label="UTC offset"
            hint="The offset of the place it happened in, not of wherever you are writing this. Kept exactly as chosen, so the time above always reads as that time of day."
          >
            <select
              id="entry-offset"
              name="entry-offset"
              className={CONTROL}
              value={offset}
              /* THE STATE, ON THE CONTROL THAT HOLDS THE VALUE IN DOUBT — not
                 on a wrapper, which is not what holds it, and not on the note,
                 which is the sentence rather than the state. `undefined` rather
                 than `"false"` for `coordinateHelp`'s reason: an attribute left
                 on permanently reads as correct markup and answers a question
                 nobody asked. See `creditTime` for the rule and
                 `OFFSET_GUESS_ID` for why wording cannot carry this alone. */
              data-offset-unconfirmed={offsetGuess ? "true" : undefined}
              aria-describedby={offsetHelp()}
              /* THE CHOICE IS WHAT ENDS THE GUESS (scenario 4), and it is one
                 assignment rather than a second piece of state: the mark and the
                 note both follow this record, so "the owner has chosen" and "the
                 note has stopped being true" cannot come apart. The wall clock's
                 record passes through untouched (T4-C). */
              onChange={(event) => {
                creditTime(occurredAuthor.current, { kind: "owner" });
                setOffset(event.target.value);
              }}
            >
              {/* The value is the offset AS WRITTEN, because that string is
                  what is concatenated onto the wall clock and what the draft
                  carries — one spelling, end to end. The text is the same
                  string: a list of place names would be a second thing to keep
                  true, and a wrong one is worse than none. */}
              {offsetOptions.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          </Field>

          {/*
            WHY THE OFFSET ABOVE IS NOT DATA, WHILE THAT IS TRUE.

            §11.5, and the sentence half of it: a wall clock the photo supplied
            sits beside a zone it did not, and "the owner sees 21:38 +02:00" is
            only a problem because every part of that reads as a reading. The
            other half is `data-offset-unconfirmed` on the control itself — see
            `OFFSET_GUESS_ID` for why neither half does this alone, and why this
            is not a `role="alert"`: a photo that works announces nothing, and a
            persistent live region about the offset would leak into every
            save-outcome the form reports.

            UNDER THE CONTROL AND ITS OWN HINT, named by `offsetHelp()`, and
            RENDERED EXACTLY WHEN SOMETHING POINTS AT IT — `COORDINATE_SOURCE_ID`
            's shape: a live `aria-describedby` naming an element that is not
            there computes to the empty string, and the owner is back to a date
            and a zone that appeared from nowhere.
          */}
          {offsetGuess && (
            <p id={OFFSET_GUESS_ID} className="text-sm text-muted-foreground">
              {/* The name comes from the CLOCK's record, which is what makes
                  the sentence lose it at the first keystroke there while the
                  warning stays — ruling T4-G, argued in `creditTime`. */}
              {offsetGuessNote(occurredSource)}
            </p>
          )}

          {/* AND WHEN THE PHOTO DID CARRY THE ZONE, WHO IT WAS (§11.3). Not a
              guess and not marked — the value is as trustworthy as the clock
              beside it — but still a value that appeared without being typed,
              which is the whole of `COORDINATE_SOURCE_ID`'s argument. Mutually
              exclusive with the note above by construction: that one requires
              the offset to be nobody's. */}
          {offsetSource !== null && (
            <p id={OFFSET_SOURCE_ID} className="text-sm text-muted-foreground">
              {offsetSourceNote(offsetSource)}
            </p>
          )}

          {/*
            WHERE THE OWNER WAS, IN WORDS — the three fields §9's mitigation
            leans on, and the reason they sit HERE, immediately above the
            coordinate: a place is one subject, and the entry's answer to
            "where" is these four controls together.

            THEY ARE NOT HELD BY `coordinatesLive`, and that is the point of
            putting them beside it rather than inside it. The coordinate
            controls go dead when the privacy settings cannot be read, because
            there is no home region to check a point against; a place NAME needs
            no such check — it is prose the owner chose, published exactly as
            typed — so an editor that dimmed these three alongside the
            coordinate would leave an owner with no settings unable to say
            anything at all about where they were. They are inside the draft
            fieldset with everything else, for the reason everything else is:
            one storage slot.

            NO `aria-label` ON THIS BLOCK OR ANYTHING WRAPPING IT, and no
            `<fieldset>`/`<legend>` grouping the four. `getByLabelText` matches
            `aria-label` on ANY element; this file has already lost six tests to
            a wrapper that shadowed a real control, and a legend reading
            "Place" would be a fifth thing for the form's own queries to find.
            The `<label>` inside each `Field` is the only name here.
          */}
          <Field
            id="entry-place-name"
            label="Place name"
            hint="Kept even when the coordinate is not. Near your home region the point is dropped rather than blurred, and this name is then all the entry says about where it was."
          >
            <input
              id="entry-place-name"
              name="entry-place-name"
              type="text"
              className={CONTROL}
              value={placeName}
              aria-describedby="entry-place-name-hint"
              onChange={(event) => setPlaceName(event.target.value)}
            />
          </Field>

          <Field id="entry-locality" label="Town or city">
            <input
              id="entry-locality"
              name="entry-locality"
              type="text"
              className={CONTROL}
              value={locality}
              onChange={(event) => setLocality(event.target.value)}
            />
          </Field>

          {/* A CODE, NOT A NAME (§7.3): `schema:addressCountry "JP"`, written
              untagged, because `"JP"@en` is a different RDF term from `"JP"`
              and every consumer filtering on the plain literal would stop
              matching. The hint is what stops the owner typing "Japan" here —
              nothing downstream can tell the two apart. */}
          <Field
            id="entry-country"
            label="Country"
            hint="The two-letter code, such as JP or IT — not the country's name."
          >
            <input
              id="entry-country"
              name="entry-country"
              type="text"
              className={CONTROL}
              value={country}
              aria-describedby="entry-country-hint"
              onChange={(event) => setCountry(event.target.value)}
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
              aria-describedby={coordinateHelp("entry-latitude-hint", coordinateSourceId)}
              /* THE KEYSTROKE IS WHAT MAKES THE PAIR THE OWNER'S, and it is
                 recorded HERE rather than in the form's `onChange` above: that
                 handler catches every control on the form, and this record is
                 about these two. §11.3 in one line — from now on a photo may
                 offer nothing, in either box (`CoordinateAuthor`). */
              onChange={(event) => {
                creditCoordinate({ kind: "owner" });
                setLat(event.target.value);
              }}
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
              aria-describedby={coordinateHelp(undefined, coordinateSourceId)}
              /* Either box, and the same record: a latitude from the owner
                 beside a longitude from a photo is a point that is nowhere, and
                 §9 would fuzz and publish it as though it were real. */
              onChange={(event) => {
                creditCoordinate({ kind: "owner" });
                setLong(event.target.value);
              }}
            />
          </Field>

          {/*
            WHERE THE PAIR ABOVE CAME FROM, WHILE A PHOTO IS THE ANSWER.

            UNDER THE TWO BOXES AND ABOVE THE PRECISION SELECT, because that is
            what it is about — one sentence for the pair, named by both boxes'
            `aria-describedby` (see `COORDINATE_SOURCE_ID` for why one and not
            two, and why not an `aria-label` on a wrapper).

            RENDERED EXACTLY WHEN SOMETHING POINTS AT IT, which is
            `coordinateSourceId`'s only other use: a live `aria-describedby`
            naming an element that is not there computes to the empty string,
            silently, and the owner is back to a number that appeared from
            nowhere.
          */}
          {coordinateSource !== null && (
            <p id={COORDINATE_SOURCE_ID} className="text-sm text-muted-foreground">
              {coordinateSourceNote(coordinateSource)}
            </p>
          )}

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

          {/*
            THE PICKER, AND IT UPLOADS AS SOON AS SOMETHING IS PICKED. The hint
            says so, because it is a surprise worth telling the owner about: the
            bytes are on the Pod before Save is pressed, and a photo attached to
            an entry that is then abandoned stays in `travel/media/`.

            `multiple`, and the pipeline serialises them one at a time — one
            worker, one photo, because three 50 MP decodes in flight is how a
            phone's browser tab gets killed in the middle of an edit.

            NO `aria-label` ANYWHERE IN THIS BLOCK, on the input or on anything
            around it. `getByLabelText` matches `aria-label` on ANY element, and
            this file has already lost six tests to a wrapper that shadowed a
            real control. The `<label>` inside `Field` is the one name here.
          */}
          <Field
            id="entry-photos"
            label="Photos"
            hint="Resized in this browser, stripped of their location and their camera metadata, and uploaded to your Pod as soon as you pick them."
          >
            <input
              id="entry-photos"
              name="entry-photos"
              type="file"
              accept="image/*"
              multiple
              className={CONTROL}
              aria-describedby="entry-photos-hint"
              onChange={(event) => {
                const picked = [...(event.target.files ?? [])];
                // CLEARED, so picking the same file again is another `change`
                // rather than silence. The list above is already a copy; "" is
                // the one value a file input's value may be set to.
                event.target.value = "";
                for (const file of picked) void attach(file);
              }}
            />
          </Field>

          {/*
            WHAT EACH PICKED FILE IS DOING, ANNOUNCED STRUCTURALLY.

            `status` for progress and for a photo that settled, `alert` for one
            that failed — the same division the save's outcome uses, and for the
            same reason: `alert` is assertive and interrupts a screen reader
            mid-sentence, which "your photo is uploading" has not earned, while a
            file that will never be attached is a decision the owner has to make.

            A PLAIN `<ul>`, WITH NO NAMED REGION AROUND IT. A landmark would need
            a name, and every ARIA naming mechanism except `title` lands in
            `getByLabelText` next to the control above.
          */}
          {slots.length > 0 && (
            <ul className="grid gap-2">
              {slots.map((slot) => (
                <li key={slot.key} className="flex items-center gap-3">
                  {slot.state === "ready" && (
                    /*
                      FROM THE POD, NOT FROM `URL.createObjectURL`. An object URL
                      dies with the page, so a draft restored tomorrow would show
                      a broken image — and it is the URL an implementation that
                      saved before uploading would be tempted to write into the
                      entry.

                      A PLAIN <img>, NOT next/image, and the disable below is
                      that decision rather than a silenced warning: the host is
                      whatever Pod the owner has, so next/image would need every
                      one of them in `images.remotePatterns` — configuration
                      this project cannot write down and cannot ask for, since a
                      Pod root is an env var with a working default. It would
                      also put an optimiser in front of a resource that is
                      already a 400 px derivative this browser made itself, on a
                      screen only the owner ever loads. The LCP the rule is
                      about belongs to the public pages, which never render this.
                    */
                    // eslint-disable-next-line @next/next/no-img-element -- see above
                    <img
                      src={slot.photo.thumbnailUrl ?? slot.photo.contentUrl}
                      alt={slot.name}
                      className="h-16 w-16 border border-hairline object-cover"
                    />
                  )}
                  {slot.state === "failed" ? (
                    <p role="alert" className="text-sm">
                      {`${slot.name} was not attached: ${slot.message}`}
                    </p>
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      {slot.state === "decoding"
                        ? `Preparing ${slot.name}…`
                        : slot.state === "uploading"
                          ? `Uploading ${slot.name}…`
                          : `${slot.name} is attached to this entry.`}
                    </p>
                  )}
                </li>
              ))}
            </ul>
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
            THE SEVENTEENTH CONTROL, HELD WITH THE OTHER SIXTEEN AND BY THE
            SAME ATTRIBUTE. It carries no margin of its own: the fieldset is the
            grid, so this row takes its gap from `gap-4` like every field above
            it, and the `mt-4` it wore while it stood outside would now be a
            second gap on top of that one. The wrapper `<div>` stays, bare —
            the grid stretches its items, so a button promoted to a direct child
            of the fieldset becomes a full-width bar.

            THE LOSS IT CLOSES, which is why it moved. The fields of the day shipped
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
              belongs there — one element holds seventeen controls, so one element
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

              THIS BUTTON ALONE, not all seventeen. The banner sits directly
              above the sixteen fields and its own sentence is about them; Save
              is the one whose refusal has a consequence the owner will go
              looking for. And one reason attached to seventeen controls is that
              reason announced seventeen times to anyone reading the form
              linearly.

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
        distinction components/studio/entry-editor/entry-editor.test.tsx exists to hold. Measured, not
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
 * Byte-identical. Seventeen controls that look perfectly editable while swallowing
 * every keystroke — which is a worse failure than an ugly one, because the
 * owner's conclusion is that the app is broken rather than that something is
 * being asked of them. The programmatic half of the same defect is the Save
 * button's `aria-describedby`, above.
 *
 * ONE VARIANT COVERS ALL SIXTEEN FIELDS BECAUSE `:disabled` IS INHERITED IN
 * FACT IF NOT IN NAME: a control inside a `<fieldset disabled>` is "actually
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
 * Tailwind outranks. The reasoning is in components/studio/entry-editor/entry-editor.test.tsx's 8e-bis
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
