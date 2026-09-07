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
 * schema below is the fence: seventeen fields, and the parse is what reaches
 * storage. It said thirteen from the day it was written until 2026-09-07, by
 * which point `photos`, the three place fields and `offset` had made it four
 * short — so when a field is added here, this number is part of the change.
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
 * NOT MOVE EITHER**, and here the answer required a THIRD option rather than a
 * yes or a no. No `v2` payload can carry a place name, so a bump would throw
 * away real unsaved prose for nothing — but unlike `photos`, an absent place
 * field cannot safely be given a default, because in the editor `""` means
 * REMOVE and would delete the place of the entry being edited. The three are
 * therefore `.optional()`, which keeps "absent" distinguishable from "emptied"
 * all the way to `restore()`. See their own docblock below: this is the one
 * field group where the version segment is not the only fence.
 *
 * **`offset` ARRIVED ON 2026-09-07 AND THE KEY DID NOT MOVE FOR IT EITHER** —
 * the third time the version test is answered "no", and the second of the two
 * ways of answering it. No `v2` payload can carry an offset, because there was
 * no control to choose one with, so the half-restore a bump exists to prevent
 * cannot arise: such a draft restores `""`, and `""` is not a default standing
 * in for something lost — it is "this draft has nothing to say about the
 * offset", which is the truth about that draft. `.default("")` rather than the
 * place fields' `.optional()`, because unlike a place name an offset has no
 * REMOVE instruction to keep distinguishable from absence. The field's own
 * docblock below has the whole of that argument.
 */
export const draftKey = (at: DraftAddress): string => `wig.draft.v2.${at.webId}.${at.scope}`;

/**
 * Exactly what the form holds mid-sentence, and nothing else.
 *
 * NOT `.strict()`, and that is load-bearing rather than an oversight: unknown
 * keys are STRIPPED. A payload written by a slightly different build, or one a
 * curious owner edited in devtools, still restores its seventeen legitimate
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
   *  time, by concatenating the `offset` held beside it (§7.3). */
  occurred: z.string(),
  /**
   * THE OFFSET OF THE PLACE, AS THE OWNER CHOSE IT — the other half of the
   * timestamp, and since 2026-09-07 a form value rather than a derived one.
   *
   * §7.3: `dy:occurredAt` "carries the local UTC offset of the place", because
   * normalising to UTC "destroys the fact that it was evening, which for a
   * travel diary is most of the meaning". Until the editor grew a control for
   * it, that offset was the entry's own or, failing that, THE EDITING
   * MACHINE'S: writing up a Japan trip from home stamped an evening in Tokyo
   * `+02:00`, silently, with nothing on the form that could correct it. It is
   * now an answer, which is what makes it something the local copy has to keep
   * — a restored draft that dropped it would hand the owner back the very
   * guess the control exists to replace, under a banner that has just told them
   * their draft came back.
   *
   * NOT CHECKED AGAINST THE EDITOR'S LIST, deliberately. The fence is the
   * editor's own thirty-eight offsets and the shape check in its `restore()`;
   * this module's job is to hand back what the form was holding. A schema that
   * refused `+05:15` — which another tool can perfectly well have written, and
   * which the editor is required to render rather than silently replace — would
   * throw away the whole payload, prose included, and losing a long entry is
   * the exact failure `docs/decisions.md` §10 says this store exists to
   * prevent.
   *
   * ───────────────────────────────────────────────────────────────────────
   * `.default("")`, AND THAT IS THE OPPOSITE ANSWER TO THE THREE PLACE FIELDS
   * BELOW, which are `.optional()`. Both keep a pre-control payload READABLE,
   * so both avoid the version bump; what separates them is whether `""` and
   * absent are different INSTRUCTIONS.
   *
   * For place text they are. `""` there means REMOVE THIS, and it is the only
   * way a name already on a world-readable resource comes off it, so collapsing
   * it into "absent" would either delete a place nobody touched or make removal
   * impossible.
   *
   * THERE IS NO "REMOVE THE OFFSET" INSTRUCTION. §3 and §6 require
   * `dy:occurredAt` to carry one and refuse it without on read AND on write, so
   * `""` cannot mean "the owner wants none" — it can only mean "this draft has
   * nothing to say about the offset, use the fallback chain". Absent and `""`
   * are therefore the SAME instruction, collapsing them is lossless rather than
   * lossy, and `restore()` gets one case to handle instead of two.
   *
   * THE CONSEQUENCE IS ON THE EDITOR'S SIDE AND IS LOAD-BEARING THERE: `""`
   * must never be written INTO the control. It shows as a blank `<select>` —
   * measured — and the save after it composes a timestamp out of a wall clock
   * and nothing, refused on the next read, which is a worse outcome than the
   * guess this control replaced. See `restore()` in
   * components/studio/entry-editor.tsx, which falls through to the same chain a
   * fresh form uses instead.
   *
   * COST IF THIS IS EVER WRONG, recorded so it is findable: should a later
   * build make an offset genuinely optional on an entry, this collapse hides
   * the difference and the field needs revisiting.
   */
  offset: z.string().default(""),
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
   * ───────────────────────────────────────────────────────────────────────
   * `.optional()`, NOT `.default("")`, AND THAT CHOICE IS THE OPPOSITE OF THE
   * ONE THIS DOCBLOCK ORIGINALLY MADE. It said `.optional()` "would collapse"
   * the difference between an empty box and an absent field. That is backwards,
   * and the operator that collapses it is the one it recommended. Measured with
   * `safeParse` on zod 4.5.4 rather than reasoned about:
   *
   *   `.default("")`  absent → `{}`  becomes `""`;  `""` → `""`   COLLAPSED
   *   `.optional()`   absent → key absent;          `""` → `""`   PRESERVED
   *
   * THE DIFFERENCE IS NOT ACADEMIC, because in the editor `""` is not merely
   * "nothing typed" — it is the instruction REMOVE THIS, and it is the only way
   * a name already on the Pod can be taken off a world-readable resource. So
   * with `.default("")`, restoring a draft written before these controls
   * existed onto an entry that HAS a place name feeds `""` into three controls
   * and the next save deletes `schema:name` and the whole `<#address>`. That is
   * precisely the half-restore the version segment exists to prevent, reached
   * by the operator chosen to avoid a version bump.
   *
   * THE `photos` PRECEDENT DOES NOT TRANSFER, which is what made it look safe.
   * A restored empty photo list is harmless because `photosFor` re-carries
   * `existing.photos` at save time, so the form state is not the last word.
   * Place text has no such carry-through: the form state IS the answer, and an
   * empty box is an instruction rather than an absence of one.
   *
   * A bare required `z.string()` is the other horn and is also wrong — it
   * refuses the whole older payload, losing the unsaved prose the key was left
   * at `v2` to protect. `.optional()` takes neither: the older payload restores
   * its prose, and `components/studio/entry-editor.tsx`'s `restore()` leaves a
   * control alone when the field is absent rather than emptying it.
   */
  placeName: z.string().optional(),
  locality: z.string().optional(),
  country: z.string().optional(),
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
