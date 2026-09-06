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
 * schema below is the fence: thirteen fields, and the parse is what reaches
 * storage.
 */
import * as z from "zod";
import { Photo, Status, TravelMode } from "@/lib/pod/schema";

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
 * `wig.draft.v2.<webId>.<scope>`.
 *
 * Three parts, three collisions they prevent. The VERSION: a shape that has
 * moved on gets a new number and the old payloads become invisible rather than
 * half-restorable. The WEBID: one machine with two accounts must not hand the
 * second person the first person's unfinished text. The SCOPE: the entry being
 * created and the entry being edited are different drafts, and so are two
 * different entries.
 *
 * **`v1` → `v2` ON 2026-09-06, WHICH IS THE VERSION SEGMENT DOING ITS JOB** and
 * not a rename. The draft was nine fields; `lat`, `long` and `precision` make
 * it twelve. A v1 payload is a perfectly valid JSON object under the schema
 * below — unknown keys are stripped, missing ones are not invented — so without
 * the bump it would restore nine controls and leave three showing whatever the
 * editor's own defaults left there, under a banner that has just told the owner
 * their draft came back. A coordinate the owner did not type, next to text they
 * recognise, is worse than no offer at all: invisible is the correct outcome
 * for a payload whose shape has moved on.
 *
 * **`photos` ARRIVED ON 2026-09-06 AND THE KEY DELIBERATELY DID NOT MOVE**,
 * which is the same test applied and answered the other way. The hazard a bump
 * exists for is the HALF-RESTORE: a field the payload cannot carry, showing
 * whatever the editor's own default left in it, under a banner that has just
 * said the draft came back. That cannot arise here, because **no `v2` payload
 * can contain a photo — the editor had no photo control when `v2` payloads were
 * written**. Such a draft restores an empty photo list, which is not a default
 * standing in for something lost; it is the truth about that draft. Hence the
 * `[]` default below. Bumping would have thrown away real unsaved prose in
 * exchange for nothing.
 *
 * **`placeName`, `locality` AND `country` ARRIVED ON 2026-09-06 AND THE KEY DID
 * NOT MOVE EITHER** — the third time that test is applied and the second time
 * it is answered "no", for the identical reason. No `v2` payload can carry a
 * place name, because the editor had no place controls when `v2` payloads were
 * written, so such a draft restores three EMPTY boxes. That is the truth about
 * that draft rather than a default standing in for something lost, and it is
 * what the `.default("")` on each of the three below buys. Without the default
 * they would be REQUIRED, `safeParse` would refuse the whole older payload, and
 * the long entry the owner is trying not to lose would be lost by a quieter
 * route than a version bump — same outcome, no marker in the key to explain it.
 */
export const draftKey = (at: DraftAddress): string => `wig.draft.v2.${at.webId}.${at.scope}`;

/**
 * Exactly what the form holds mid-sentence, and nothing else.
 *
 * NOT `.strict()`, and that is load-bearing rather than an oversight: unknown
 * keys are STRIPPED. A payload written by a slightly different build, or one a
 * curious owner edited in devtools, still restores its sixteen legitimate
 * fields instead of being thrown away — and the stripping is also what guarantees an
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
   * THE COORDINATE AS TYPED, NOT AS IT WOULD BE PUBLISHED, and strings for the
   * same reason every field above is one: this is what the form holds, and an
   * `<input type="number">` hands back a string.
   *
   * §9's "the studio discards the precise original" is about the POD — its own
   * first line gives the threat model, "resources are publicly readable… anyone
   * can fetch the raw triple". `localStorage` is not a resource, never leaves
   * the browser that typed into it, and is the same trust boundary as the React
   * state and the input element still showing the value. Discarding it here
   * would close no hole and would close the feature: a coordinate is the one
   * thing on this form nobody can retype from memory a day later, which is
   * exactly the loss `docs/decisions.md` §10 says autosave exists for.
   *
   * Persisting the SNAPPED pair instead was considered and is worse: a restored
   * form would show a coordinate the owner never typed, cannot refine and
   * cannot tell from one they did, frozen against settings that may since have
   * changed. Re-fuzzing it on save would be idempotent and therefore invisible.
   *
   * EMPTY IS THE COMMON CASE. A half-written entry with no coordinate yet is
   * the draft this feature exists for, so a schema demanding a number here
   * would refuse to back up the most ordinary draft there is.
   */
  lat: z.string(),
  long: z.string(),
  /** The precision control's value, in metres, as a string. `""` is what there
   *  is to keep when the settings could not be read and the control was never
   *  live — see §9's fail-closed rule. */
  precision: z.string(),
  /**
   * WHERE THE OWNER WAS, IN WORDS — the three controls §9 leans on.
   *
   * §9 step 2 drops the coordinate entirely inside the home radius rather than
   * coarsening it, and its stated mitigation is that "the entry is still
   * written, with its place name if it has one". These are where that name is
   * held between keystrokes, so a draft that dropped them would hand the owner
   * back a placeless entry after exactly the crash this feature exists for.
   *
   * STRINGS, EXACTLY AS THE FORM HOLDS THEM, and `country` is a CODE rather
   * than prose — `lib/pod/entry-model.ts` writes `schema:addressCountry`
   * untagged for that reason. Nothing here is language-tagged: a tag is a fact
   * about the triple, decided at save time from the entry's own language, and
   * putting one in the draft would freeze it against a build that changes it.
   *
   * `.default("")` RATHER THAN `.optional()`, AND IT IS WHAT LETS THE KEY STAY
   * AT `v2` — see `draftKey`. `""` is a real value here: it is the ordinary
   * draft, whose owner has not said where they were yet, and in the editor it
   * is also the instruction "remove this", which is a different instruction
   * from "left alone". An `.optional()` would collapse the two, and a bare
   * required `z.string()` would make every pre-place payload unreadable.
   */
  placeName: z.string().default(""),
  locality: z.string().default(""),
  country: z.string().default(""),
  /**
   * THE PHOTOS ALREADY ON THE POD, and the only field here that is not a string
   * off a form control — because by the time one is in this list it is not a
   * file any more.
   *
   * The editor uploads on pick and then holds a `Photo`: URLs, dimensions, a
   * media type and a `data:` placeholder, all of which survive
   * `JSON.stringify`. A `File` or a `Blob` here would serialise to `{}` — it
   * does not throw and it does not print "[object Blob]" — so the write would
   * report success and the restore would hand back a photo with no URL on it.
   * That failure is the reason the pick is the upload, so this field is where it
   * is caught: `Photo` requires `contentUrl` to be a URL, and a draft that lost
   * its bytes is refused rather than restored.
   *
   * REUSING THE APP'S OWN `Photo` rather than restating it, exactly as `status`
   * and `mode` reuse theirs, and with the same consequence: a photo hand-edited
   * in devtools takes the whole payload down rather than being restored into a
   * form that would then write it to the Pod. Losing one draft is recoverable;
   * a mangled `schema:contentUrl` on a public resource is not.
   *
   * `.default([])` IS WHAT LETS THE KEY STAY AT `v2` — see `draftKey`. A payload
   * written before this control existed has no `photos`, and an empty list is
   * the honest answer for it rather than a stand-in for something lost.
   */
  photos: z.array(Photo).default([]),
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
