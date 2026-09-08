// @vitest-environment jsdom
/**
 * The photo group alone: the picker, and one row per picked file in each of the
 * four states it passes through. ./notes.md#what-this-test-pins
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PhotoFields from "./photo-fields";
import type { PhotoFieldsProps, PhotoSlot } from "./photo-fields";

/** Manual: @testing-library/react registers auto-cleanup only when `afterEach`
 *  is a global, and this project runs vitest without `globals: true`. */
afterEach(cleanup);

const PHOTOS = "Photos";
const MEDIA = "https://me.solidcommunity.net/travel/media";

const jpeg = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });

const ready = (name: string, thumbnail = true): PhotoSlot => ({
  key: `k-${name}`,
  name,
  state: "ready",
  photo: {
    contentUrl: `${MEDIA}/abc/web.webp`,
    ...(thumbnail ? { thumbnailUrl: `${MEDIA}/abc/thumb.webp` } : {}),
  },
});

function props(over: Partial<PhotoFieldsProps> = {}): PhotoFieldsProps {
  return { slots: [], onPicked: vi.fn(), ...over };
}

describe("the photo group's picker", () => {
  it("takes any image, several at once, and names itself once", () => {
    // No `aria-label` anywhere in this block: `getByLabelText` matches it on
    // ANY element, and a named wrapper once cost this file six tests.
    render(<PhotoFields {...props()} />);

    const input = screen.getByLabelText(PHOTOS) as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toBe("image/*");
    expect(input.multiple).toBe(true);
    expect(screen.getAllByLabelText(PHOTOS)).toHaveLength(1);
  });

  it("says the bytes reach the Pod before Save is pressed", () => {
    render(<PhotoFields {...props()} />);

    const input = screen.getByLabelText(PHOTOS);
    expect(input).toHaveAttribute("aria-describedby", "entry-photos-hint");
    expect(document.getElementById("entry-photos-hint")?.textContent).toBe(
      "Resized in this browser, stripped of their location and their camera metadata, and " +
        "uploaded to your Pod as soon as you pick them.",
    );
  });

  it("reports EVERY file from one pick, in order, in a single call", () => {
    // The picker is `multiple` and the editor starts all of them at once. A
    // group that reported only `files[0]` passes every one-file test there is.
    const wired = props();
    render(<PhotoFields {...wired} />);
    const first = jpeg("first.jpg");
    const second = jpeg("second.jpg");

    fireEvent.change(screen.getByLabelText(PHOTOS), { target: { files: [first, second] } });

    expect(wired.onPicked).toHaveBeenCalledTimes(1);
    expect(wired.onPicked).toHaveBeenCalledWith([first, second]);
  });

  it("clears the input, so picking the same file again is another change", () => {
    const wired = props();
    render(<PhotoFields {...wired} />);
    const input = screen.getByLabelText(PHOTOS) as HTMLInputElement;

    fireEvent.change(input, { target: { files: [jpeg("a.jpg")] } });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { files: [jpeg("a.jpg")] } });
    expect(wired.onPicked).toHaveBeenCalledTimes(2);
  });

  it("reports an empty pick as an empty list rather than throwing", () => {
    const wired = props();
    render(<PhotoFields {...props(wired)} />);

    fireEvent.change(screen.getByLabelText(PHOTOS), { target: { files: [] } });

    expect(wired.onPicked).toHaveBeenCalledWith([]);
  });
});

describe("the photo group announces what each picked file is doing", () => {
  it("renders no list at all until something is picked", () => {
    render(<PhotoFields {...props()} />);

    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says a file is being prepared while it decodes, with no image yet", () => {
    render(
      <PhotoFields {...props({ slots: [{ key: "k", name: "a.jpg", state: "decoding" }] })} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Preparing a.jpg…");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("says a file is uploading once it has decoded", () => {
    render(
      <PhotoFields {...props({ slots: [{ key: "k", name: "a.jpg", state: "uploading" }] })} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Uploading a.jpg…");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows the thumbnail FROM THE POD once a file is attached", () => {
    // Not an object URL: one dies with the page, so a draft restored tomorrow
    // would show a broken image.
    render(<PhotoFields {...props({ slots: [ready("a.jpg")] })} />);

    const image = screen.getByRole("img", { name: "a.jpg" });
    expect(image).toHaveAttribute("src", `${MEDIA}/abc/thumb.webp`);
    expect(screen.getByRole("status")).toHaveTextContent("a.jpg is attached to this entry.");
  });

  it("falls back to the web derivative when there is no thumbnail", () => {
    render(<PhotoFields {...props({ slots: [ready("a.jpg", false)] })} />);

    expect(screen.getByRole("img", { name: "a.jpg" })).toHaveAttribute(
      "src",
      `${MEDIA}/abc/web.webp`,
    );
  });

  it("interrupts for a file that will never be attached, and only for that", () => {
    // `alert` is assertive and interrupts a screen reader mid-sentence, which
    // "your photo is uploading" has not earned and a refusal has.
    render(
      <PhotoFields
        {...props({
          slots: [{ key: "k", name: "a.jpg", state: "failed", message: "too large" }],
        })}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("a.jpg was not attached: too large");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders one row per slot, keyed on the slot rather than the file name", () => {
    // Two cameras both call their first photo IMG_0001.jpg, and the same file
    // can be picked twice while the first is still decoding.
    render(
      <PhotoFields
        {...props({
          slots: [
            { key: "k1", name: "IMG_0001.jpg", state: "decoding" },
            { key: "k2", name: "IMG_0001.jpg", state: "uploading" },
          ],
        })}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("status").map((el) => el.textContent)).toEqual([
      "Preparing IMG_0001.jpg…",
      "Uploading IMG_0001.jpg…",
    ]);
  });

  it("puts no named region around the list, which would shadow the picker", () => {
    render(<PhotoFields {...props({ slots: [ready("a.jpg")] })} />);

    expect(screen.getAllByLabelText(PHOTOS)).toHaveLength(1);
    expect(screen.queryByRole("region")).toBeNull();
  });
});
