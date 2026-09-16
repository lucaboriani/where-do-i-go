"use client";

/**
 * The studio's trip editor: one form, `use-trip-save.ts`'s write behind it.
 * IT NEVER PUTs — that is `lib/pod/save-trip.ts`'s. The cover goes through
 * the SAME pipeline the entry editor's photos do, addressed at a single
 * synthetic "cover" section: ./notes.md#the-cover-is-one-section-of-one-slot
 */

import { useState } from "react";
import Field, { BUTTON, CONTROL } from "@/components/studio/entry-editor/field";
import { Status } from "@/lib/pod/schema";
import { useTripForm } from "@/hooks/studio/use-trip-form";
import { useTripSave } from "@/hooks/studio/use-trip-save";
import { usePhotoPipeline } from "@/hooks/studio/use-photo-pipeline";
import type { PhotoSlot, SectionDraft } from "@/components/studio/entry-editor/state/actions";
import type { Trip } from "@/lib/pod/schema";
import type { StudioSessionLike } from "@/lib/studio/session";

export interface TripEditorProps {
  /** Injected, never constructed here. Its `fetch` is the only authenticated
   *  one in the browser. */
  session: StudioSessionLike;
  /** The Pod's storage root, where `travel/media/` hangs. */
  podRoot: string;
  /** Absent means CREATE. Present means EDIT — the container's slug is fixed
   *  from the moment a trip exists, so the slug control is read-only. */
  initial?: { trip: Trip; etag: string | null };
}

/** The one synthetic section a cover pick lives in — never a Pod IRI, and
 *  never rendered: it exists only to satisfy `usePhotoPipeline`'s per-section
 *  cap and identity, the same shape the entry editor's real sections use. */
const COVER_SECTION = "cover";

export default function TripEditor({ session, podRoot, initial }: TripEditorProps) {
  const editing = initial !== undefined;
  const form = useTripForm({ existing: initial?.trip });
  const values = form.values;

  const [coverSlots, setCoverSlots] = useState<PhotoSlot[]>([]);
  const coverSections: SectionDraft[] = [{ id: COVER_SECTION, text: "", slots: coverSlots }];

  const { attachAll } = usePhotoPipeline({
    session,
    podRoot,
    pipeline: undefined,
    // A cover has no location of its own to offer — see the note above.
    coordinatesLive: false,
    markTouched: () => {},
    sections: coverSections,
    form: {
      addSlot: (_sectionId, slot) => setCoverSlots((prev) => [...prev, slot]),
      settleSlot: (_sectionId, key, slot) => {
        setCoverSlots((prev) => prev.map((s) => (s.key === key ? slot : s)));
        if (slot.state === "ready") form.set.coverImage(slot.photo.contentUrl);
      },
      offerCoordinate: () => {},
      offerTimestamp: () => {},
    },
  });

  const { outcome, saving, save } = useTripSave({ session, podRoot, initial, values });

  return (
    <section className="mt-8 border-t border-hairline pt-6">
      <h2 className="text-xl">{editing ? "Edit trip" : "New trip"}</h2>

      <form
        className="mt-4 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field id="trip-name" label="Name">
          <input
            id="trip-name"
            type="text"
            className={CONTROL}
            value={values.name}
            onChange={(event) => form.set.name(event.target.value)}
          />
        </Field>

        <Field id="trip-slug" label="Slug">
          <input
            id="trip-slug"
            type="text"
            className={CONTROL}
            value={values.slug}
            disabled={editing}
            onChange={(event) => form.set.slug(event.target.value)}
          />
        </Field>

        <Field id="trip-start-date" label="Start date">
          <input
            id="trip-start-date"
            type="date"
            className={CONTROL}
            value={values.startDate}
            onChange={(event) => form.set.startDate(event.target.value)}
          />
        </Field>

        <Field id="trip-end-date" label="End date">
          <input
            id="trip-end-date"
            type="date"
            className={CONTROL}
            value={values.endDate}
            onChange={(event) => form.set.endDate(event.target.value)}
          />
        </Field>

        <Field id="trip-description" label="Description">
          <textarea
            id="trip-description"
            className={CONTROL}
            value={values.description}
            onChange={(event) => form.set.description(event.target.value)}
          />
        </Field>

        <Field id="trip-tags" label="Tags" hint="Separated by commas.">
          <input
            id="trip-tags"
            type="text"
            className={CONTROL}
            value={values.tagsText}
            aria-describedby="trip-tags-hint"
            onChange={(event) => form.set.tagsText(event.target.value)}
          />
        </Field>

        <Field id="trip-status" label="Status">
          <select
            id="trip-status"
            className={CONTROL}
            value={values.status}
            onChange={(event) => {
              const chosen = Status.safeParse(event.target.value);
              if (chosen.success) form.set.status(chosen.data);
            }}
          >
            {Status.options.map((option) => (
              <option key={option} value={option}>
                {option === "draft" ? "Draft" : "Published"}
              </option>
            ))}
          </select>
        </Field>

        <Field id="trip-cover" label="Cover photo">
          <input
            id="trip-cover"
            type="file"
            accept="image/*"
            className={CONTROL}
            onChange={(event) => {
              const picked = [...(event.target.files ?? [])];
              event.target.value = "";
              if (picked.length > 0) attachAll(COVER_SECTION, [picked[0]]);
            }}
          />
        </Field>
        {values.coverImage !== "" && (
          // Plain <img>, from the Pod: next/image cannot serve a Pod URL —
          // the same call photo-fields.tsx makes for an entry's own photos.
          /* eslint-disable-next-line @next/next/no-img-element --
             PERMANENT: next/image cannot serve a Pod URL. Remove only if that
             changes. See components/studio/entry-editor/fields/photo-fields/notes.md. */
          <img src={values.coverImage} alt="Cover photo" className="h-32 w-auto object-cover" />
        )}

        <div>
          <button type="submit" disabled={saving} aria-busy={saving} className={BUTTON}>
            {"Save trip"}
          </button>
        </div>
      </form>

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
