import type { ReactNode } from "react";
import type { ImageVariants } from "../../domain/property";
import { ContentTag } from "./content-tag";
import { Picture } from "./picture";

export function ImageHero({
  image,
  variants,
  alt,
  eyebrow,
  title,
  children,
  tag,
  scrollTarget,
}: {
  /** Nothing is drawn without one: a market, region or story may have no photograph yet (G55). */
  image?: string | undefined;
  variants?: ImageVariants | undefined;
  alt: string;
  eyebrow: string;
  title: string;
  /** Optional line beneath the title (price, headline). */
  children?: ReactNode;
  /** A label over the photograph; none unless a caller passes one. */
  tag?: string;
  /** Element id the scroll cue points to; omit to hide the cue. */
  scrollTarget?: string;
}) {
  return (
    <section className="image-hero">
      {image !== undefined && (
        <Picture
          src={image}
          variants={variants}
          sizes="100vw"
          width={1600}
          height={1104}
          alt={alt}
          priority
        />
      )}
      {tag !== undefined && <ContentTag label={tag} />}
      <div className="image-hero-content">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {children}
      </div>
      {scrollTarget && (
        <a className="scroll-cue" href={`#${scrollTarget}`} aria-label="Scroll to details">
          <span />
        </a>
      )}
    </section>
  );
}
