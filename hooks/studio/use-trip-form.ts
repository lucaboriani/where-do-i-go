/**
 * The trip editor's own eight values, one reducer, one setter per field —
 * `use-entry-form.ts`'s shape, scaled down to what a trip has. `slug` is
 * owner-typed: no ninth setter derives it from `name`, in either direction.
 */

import { useMemo, useReducer } from "react";
import type { Status, Trip } from "@/lib/pod/schema";

export interface TripFormState {
  slug: string;
  name: string;
  startDate: string;
  endDate: string;
  description: string;
  tagsText: string;
  coverImage: string;
  status: Status;
}

export interface TripFormSetters {
  slug: (value: string) => void;
  name: (value: string) => void;
  startDate: (value: string) => void;
  endDate: (value: string) => void;
  description: (value: string) => void;
  tagsText: (value: string) => void;
  coverImage: (value: string) => void;
  status: (value: Status) => void;
}

export interface TripForm {
  values: TripFormState;
  set: TripFormSetters;
}

export interface TripFormSeed {
  existing: Trip | undefined;
}

/** Every optional field seeds as `""`, never `undefined` — a controlled input
 *  given `undefined` warns and then goes uncontrolled. */
export function initialTripFormState({ existing }: TripFormSeed): TripFormState {
  return {
    slug: existing?.slug ?? "",
    name: existing?.name.value ?? "",
    startDate: existing?.startDate ?? "",
    endDate: existing?.endDate ?? "",
    description: existing?.description?.value ?? "",
    tagsText: existing?.tags.join(", ") ?? "",
    coverImage: existing?.coverImage ?? "",
    status: existing?.status ?? "draft",
  };
}

type TripTextField = Exclude<keyof TripFormState, "status">;
type TripFormAction =
  { kind: "field"; field: TripTextField; value: string } | { kind: "status"; value: Status };

function tripFormReducer(state: TripFormState, action: TripFormAction): TripFormState {
  switch (action.kind) {
    case "field":
      return { ...state, [action.field]: action.value };
    case "status":
      return { ...state, status: action.value };
  }
}

export function useTripForm(seed: TripFormSeed): TripForm {
  const [values, dispatch] = useReducer(tripFormReducer, seed, initialTripFormState);

  /** Memoised for the same reason `use-entry-form.ts`'s own `set` is: a fresh
   *  object every render defeats a child that memoises on these identities. */
  const set = useMemo<TripFormSetters>(() => {
    const field = (name: TripTextField) => (value: string) =>
      dispatch({ kind: "field", field: name, value });
    return {
      slug: field("slug"),
      name: field("name"),
      startDate: field("startDate"),
      endDate: field("endDate"),
      description: field("description"),
      tagsText: field("tagsText"),
      coverImage: field("coverImage"),
      status: (value) => dispatch({ kind: "status", value }),
    };
  }, []);

  return { values, set };
}
