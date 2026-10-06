import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReelPlayer } from "./ReelPlayer";

const gate = {
  coverage: 90.9,
  longest_static_s: 0.9,
  cuts: 16,
  avg_shot_s: 4.27,
  lufs: -18.12,
  true_peak: -1.69,
  flatness: 0.152,
};

const asset = {
  files: [
    { role: "poster", url: "/media/assets/p/reel/r1/poster.ab12cd34.jpg" },
    { role: "video", url: "/media/assets/p/reel/r1/reel.ab12cd34.mp4" },
  ],
  meta: { duration_s: 18, fps: 30, gate, spec_hash: "x" },
};

const filmOf = (container: HTMLElement) => {
  const film = container.querySelector("video");
  if (!film) throw new Error("no video element");
  return film;
};

describe("ReelPlayer", () => {
  it("shows the poster file before play", () => {
    const { container } = render(<ReelPlayer asset={asset} />);
    expect(filmOf(container).getAttribute("poster")).toBe(
      "/media/assets/p/reel/r1/poster.ab12cd34.jpg",
    );
  });

  it("plays the file with the video role, whatever its position", () => {
    const { container } = render(<ReelPlayer asset={asset} />);
    expect(filmOf(container).getAttribute("src")).toBe("/media/assets/p/reel/r1/reel.ab12cd34.mp4");
  });

  it("loads nothing until played", () => {
    const { container } = render(<ReelPlayer asset={asset} />);
    const film = filmOf(container);
    expect(film.getAttribute("preload")).toBe("none");
    expect(film.hasAttribute("controls")).toBe(true);
    expect(film.hasAttribute("autoplay")).toBe(false);
  });

  it("lists the gate numbers in a details block", () => {
    const { container } = render(<ReelPlayer asset={asset} />);
    const details = container.querySelector("details");
    expect(details?.textContent).toContain("Loudness-18.12 LUFS");
    expect(details?.textContent).toContain("Cuts16");
    expect(details?.textContent).toContain("18 s at 30 frames per second");
  });

  it("shows no details block when the asset has no gate numbers", () => {
    const { container } = render(<ReelPlayer asset={{ ...asset, meta: {} }} />);
    expect(container.querySelector("details")).toBeNull();
    expect(filmOf(container).getAttribute("src")).toBe("/media/assets/p/reel/r1/reel.ab12cd34.mp4");
  });

  it("says so when no film has been rendered", () => {
    render(<ReelPlayer asset={{ files: [], meta: null }} />);
    expect(screen.getByText("No film rendered yet.")).toBeTruthy();
  });
});
