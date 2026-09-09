/**
 * The unsaved draft this browser kept, offered back: the stamp it was kept at,
 * why the form below is held while it waits, and the two answers that end the
 * wait. Presentational — the offer, and both answers, arrive as props.
 * ./notes.md#props-only
 */

import { BUTTON } from "../field";
import type { Draft } from "@/lib/studio/drafts";

export interface DraftBannerProps {
  /** The stored draft awaiting an answer. NON-NULL: whether there is an offer
   *  at all is the editor's question, because the same answer holds the
   *  fieldset and describes the Save button. ./notes.md#what-travelled-and-what-did-not */
  offered: Draft;
  /** The owner taking it back. Fills the fields that are TEXT and nothing else —
   *  the caller's business, not this component's. */
  onRestore: () => void;
  /** The owner saying "that is not what I want", which has to CLEAR storage
   *  rather than hide this banner. */
  onDiscard: () => void;
}

/** ONE END OF THE ASSOCIATION BETWEEN THE HELD SAVE BUTTON AND THE SENTENCE
 *  THAT EXPLAINS THE HOLD, spelled once because a dangling IDREF computes to
 *  the empty string, silently. EXPORTED, because the other end is the editor's
 *  Save button and two literals thirty lines apart is how they stop agreeing:
 *  ./notes.md#the-hold-reason-id-is-spelled-once */
export const HOLD_REASON_ID = "entry-draft-hold";

/** `2026-04-02T19:00:00+09:00` → `2026-04-02 at 19:00`, the wall clock AS IT WAS
 *  STAMPED and never shifted. Takes a `string` and stays that way (ruling
 *  2.5-A): ./notes.md#savedattext-shows-the-wall-clock-as-it-was-stamped */
const savedAtText = (savedAt: string) => `${savedAt.slice(0, 10)} at ${savedAt.slice(11, 16)}`;

export default function DraftBanner({ offered, onRestore, onDiscard }: DraftBannerProps) {
  return (
    /* NAMED BY `title`, NOT BY `aria-label`, AND THAT IS LOAD-BEARING: every
       ARIA naming mechanism lands in `getByLabelText` on ANY element, and the
       editor's Status select already answers to these words — two matches
       against one, measured. ./notes.md#named-by-title-not-by-aria-label */
    <section
      role="region"
      title="Unsaved draft"
      className="mt-4 border border-hairline bg-surface p-4"
    >
      {/* RULING 2.5-A: the banner still appears when `savedAt` is absent, and
          the WHOLE clause is conditional rather than just the `<time>`:
          ./notes.md#ruling-25-a-the-banner-survives-an-absent-savedat */}
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
      {/* THE HOLD, SAID OUT LOUD AND SAID HERE — the Save button NAMES this
          element, so a second copy beside the button is a text that drifts:
          ./notes.md#the-hold-is-said-in-the-banner-not-beside-the-button */}
      <p id={HOLD_REASON_ID} className="mt-2">
        {"Restore it or discard it to carry on: while it is waiting, the form below is " +
          "held and cannot be saved, so that one storage slot is not written by two hands."}
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" className={BUTTON} onClick={onRestore}>
          {"Restore"}
        </button>
        <button type="button" className={BUTTON} onClick={onDiscard}>
          {"Discard"}
        </button>
      </div>
    </section>
  );
}
