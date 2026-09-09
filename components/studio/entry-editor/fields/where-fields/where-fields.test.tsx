// @vitest-environment jsdom
/**
 * The where group alone: three place fields, the coordinate pair, the precision
 * grid, and the notes. What each case bites: ./notes.md#what-this-test-pins
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import WhereFields from "./where-fields";
import type { WhereFieldsProps } from "./where-fields";

/** Manual: @testing-library/react registers auto-cleanup only when `afterEach`
 *  is a global, and this project runs vitest without `globals: true`. */
afterEach(cleanup);

const LABEL = {
  place: "Place name",
  locality: "Town or city",
  country: "Country",
  lat: "Latitude",
  long: "Longitude",
  precision: "Precision",
} as const;

const NO_SETTINGS = "This entry will be saved without a map pin.";

function props(over: Partial<WhereFieldsProps> = {}): WhereFieldsProps {
  return {
    placeName: "",
    onPlaceNameChange: vi.fn(),
    locality: "",
    onLocalityChange: vi.fn(),
    country: "",
    onCountryChange: vi.fn(),
    lat: "",
    onLatChange: vi.fn(),
    long: "",
    onLongChange: vi.fn(),
    precision: "1000",
    onPrecisionChange: vi.fn(),
    precisionOptions: [100, 1000, 10_000],
    coordinatesLive: true,
    coordinateNote: null,
    coordinateSource: null,
    settingsDetail: null,
    hasStoredCoordinate: false,
    ...over,
  };
}

const describedIdsOf = (el: Element) =>
  (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id !== "");

/** The harness's idea, four lines: resolve every IDREF and prove it exists
 *  BEFORE reading text, or a dangling association reads as "no note". */
