import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PropertyVideo } from "../../domain/property";
import { Gallery } from "./gallery";

const video: PropertyVideo = {
  src: "/media/assets/p/reel/r1/reel.ab12cd34.mp4",
  poster: "/media/assets/p/reel/r1/poster.ab12cd34.jpg",
  caption: "A walk through the house",
  duration: "0:18",
};

const gallery = (withVideo: boolean) => (
  <Gallery
    images={[{ src: "/media/a.jpg", alt: "Terrace", orientation: "landscape" }]}
    video={withVideo ? video : undefined}
    city="Malibu"
    slug="malibu-house"
    status="Active"
  />
);

describe("Gallery film", () => {
  it("names the film without calling it illustrative", () => {
    const { container } = render(gallery(true));
    fireEvent.click(screen.getByRole("button", { name: "Play property film" }));
    const label = container.querySelector("video")?.getAttribute("aria-label");
    expect(label).toBe("A walk through the house, film of the Malibu property");
    expect(label).not.toMatch(/illustrative/i);
  });

  it("gives the film figure the portrait class, with the caption beside it", () => {
    const { container } = render(gallery(true));
    const figure = container.querySelector(".gallery-film figure");
    expect(figure?.classList.contains("film-portrait")).toBe(true);
    expect(figure?.querySelector("figcaption")?.textContent).toBe("A walk through the house");
  });

  it("renders no film without a video", () => {
    const { container } = render(gallery(false));
    expect(container.querySelector("figure img")?.getAttribute("alt")).toBe("Terrace");
    expect(container.querySelector(".gallery-film")).toBeNull();
    expect(container.querySelector("video")).toBeNull();
  });
});
