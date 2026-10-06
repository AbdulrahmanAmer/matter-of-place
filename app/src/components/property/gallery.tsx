import { useEffect, useRef, useState } from "react";
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

  return (
    <div className="dossier-gallery" ref={ref} aria-label={`Photography of the ${city} property`}>
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
}

/** Poster frame first; the film loads only when the visitor asks for it. */
function PropertyFilm({ video, city, slug }: { video: PropertyVideo; city: string; slug: string }) {
  const [playing, setPlaying] = useState(false);

  const play = () => {
    setPlaying(true);
    track("gallery_engagement", { slug, media: "video" });
  };

  return (
    <div className={cx("gallery-full", "gallery-film", playing && "is-playing")}>
      <figure className="film-portrait">
        {playing ? (
          <video
            src={video.src}
            poster={video.poster}
            controls
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={`${video.caption}, film of the ${city} property`}
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
