/**
 * §10's steps as the trip editor spends them: the name+slug pre-flight, the
 * `Trip` this form assembles, and the two facts that make a SECOND save an
 * update rather than a first. Mirrors `use-entry-save.ts`, scaled down: a
 * trip has no draft, no sections, no fuzzed geometry.
 */

import { useState } from "react";
import { describe } from "@/lib/pod/result";
import { tripUrl } from "@/lib/pod/read";
import { saveTrip } from "@/lib/pod/save-trip";
import { revalidatePublicSite } from "@/lib/studio/revalidate";
import { SCHEMA_VERSION } from "@/lib/vocab";
import type { SaveTripReport } from "@/lib/pod/save-trip";
import type { Trip } from "@/lib/pod/schema";
import type { StudioSessionLike } from "@/lib/studio/session";
import type { TripFormState } from "./use-trip-form";

const LANGUAGE = "en";

/** `dy:tag` is a token, not prose — comma-separated in, trimmed, untagged. */
const parseTags = (text: string) =>
  text
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");

export type TripSaveTarget = { url: string; etag: string | null };
export type TripSaveOutcome = { tone: "ok" | "problem"; text: string; detail?: string };

export interface TripSaveSeed {
  session: StudioSessionLike;
  podRoot: string;
  /** Absent means CREATE. Present means EDIT, from the read that produced
   *  this state — `null` when the server sent no ETag. */
  initial?: { trip: Trip; etag: string | null };
  values: TripFormState;
}

export interface TripSave {
  target: TripSaveTarget | null;
  addressFixed: boolean;
  outcome: TripSaveOutcome | null;
  saving: boolean;
  saved: Trip | null;
  save: () => Promise<void>;
}

/**
 * A create's 412 IS "the slug is already taken"; an update's 412 IS "stale,
 * reload" — the same collision code, two different situations, told apart
 * only by whether this SAVE started with a target (§10, save-trip.ts).
 */
function announce(report: SaveTripReport, creating: boolean): TripSaveOutcome {
  const failure = report.failed;
  if (failure === undefined) {
    return {
      tone: "ok",
      text: creating ? "Saved. The trip is on your Pod." : "Saved. Your changes are on your Pod.",
    };
  }

  const detail = describe(failure.error);
  const is412 = failure.error.kind === "http" && failure.error.status === 412;

  if (failure.step === "trip" && is412) {
    return creating
      ? {
          tone: "problem",
          text:
            "Refused: this slug is already taken by another trip on your Pod. Pick a different " +
            "slug and save again.",
          detail,
        }
      : {
          tone: "problem",
          text:
            "Refused: what is on your Pod at this address is no longer what you started from — " +
            "it changed elsewhere, or in another tab. Reload the trip to see the newer version, " +
            "then apply your change to that.",
          detail,
        };
  }

  switch (failure.step) {
    case "container":
      return {
        tone: "problem",
        text:
          "The trip's container could not be created, so nothing was saved. Everything you " +
          "typed is still on this screen — try again.",
        detail,
      };
    case "trip":
      return {
        tone: "problem",
        text:
          "The trip did not reach your Pod, and nothing there changed. Everything you typed " +
          "is still on this screen — try again.",
        detail,
      };
    case "index":
      return {
        tone: "problem",
        text:
          "The trip is on your Pod, but its entries index could not be created, so entries " +
          "cannot be listed yet.",
        detail,
      };
    case "entriesContainer":
      return {
        tone: "problem",
        text: "The trip is on your Pod, but the folder for its entries could not be created.",
        detail,
      };
    case "revalidate":
      return {
        tone: "problem",
        text:
          "The trip is saved on your Pod. Only the public site's cache could not be cleared, " +
          "so visitors may see the previous version for a few minutes.",
        detail,
      };
  }
}

export function useTripSave({ session, podRoot, initial, values }: TripSaveSeed): TripSave {
  const existing = initial?.trip;
  const [target, setTarget] = useState<TripSaveTarget | null>(
    initial === undefined ? null : { url: tripUrl(podRoot, initial.trip.slug), etag: initial.etag },
  );
  const [saved, setSaved] = useState<Trip | null>(null);
  const [outcome, setOutcome] = useState<TripSaveOutcome | null>(null);
  const [saving, setSaving] = useState(false);
  const addressFixed = target !== null;

  async function save() {
    setOutcome(null);

    const missing = [
      values.name.trim() === "" ? "a name" : null,
      values.slug.trim() === "" ? "a slug" : null,
    ].filter((what): what is string => what !== null);
    if (missing.length > 0) {
      setOutcome({
        tone: "problem",
        text: `This trip needs ${missing.join(", ")} before it can be saved. Nothing has been sent to your Pod.`,
      });
      return;
    }

    let etag: string | undefined;
    if (target !== null) {
      if (target.etag === null) {
        setOutcome({
          tone: "problem",
          text:
            "This trip is on your Pod, but your Pod did not return a version tag for the last " +
            "write, so there is nothing to condition the next one on. Reload the trip before " +
            "editing it further: saving without a precondition would silently overwrite " +
            "whatever is there now.",
        });
        return;
      }
      etag = target.etag;
    }
    const creating = target === null;

    const language = existing?.name.language ?? LANGUAGE;
    const trimmedSlug = values.slug.trim();
    const trip: Trip = {
      iri: existing?.iri ?? `${tripUrl(podRoot, trimmedSlug)}#it`,
      slug: trimmedSlug,
      status: values.status,
      schemaVersion: SCHEMA_VERSION,
      name: { value: values.name.trim(), language },
      description:
        values.description.trim() === ""
          ? undefined
          : {
              value: values.description.trim(),
              language: existing?.description?.language ?? language,
            },
      startDate: values.startDate === "" ? undefined : values.startDate,
      endDate: values.endDate === "" ? undefined : values.endDate,
      index: existing?.index,
      coverImage: values.coverImage === "" ? undefined : values.coverImage,
      track: existing?.track,
      tags: parseTags(values.tagsText),
      origin: existing?.origin,
      created: existing?.created,
      creator: existing?.creator,
      modified: existing?.modified,
    };

    setSaving(true);
    let report: SaveTripReport;
    try {
      report = await saveTrip({
        // The visitor's own authenticated fetch, never the ambient one
        // (invariant 4): a trip PUT is a write, and anonymously it is a 401.
        fetch: session.fetch,
        trip,
        podRoot,
        etag,
        webId: session.info.webId,
        revalidate: revalidatePublicSite,
      });
    } catch (cause) {
      setOutcome({
        tone: "problem",
        text:
          "The save stopped unexpectedly, so what reached your Pod is unknown. Reload the trip " +
          "to see what is there before saving again.",
        detail: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    } finally {
      setSaving(false);
    }

    // The resource exists from the moment step "trip" succeeds, whatever
    // happened after it — so the next save is an update, with its ETag.
    if (report.completed.includes("trip")) {
      setTarget({ url: report.tripUrl, etag: report.etag ?? null });
      setSaved(trip);
    }
    setOutcome(announce(report, creating));
  }

  return { target, addressFixed, outcome, saving, saved, save };
}