function describedTextOf(el: Element): string {
  const ids = describedIdsOf(el);
  for (const id of ids)
    expect(document.getElementById(id), `nothing renders "${id}"`).not.toBeNull();
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the where group renders what an entry says about where it was", () => {
  it("names all six controls and holds the values it was given", () => {
    render(
      <WhereFields
        {...props({
          placeName: "Fushimi Inari",
          locality: "Kyoto",
          country: "JP",
          lat: "34.967",
          long: "135.772",
        })}
      />,
    );

    expect((screen.getByLabelText(LABEL.place) as HTMLInputElement).value).toBe("Fushimi Inari");
    expect((screen.getByLabelText(LABEL.locality) as HTMLInputElement).value).toBe("Kyoto");
    expect((screen.getByLabelText(LABEL.country) as HTMLInputElement).value).toBe("JP");
    const lat = screen.getByLabelText(LABEL.lat) as HTMLInputElement;
    expect(lat.type).toBe("number");
    expect(lat.value).toBe("34.967");
    expect((screen.getByLabelText(LABEL.long) as HTMLInputElement).value).toBe("135.772");
    expect((screen.getByLabelText(LABEL.precision) as HTMLSelectElement).value).toBe("1000");
  });

  it("offers the grids it was given, labelled as cells rather than distances", () => {
    render(<WhereFields {...props()} />);

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "~100 m",
      "~1 km",
      "~10 km",
    ]);
  });

  it("offers an 'Unavailable' option only while the precision is empty", () => {
    // §7.6 has no default and this app supplies none, so an empty value means
    // the settings have not answered. A <select> whose value matches no option
    // renders blank, which reads as a list someone forgot to fill in.
    render(<WhereFields {...props({ precision: "", coordinatesLive: false })} />);
    expect(screen.getByRole("option", { name: "Unavailable" })).toBeInTheDocument();

    cleanup();
    render(<WhereFields {...props()} />);
    expect(screen.queryByRole("option", { name: "Unavailable" })).toBeNull();
  });

  it("reports each of the six edits to its own callback alone", () => {
    const wired = props();
    render(<WhereFields {...wired} />);

    fireEvent.change(screen.getByLabelText(LABEL.place), { target: { value: "Fushimi Inari" } });
    fireEvent.change(screen.getByLabelText(LABEL.locality), { target: { value: "Kyoto" } });
    fireEvent.change(screen.getByLabelText(LABEL.country), { target: { value: "JP" } });
    fireEvent.change(screen.getByLabelText(LABEL.lat), { target: { value: "34.967" } });
    fireEvent.change(screen.getByLabelText(LABEL.long), { target: { value: "135.772" } });
    fireEvent.change(screen.getByLabelText(LABEL.precision), { target: { value: "100" } });

    expect(wired.onPlaceNameChange).toHaveBeenCalledWith("Fushimi Inari");
    expect(wired.onLocalityChange).toHaveBeenCalledWith("Kyoto");
    expect(wired.onCountryChange).toHaveBeenCalledWith("JP");
    expect(wired.onLatChange).toHaveBeenCalledWith("34.967");
    expect(wired.onLongChange).toHaveBeenCalledWith("135.772");
    expect(wired.onPrecisionChange).toHaveBeenCalledWith("100");
    for (const call of Object.values(wired).filter((v) => vi.isMockFunction(v)))
      expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("the where group holds the coordinate and nothing else", () => {
  it("holds the three coordinate controls when the settings cannot be read", () => {
    // §9: a place NAME needs no home region to check against — it is prose the
    // owner chose. Dimming these three would leave an owner with no settings
    // unable to say anything at all about where they were.
    render(<WhereFields {...props({ coordinatesLive: false })} />);

    expect(screen.getByLabelText(LABEL.lat)).toBeDisabled();
    expect(screen.getByLabelText(LABEL.long)).toBeDisabled();
    expect(screen.getByLabelText(LABEL.precision)).toBeDisabled();
    expect(screen.getByLabelText(LABEL.place)).not.toBeDisabled();
    expect(screen.getByLabelText(LABEL.locality)).not.toBeDisabled();
    expect(screen.getByLabelText(LABEL.country)).not.toBeDisabled();
  });

  it("leaves all six live when the settings answered", () => {
    render(<WhereFields {...props()} />);

    for (const label of Object.values(LABEL))
      expect(screen.getByLabelText(label)).not.toBeDisabled();
  });
});

describe("the where group says why the coordinate is dead, on all three controls", () => {
  it("renders the note and names it from every held control", () => {
    render(<WhereFields {...props({ coordinatesLive: false, coordinateNote: NO_SETTINGS })} />);

    expect(document.getElementById("entry-coordinate-note")?.textContent).toBe(NO_SETTINGS);
    for (const label of [LABEL.lat, LABEL.long, LABEL.precision])
      expect(describedIdsOf(screen.getByLabelText(label))).toContain("entry-coordinate-note");
  });

  it("renders no note and names none when the settings answered", () => {
    render(<WhereFields {...props()} />);

    expect(document.getElementById("entry-coordinate-note")).toBeNull();
    expect(describedIdsOf(screen.getByLabelText(LABEL.lat))).toEqual(["entry-latitude-hint"]);
    expect(screen.getByLabelText(LABEL.long)).not.toHaveAttribute("aria-describedby");
  });

  it("shows the failure's own detail outside the association", () => {
    // A URL and a status code: an alert should carry the sentence a person can
    // act on, not read a Pod URL out character by character.
    const detail = "GET https://me.solidcommunity.net/travel/settings/privacy.ttl — 404";
    render(
      <WhereFields
        {...props({ coordinatesLive: false, coordinateNote: NO_SETTINGS, settingsDetail: detail })}
      />,
    );

    expect(screen.getByText(detail)).toBeInTheDocument();
    for (const label of [LABEL.lat, LABEL.long, LABEL.precision])
      expect(describedTextOf(screen.getByLabelText(label))).not.toContain("404");
  });

  it("renders nothing for a detail it was not given", () => {
    render(<WhereFields {...props({ coordinatesLive: false, coordinateNote: NO_SETTINGS })} />);

    expect(screen.queryByText(/404/)).toBeNull();
  });
});

describe("the where group credits a photo for the pair, and only the pair", () => {
  it("names the provenance note from both boxes and NOT from the precision select", () => {
    // The select is about the grid a point is published in, and a photo has no
    // opinion about that — `coordinateHelp`'s source note is passed in for this.
    render(<WhereFields {...props({ coordinateSource: "a.jpg" })} />);

    expect(document.getElementById("entry-coordinate-source")?.textContent).toBe(
      "Latitude and longitude came from a.jpg. Type in either box to replace them.",
    );
    expect(describedIdsOf(screen.getByLabelText(LABEL.lat))).toEqual([
      "entry-latitude-hint",
      "entry-coordinate-source",
    ]);
    expect(describedIdsOf(screen.getByLabelText(LABEL.long))).toEqual(["entry-coordinate-source"]);
    expect(describedIdsOf(screen.getByLabelText(LABEL.precision))).toEqual([
      "entry-precision-hint",
    ]);
  });

  it("renders one note for the pair, not one per box", () => {
    render(<WhereFields {...props({ coordinateSource: "a.jpg" })} />);

    expect(screen.getAllByText(/came from a\.jpg/)).toHaveLength(1);
  });

  it("renders no provenance note when nobody is credited", () => {
    render(<WhereFields {...props()} />);

    expect(document.getElementById("entry-coordinate-source")).toBeNull();
  });
});

describe("the where group's hints", () => {
  it("tells a create that the Pod never holds the point as typed", () => {
    render(<WhereFields {...props()} />);

    expect(describedTextOf(screen.getByLabelText(LABEL.lat))).toBe(
      "Snapped to the precision below before it is saved. Your Pod never holds the point you type here.",
    );
  });

  it("tells an edit how to keep the coordinate the entry already has", () => {
    render(<WhereFields {...props({ hasStoredCoordinate: true })} />);

    expect(describedTextOf(screen.getByLabelText(LABEL.lat))).toBe(
      "Snapped to the precision below before it is saved. Leave both boxes empty to keep the coordinate this entry already has.",
    );
  });

  it("says a code and not a name for the country, which nothing downstream can tell apart", () => {
    render(<WhereFields {...props()} />);

    expect(describedTextOf(screen.getByLabelText(LABEL.country))).toBe(
      "The two-letter code, such as JP or IT — not the country's name.",
    );
  });

  it("says the place name is kept even when the coordinate is not", () => {
    render(<WhereFields {...props()} />);

    expect(describedTextOf(screen.getByLabelText(LABEL.place))).toContain(
      "Kept even when the coordinate is not.",
    );
  });

  it("gives the town or city no description at all", () => {
    render(<WhereFields {...props()} />);

    expect(screen.getByLabelText(LABEL.locality)).not.toHaveAttribute("aria-describedby");
  });
});
