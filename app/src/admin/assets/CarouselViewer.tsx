import { useState, type PointerEvent } from "react";
import type { AdminAsset } from "../../domain/admin-assets";

const SWIPE_PX = 40;

/** The carousel's slides one at a time, by the buttons or by a swipe; `alts` holds the alt text of each slide in order. */
export function CarouselViewer({
  files,
  alts,
}: {
  files: AdminAsset["files"];
  alts: readonly string[];
}) {
  const slides = files
    .filter((file) => file.role === "slide")
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const [at, setAt] = useState(0);
  const [startX, setStartX] = useState<number | null>(null);
  const current = Math.min(at, Math.max(slides.length - 1, 0));
  const slide = slides[current];
  if (slide === undefined) return <p className="admin-asset__empty">No slides rendered yet.</p>;

  const go = (step: number) => {
    setAt(Math.min(Math.max(current + step, 0), slides.length - 1));
  };
  const release = (event: PointerEvent) => {
    if (startX !== null && Math.abs(event.clientX - startX) >= SWIPE_PX) {
      go(event.clientX < startX ? 1 : -1);
    }
    setStartX(null);
  };

  return (
    <figure className="admin-carousel" aria-label="Carousel slides">
      <img
        className="admin-carousel__slide"
        draggable={false}
        src={slide.url}
        width={slide.w}
        height={slide.h}
        alt={alts[current] ?? `Slide ${String(current + 1)} of ${String(slides.length)}`}
        onPointerDown={(event) => {
          setStartX(event.clientX);
        }}
        onPointerUp={release}
        onPointerCancel={() => {
          setStartX(null);
        }}
      />
      <figcaption className="admin-carousel__bar">
        <button
          type="button"
          className="admin-button admin-button--quiet"
          disabled={current === 0}
          onClick={() => {
            go(-1);
          }}
        >
          Previous slide
        </button>
        <span aria-live="polite">{`Slide ${String(current + 1)} of ${String(slides.length)}`}</span>
        <button
          type="button"
          className="admin-button admin-button--quiet"
          disabled={current === slides.length - 1}
          onClick={() => {
            go(1);
          }}
        >
          Next slide
        </button>
      </figcaption>
    </figure>
  );
}
