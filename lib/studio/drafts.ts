/**
 * The studio's local draft store: in-progress entry text, kept in the browser.
 *
 * `docs/decisions.md` §10 is the whole justification — offline is deferred, and
 * "in the meantime the studio autosaves in-progress text to `localStorage`,
 * because losing a long entry in a hostel is what kills the habit." This module
 * is the storage half of that; `components/studio/entry-editor.tsx` is the
 * wiring, and the two are tested separately (test/drafts.test.ts and section 8
 * of test/entry-editor.test.tsx).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STORAGE IS INJECTED, NEVER REACHED FOR. `localStorage` is a global that
 * throws on ACCESS — not on use — in some embedded browsers and with third-party
 * storage blocked, so a module that reaches for it is a module that cannot be
 * loaded in a node test environment and cannot be given a storage whose failures
 * are scripted. The editor supplies the browser's own; every test supplies a
 * fake.
 *
 * NOTHING HERE THROWS, EVER. That is the headline invariant and it is not
 * defensiveness for its own sake: `readDraft` is called from the editor's mount
 * effect, so anything it threw would take the editor down on first render and
 * turn "we kept a backup of your text" into "you cannot open the editor at all".
 * Corrupt JSON, a payload from a build whose shape has moved on, a hand-edited
 * field, and a `getItem`/`setItem`/`removeItem` that throws are all absorbed:
 * `readDraft` answers `null`, `writeDraft` answers `false`.
 *
 * `writeDraft` RETURNS A BOOLEAN RATHER THAN THIS PROJECT'S `Result<T>`
 * DELIBERATELY. `PodError` is the Pod's error vocabulary — none of its kinds
 * describes a browser refusing to keep a local copy, and inventing one would put
 * a browser concern into the vocabulary every Pod read and write shares.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MAY NEVER BE PERSISTED: the ETag, `dcterms:created` and
 * `schema:datePublished`. All three come from the read that produced the
 * editor's state (§10), and a draft outlives that read by however long the
 * browser was closed. A restored ETag would condition the next write on a
 * version the Pod replaced long ago — a blind PUT wearing a helpful hat, and at
 * worst, if the resource has cycled back to a matching tag, an overwrite of an
 * edit made elsewhere. A restored `created` would overwrite §7.3's "when the
 * record came into being" with whenever the draft happened to be saved. The
 * schema below is the fence: nine fields, and the parse is what reaches storage.
 */
import * as z from "zod";
import { Status, TravelMode } from "@/lib/pod/schema";

/**
 * The three methods this module uses, and not one more.
 *
 * Deliberately narrower than the DOM's `Storage`, which also demands `length`,
 * `key()` and `clear()`: a fake that had to implement those would be a fake with
 * behaviour nobody wanted, and `clear()` in particular is a method this module
 * must never be able to call — one editor emptying the whole store would take
 * every other draft, and every other person's draft, with it.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * WHOSE draft, and WHICH one. An object rather than two positional strings so
 * that a webId/scope swap is a type error at the call site instead of a key that
 * looks plausible and matches nothing.
 */
export interface DraftAddress {
  /** The signed-in person's WebID, off their own session. */
  webId: string;
  /** The entry document URL when editing — no fragment, exactly as
   *  `documentUrlOf` spells it — or the literal `new` when creating, because
   *  there is no resource yet to name. */
  scope: string;
}

/**
 * `wig.draft.v1.<webId>.<scope>`.
 *
 * Three parts, three collisions they prevent. The VERSION: a future shape can be
 * given `v2` and this one's payloads become invisible rather than
 * half-restorable. The WEBID: one machine with two accounts must not hand the
 * second person the first person's unfinished text. The SCOPE: the entry being
 * created and the entry being edited are different drafts, and so are two
 * different entries.
 */
export const draftKey = (at: DraftAddress): string => `wig.draft.v1.${at.webId}.${at.scope}`;

/**
 * Exactly what the form holds mid-sentence, and nothing else.
 *
 * NOT `.strict()`, and that is load-bearing rather than an oversight: unknown
 * keys are STRIPPED. A payload written by a slightly different build, or one a
 * curious owner edited in devtools, still restores its nine legitimate fields
 * instead of being thrown away — and the stripping is also what guarantees an
 * `etag` handed in by a caller spreading the editor's state can neither be
 * written nor read back, since the parse output is what reaches storage and what
 * leaves it.
 *
 * The looseness of the individual fields is deliberate too. `story`, `tagsText`
 * and `mode` may all be empty strings: an empty travel mode is the editor's "Not
 * recorded" option, and a half-written entry with no story yet is the exact
 * state this whole feature exists for. `tripIri` may be empty because the trip
 * picker starts unchosen and the owner may type a headline first. A schema that
 * demanded a URL here would refuse to back up the most common draft there is.
 *
 * `status` and `mode` reuse the app's own vocabularies rather than restating
 * them, so a value this editor could not put in its controls — a status from a
 * future build, a mode someone typed into devtools — is refused rather than
 * restored into a control that cannot show it.
 */
const Draft = z.object({
  tripIri: z.string(),
  slug: z.string(),
  headline: z.string(),
  story: z.string(),
  /** The wall clock `<input type="datetime-local">` hands back: no offset,
   *  because that control has none. It becomes `dy:occurredAt` only at save
   *  time, where the offset of the PLACE is supplied (§7.3). */
  occurred: z.string(),
  tagsText: z.string(),
  mode: z.union([TravelMode, z.literal("")]),
  status: Status,
  /**
   * THE ONE FIELD THAT MUST CARRY AN OFFSET (§6), refused without one on read
   * AND on write. It is what the banner's `<time dateTime>` is built from, and
   * a bare local datetime is not an instant: the banner would tell the owner
   * the wrong hour, which is the single fact it exists to carry.
   *
   * The caller stamps it. This module holds no clock, so the editor's
   * `nowWithOffset()` stays the one place that spelling is decided.
   */
  savedAt: z.iso.datetime({ offset: true }),
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
 * Store it, and say whether the browser kept it.
 *
 * VALIDATED BEFORE IT IS STORED, so a draft this module would refuse to read
 * back is never written. Storing it instead would be silent in the worst way:
 * the write reports success, the banner never appears on the next visit, and the
 * owner believes there is a backup that cannot be restored.
 *
 * `false` means the browser refused — Safari in private mode reports a zero
 * quota rather than declining storage outright, so the failure arrives here at
 * write time and not at feature-detection time. The editor turns that into one
 * quiet line saying it is not keeping a local copy, which is something the owner
 * can act on; an exception out of a debounced timer is not.
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
