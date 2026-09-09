/**
 * The studio's local draft store: in-progress entry text, kept in the browser
 * (`docs/decisions.md` §10). The storage is INJECTED, never reached for, and
 * NOTHING HERE THROWS — `readDraft` answers `null`, `writeDraft` `false`.
 * ./notes.md#the-storage-is-injected-and-nothing-here-throws
 */

// WHAT MAY NEVER BE PERSISTED: the ETag, `dcterms:created` and
// `schema:datePublished`. A restored ETag is a blind PUT wearing a helpful hat.
// The schema below is the fence — seventeen fields, and the parse output is
// what reaches storage. ./notes.md#what-may-never-be-persisted
import * as z from "zod";
import { Photo, Status, TravelMode } from "@/lib/pod/schema";

/**
 * The three methods this module uses, and not one more. Narrower than the DOM's
 * `Storage` on purpose: `clear()` is a method this module must never be able to
 * call. ./notes.md#the-storage-is-injected-and-nothing-here-throws
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** WHOSE draft, and WHICH one. An object rather than two positional strings, so
 *  that a webId/scope swap is a type error rather than a plausible key that
 *  matches nothing. */
export interface DraftAddress {
  /** The signed-in person's WebID, off their own session. */
  webId: string;
  /** The entry document URL when editing — no fragment, exactly as
   *  `documentUrlOf` spells it — or the literal `new` when creating, because
   *  there is no resource yet to name. */
  scope: string;
}

/**
 * `wig.draft.v2.<webId>.<scope>`: three parts, three collisions they prevent.
 * The version segment has been put to the test three times — bumped once, held
 * twice, and on two different arguments the second time.
 * ./notes.md#the-key-has-three-parts-and-the-version-segment-has-been-tested-three-times
 */
export const draftKey = (at: DraftAddress): string => `wig.draft.v2.${at.webId}.${at.scope}`;

/**
 * Exactly what the form holds mid-sentence, and nothing else. NOT `.strict()`,
 * which is load-bearing: unknown keys are STRIPPED, so the parse output is the
 * fence an `etag` cannot cross. Each field's looseness is deliberate too.
 * ./notes.md#the-schema-is-not-strict-and-the-fields-are-loose-on-purpose
 */
const Draft = z.object({
  tripIri: z.string(),
  slug: z.string(),
  headline: z.string(),
  story: z.string(),
  /** The wall clock `<input type="datetime-local">` hands back: no offset,
   *  because that control has none. It becomes `dy:occurredAt` only at save
   *  time, by concatenating the `offset` held beside it (§7.3). */
  occurred: z.string(),
  /**
   * THE OFFSET OF THE PLACE, AS THE OWNER CHOSE IT — a form value since
   * 2026-09-07, and deliberately not checked against the editor's list.
   * `.default("")`, the opposite answer to the three place fields below.
   * ./notes.md#the-offset-is-the-owners-answer-now-and-empty-means-no-answer
   */

  /* `""` cannot mean "the owner wants none": §3 and §6 require an offset on
   * `dy:occurredAt`, so absent and `""` are the SAME instruction here — and
   * `""` must never be written INTO the editor's control.
   * ./notes.md#default-for-the-offset-optional-for-the-place-text */
  offset: z.string().default(""),
  tagsText: z.string(),
  mode: z.union([TravelMode, z.literal("")]),
  status: Status,
  /**
   * THE COORDINATE AS TYPED, NOT AS IT WOULD BE PUBLISHED, and a string like
   * every field above it. §9's "discard the precise original" is about the POD;
   * `localStorage` never leaves the browser that typed into it.
   * ./notes.md#the-coordinate-is-kept-as-typed
   */
  lat: z.string(),
  long: z.string(),
  /** The precision control's value, in metres, as a string. `""` is what there
   *  is to keep when the settings could not be read and the control was never
   *  live — see §9's fail-closed rule. */
  precision: z.string(),
  /**
   * WHERE THE OWNER WAS, IN WORDS — the three controls §9 leans on when it
   * drops a coordinate. `.optional()`, NOT `.default("")`, measured on zod
   * 4.5.4: in the editor `""` means REMOVE and the two must stay apart.
   * ./notes.md#the-three-place-fields-are-what-9-leans-on
   */
  placeName: z.string().optional(),
  locality: z.string().optional(),
  country: z.string().optional(),
  /**
   * THE PHOTOS ALREADY ON THE POD, and the only field here that is not a string
   * off a form control. A `File` or `Blob` would serialise to `{}` silently, so
   * `Photo` requiring a URL is where that is caught. `.default([])` is what
   * lets the key stay at `v2`. ./notes.md#the-photo-list-is-what-the-pod-already-holds
   */
  photos: z.array(Photo).default([]),
  /**
   * WHEN THIS DRAFT WAS WRITTEN, and OPTIONAL since 2026-09-07 at the
   * maintainer's instruction, against this docblock's own argument. §6 still
   * applies to a value that is present.
   * ./notes.md#savedat-became-optional-against-this-argument
   */
  savedAt: z.iso.datetime({ offset: true }).optional(),
});

export type Draft = z.infer<typeof Draft>;

/** The draft stored for this person and this entry, or `null` — including for
 *  every unusable thing a real browser produces: a value truncated by a tab
 *  killed mid-write, a payload under an older key version, a storage that
 *  throws on read because storage is disabled entirely. */
export function readDraft(storage: StorageLike, at: DraftAddress): Draft | null {
  let raw: string | null;
  try {
    raw = storage.getItem(draftKey(at));
  } catch {
    return null;
  }
  if (raw === null || raw === "") return null;

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  const draft = Draft.safeParse(payload);
  return draft.success ? draft.data : null;
}

/**
 * Store it, and say whether the browser kept it. VALIDATED BEFORE IT IS STORED,
 * so a draft this module would refuse to read back is never written. `false`
 * means the browser refused — Safari in private mode reports a zero quota.
 * ./notes.md#validated-before-it-is-stored
 */
export function writeDraft(storage: StorageLike, at: DraftAddress, draft: Draft): boolean {
  const checked = Draft.safeParse(draft);
  if (!checked.success) return false;

  try {
    // `checked.data`, never `draft`: the parse output is the fence that keeps an
    // ETag or a `created` handed in by a caller from reaching storage at all.
    storage.setItem(draftKey(at), JSON.stringify(checked.data));
    return true;
  } catch {
    return false;
  }
}

/** Remove this one draft. Never `clear()` — the store holds other entries'
 *  drafts and other people's, and this is the owner discarding one of them. */
export function clearDraft(storage: StorageLike, at: DraftAddress): void {
  try {
    storage.removeItem(draftKey(at));
  } catch {
    // Storage disabled at the browser level. There is nothing to report and
    // nothing to do: the caller is discarding a draft, and a draft that cannot
    // be removed cannot have been stored either.
  }
}
