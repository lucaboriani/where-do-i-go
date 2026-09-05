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
 * THERE IS NO COORDINATE INPUT HERE, AND THAT IS DELIBERATE.
 *
 * §9: "the studio applies fuzzing before the write and discards the precise
 * original", because "resources are publicly readable … anyone can fetch the
 * raw triple". Fuzzing is phase 3 and does not exist anywhere under lib/. A
 * field for a coordinate today would write an unfuzzed one to a publicly
 * readable resource — a privacy invariant broken, not a feature missing, and
 * unfixable after the fact. An entry being EDITED keeps whatever place it
 * already had, coordinates included: those were fuzzed when they were stored.
 *
 * test/entry-editor.test.tsx pins both halves — no coordinate control in the
 * DOM, no coordinate predicate on the wire for a create. Both pins are meant to
 * be deleted deliberately when fuzzing lands.
 *
 * PHOTOS are phase 3 for the same reason: they need the resize/EXIF pipeline.
 * An entry being edited carries its existing photos through untouched.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PLAIN CONTROLS ON PURPOSE. TODO.md keeps layout deliberately unstyled until
 * phase 7, and native `<select>`, `<input>` and `<textarea>` need no Radix on a
 * screen with eight controls on it. Every one of them has a real `<label>`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { documentUrlOf } from "@/lib/pod/entry-model";
import { describe } from "@/lib/pod/result";
import { Status, TravelMode } from "@/lib/pod/schema";
import { saveEntry } from "@/lib/pod/save-entry";
import { clearDraft, readDraft, writeDraft } from "@/lib/studio/drafts";
import { revalidatePublicSite } from "@/lib/studio/revalidate";
import { SCHEMA_VERSION } from "@/lib/vocab";
import type { ReactNode } from "react";
import type { Entry, Status as EntryStatus, TravelMode as Mode } from "@/lib/pod/schema";
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

/** The eight fields the FORM holds — `Draft` minus the stamp, which is put on
 *  at the moment of the write and never earlier (§6). */
type DraftText = Omit<Draft, "savedAt">;

/**
 * Have the eight fields moved between two snapshots?
 *
 * Field by field rather than `JSON.stringify`, which would answer "different"
 * for the same eight values in a different key order. The consequence of a
 * false "different" is not cosmetic: it is a local copy written back for text
 * the Pod already holds, which is exactly the resurrected draft the clear after
 * a save exists to prevent.
 */
const sameText = (a: DraftText, b: DraftText) =>
  a.tripIri === b.tripIri &&
  a.slug === b.slug &&
  a.headline === b.headline &&
  a.story === b.story &&
  a.occurred === b.occurred &&
  a.tagsText === b.tagsText &&
  a.mode === b.mode &&
  a.status === b.status;

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

export default function EntryEditor({ session, trips, initial, storage }: EntryEditorProps) {
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
  const text: DraftText = { tripIri, slug, headline, story, occurred, tagsText, mode, status };
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
   * What goes in is the nine fields of `Draft` and nothing else. The ETag, the
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
        { tripIri, slug, headline, story, occurred, tagsText, mode, status, savedAt: nowWithOffset() },
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
  }, [store, webId, scope, tripIri, slug, headline, story, occurred, tagsText, mode, status]);

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
      place: existing?.place,
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
