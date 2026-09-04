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

import { useState } from "react";
import { documentUrlOf } from "@/lib/pod/entry-model";
import { describe } from "@/lib/pod/result";
import { Status, TravelMode } from "@/lib/pod/schema";
import { saveEntry } from "@/lib/pod/save-entry";
import { revalidatePublicSite } from "@/lib/studio/revalidate";
import { SCHEMA_VERSION } from "@/lib/vocab";
import type { ReactNode } from "react";
import type { Entry, Status as EntryStatus, TravelMode as Mode } from "@/lib/pod/schema";
import type { SaveEntryReport } from "@/lib/pod/save-entry";
import type { Precondition } from "@/lib/pod/write";
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

/* ════════════════════════════════════════════════════════════════ the form ══ */

export default function EntryEditor({ session, trips, initial }: EntryEditorProps) {
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

      <form
        className="mt-4 grid gap-4"
        onSubmit={(event) => {
          // Prevented, so jsdom and the browser both stay on this page and the
          // save is this component's to run.
          event.preventDefault();
          void save();
        }}
      >
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

        <div>
          <button
            type="submit"
            disabled={saving}
            aria-busy={saving}
            className="cursor-pointer border border-hairline bg-surface px-4 py-2 hover:bg-hairline"
          >
            {"Save entry"}
          </button>
        </div>
      </form>

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

/** Tokens from app/globals.css, no arbitrary values: the fixed dark palette
 *  lives at `:root` and this screen stays plain until phase 7. */
const CONTROL = "w-full border border-hairline bg-surface px-3 py-2";

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
