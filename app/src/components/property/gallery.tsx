import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Play } from "lucide-react";
import type { GalleryImage, Property, PropertyVideo } from "../../domain/property";
import { track } from "../../lib/analytics";
import { cx } from "../../lib/cx";

/** Editorial rhythm: landscapes full width, portraits paired side by side. */
const intoRows = (images: GalleryImage[]): GalleryImage[][] => {
  const rows: GalleryImage[][] = [];
  let pair: GalleryImage[] = [];
  for (const image of images) {
    if (image.orientation === "portrait") {
      pair.push(image);
      if (pair.length === 2) {
        rows.push(pair);
        pair = [];
      }
    } else {
      if (pair.length) rows.push(pair);
      pair = [];
      rows.push([image]);
    }
  }
  if (pair.length) rows.push(pair);
  return rows;
};

/** Left and Right bring the next or previous image row to the middle of the screen: one Tab stop, not one per photograph. */
const stepImage = (event: KeyboardEvent<HTMLDivElement>) => {
  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (step === 0 || event.target !== event.currentTarget) return;
  event.preventDefault();
  const figures = [...event.currentTarget.querySelectorAll("figure")].map((figure) => ({
    figure,
    box: figure.getBoundingClientRect(),
  }));
  const here = figures.find(({ box }) => box.bottom > window.innerHeight / 2) ?? figures.at(-1);
  const rows = figures.filter(({ box }) =>
    here === undefined ? false : (box.top - here.box.top) * step > 1,
  );
  (step > 0 ? rows[0] : rows.at(-1))?.figure.scrollIntoView({ block: "center" });
};

export function Gallery({
  images,
  video,
  city,
  slug,
  status,
}: {
  images: GalleryImage[];
  video?: PropertyVideo | undefined;
  city: string;
  slug: string;
  status: Property["status"];
}) {
  const ref = useRef<HTMLDivElement>(null);

  // One engagement event per property, the first time the gallery scrolls into view.
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          track("gallery_engagement", { slug });
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [slug]);

  if (!images.length && !video) return null;

  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- the gallery is one labelled Tab stop whose arrow keys step the images (WCAG 2.1.1) */
  return (
    <div
      className="dossier-gallery"
      ref={ref}
      role="region"
      aria-label={`Photography of the ${city} property`}
      tabIndex={0}
      onKeyDown={stepImage}
    >
      {video && <PropertyFilm video={video} city={city} slug={slug} />}
      {intoRows(images).map((row) => (
        <div
          key={row.map((image) => image.src).join("|")}
          className={row.length === 2 ? "gallery-pair" : "gallery-full"}
        >
          {row.map((image) => (
            <figure key={image.src + image.alt}>
              <img
                src={image.src}
                loading="lazy"
                width={image.orientation === "portrait" ? 1024 : 1600}
                height={image.orientation === "portrait" ? 1312 : 1104}
                alt={status === "Illustrative" ? `${image.alt}, illustrative` : image.alt}
              />
              <figcaption>{image.alt}</figcaption>
            </figure>
          ))}
        </div>
      ))}
    </div>
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- the gallery element above is the only one */
}

/** Poster frame first; the film loads only when the visitor asks for it. */
export function PropertyFilm({
  video,
  city,
  slug,
}: {
  video: PropertyVideo;
  city: string;
  slug: string;
}) {
  const [playing, setPlaying] = useState(false);

  const play = () => {
    setPlaying(true);
    track("gallery_engagement", { slug, media: "video" });
  };

  return (
    <div className={cx("gallery-full", "gallery-film", playing && "is-playing")}>
      <figure>
        {playing ? (
          <video
            src={video.src}
            poster={video.poster}
            controls
            autoPlay
            muted
            loop
            playsInline
            preload="none"
            aria-label={`${video.caption}, illustrative film of the ${city} property`}
          />
        ) : (
          <>
            <img
              src={video.poster}
              loading="lazy"
              width={1600}
              height={1104}
              alt={`${video.caption}, poster frame`}
            />
            <button
              type="button"
              className="film-play"
              onClick={play}
              aria-label="Play property film"
            >
              <span className="film-play-ring">
                <Play size={18} aria-hidden="true" />
              </span>
              <span>Play film · {video.duration}</span>
            </button>
          </>
        )}
        <figcaption>{video.caption}</figcaption>
      </figure>
    </div>
  );
}
