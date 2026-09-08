/**
 * The picker, and one row per picked file in each of the four states it passes
 * through. Presentational — the pipeline, the uploads and the slot list itself
 * are the editor's. ./notes.md#props-only
 */

import Field, { CONTROL } from "../../field";
import type { PhotoSlot } from "../../state/actions";

export interface PhotoFieldsProps {
  /** One row each, in the order they were picked. */
  slots: readonly PhotoSlot[];
  /**
   * Every file from ONE pick, in the order the picker delivered them. The input
   * is `multiple`, so this is a list rather than a file: the editor starts them
   * all at once and `lib/media/pipeline.ts` serialises the decodes.
   */
  onPicked: (files: readonly File[]) => void;
}

export default function PhotoFields({ slots, onPicked }: PhotoFieldsProps) {
  return (
    <>
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
            onPicked(picked);
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
    </>
  );
}
