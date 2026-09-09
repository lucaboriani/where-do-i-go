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
      {/* THE PICKER, AND IT UPLOADS AS SOON AS SOMETHING IS PICKED — the bytes
          are on the Pod before Save is pressed. NO `aria-label` ANYWHERE IN THIS
          BLOCK: ./notes.md#the-picker-uploads-as-soon-as-something-is-picked */}
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
            // CLEARED, so picking the same file again is another `change` rather
            // than silence: ./notes.md#the-picker-uploads-as-soon-as-something-is-picked
            event.target.value = "";
            onPicked(picked);
          }}
        />
      </Field>

      {/* WHAT EACH PICKED FILE IS DOING, ANNOUNCED STRUCTURALLY — `status` for
          progress, `alert` for a failure, and A PLAIN `<ul>` WITH NO NAMED REGION
          AROUND IT: ./notes.md#what-each-picked-file-is-doing-announced-structurally */}
      {slots.length > 0 && (
        <ul className="grid gap-2">
          {slots.map((slot) => (
            <li key={slot.key} className="flex items-center gap-3">
              {slot.state === "ready" && (
                /* FROM THE POD, NOT FROM `URL.createObjectURL`, and A PLAIN <img>
                   rather than next/image — the disable below is that decision:
                   ./notes.md#the-thumbnail-comes-from-the-pod-and-is-a-plain-img */
                /* eslint-disable-next-line @next/next/no-img-element --
                   PERMANENT: next/image cannot serve a Pod URL. Remove only if that
                   changes. ./notes.md#the-thumbnail-comes-from-the-pod-and-is-a-plain-img */
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
