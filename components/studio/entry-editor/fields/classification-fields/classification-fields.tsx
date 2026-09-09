/**
 * What the entry is ABOUT and whether it is public: the tags, the leg that
 * arrived, and the one control §7.4's publication boundary follows from.
 * Presentational — every value and every callback is a prop. ./notes.md#props-only
 */

import { Status, TravelMode } from "@/lib/pod/schema";
import Field, { CONTROL } from "../../field";
import type { Status as EntryStatus, TravelMode as Mode } from "@/lib/pod/schema";

export interface ClassificationFieldsProps {
  /** The tags as typed, comma-separated. `dy:tag` is a token rather than prose
   *  (§3), and the parse into terms is the editor's — not this control's. */
  tagsText: string;
  onTagsTextChange: (text: string) => void;
  /** `""` is "Not recorded", which is a value the owner can choose back to. */
  mode: Mode | "";
  onModeChange: (mode: Mode | "") => void;
  status: EntryStatus;
  onStatusChange: (status: EntryStatus) => void;
}

export default function ClassificationFields({
  tagsText,
  onTagsTextChange,
  mode,
  onModeChange,
  status,
  onStatusChange,
}: ClassificationFieldsProps) {
  return (
    <>
      <Field id="entry-tags" label="Tags" hint="Separated by commas.">
        <input
          id="entry-tags"
          name="entry-tags"
          type="text"
          className={CONTROL}
          value={tagsText}
          aria-describedby="entry-tags-hint"
          onChange={(event) => onTagsTextChange(event.target.value)}
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
            onModeChange(chosen.success ? chosen.data : "");
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
            if (chosen.success) onStatusChange(chosen.data);
          }}
        >
          {Status.options.map((option) => (
            <option key={option} value={option}>
              {option === "draft" ? "Draft" : "Published"}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}
