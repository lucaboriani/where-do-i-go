/**
 * The section list: one card per `SectionDraft`, an accessible group with its
 * own text control, its own photo picker, and remove / move-up / move-down;
 * "Add section" below the list. Presentational, props-only: ./notes.md#props-only
 */

import Field, { BUTTON, CONTROL } from "../../field";
import PhotoFields from "../photo-fields";
import { cappedSlotCount, SECTION_PHOTO_CAP } from "../../state/actions";
import type { SectionDraft } from "../../state/actions";

export interface SectionsFieldProps {
  sections: readonly SectionDraft[];
  onTextChange: (id: string, value: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: "up" | "down") => void;
  onPicked: (sectionId: string, files: readonly File[]) => void;
}

export default function SectionsField({
  sections,
  onTextChange,
  onAdd,
  onRemove,
  onMove,
  onPicked,
}: SectionsFieldProps) {
  return (
    <div className="grid gap-6">
      {sections.map((section, index) => (
        // `aria-label` NAMES THE GROUP ITSELF, 1-based — the id every text and
        // photo control below derives from is 0-based, and the two counts are
        // deliberately not the same number:
        // ./notes.md#the-group-name-is-1-based-and-the-ids-are-0-based
        <fieldset
          key={section.id}
          aria-label={`Section ${index + 1}`}
          className="grid gap-4 border border-hairline p-4"
        >
          <Field id={`entry-section-${index}-text`} label="Story">
            <textarea
              id={`entry-section-${index}-text`}
              name={`entry-section-${index}-text`}
              rows={8}
              className={CONTROL}
              value={section.text}
              onChange={(event) => onTextChange(section.id, event.target.value)}
            />
          </Field>

          <PhotoFields
            id={`entry-section-${index}-photos`}
            slots={section.slots}
            disabled={cappedSlotCount(section.slots) >= SECTION_PHOTO_CAP}
            onPicked={(files) => onPicked(section.id, files)}
          />

          <div className="flex gap-2">
            <button type="button" onClick={() => onRemove(section.id)} className={BUTTON}>
              {"Remove section"}
            </button>
            <button
              type="button"
              onClick={() => onMove(section.id, "up")}
              disabled={index === 0}
              className={BUTTON}
            >
              {"Move section up"}
            </button>
            <button
              type="button"
              onClick={() => onMove(section.id, "down")}
              disabled={index === sections.length - 1}
              className={BUTTON}
            >
              {"Move section down"}
            </button>
          </div>
        </fieldset>
      ))}

      <div>
        <button type="button" onClick={onAdd} className={BUTTON}>
          {"Add section"}
        </button>
      </div>
    </div>
  );
}
