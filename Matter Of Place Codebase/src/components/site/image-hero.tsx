import type { ReactNode } from "react";
import { ContentTag } from "./content-tag";
import { t } from "../../lib/strings";

export function ImageHero({
  image,
  alt,
  eyebrow,
  title,
  children,
  tag = t.common.illustrativeImagery,
  scrollTarget,
}: {
  image: string;
  alt: string;
  eyebrow: string;
  title: string;
  /** Optional line beneath the title (price, headline). */
  children?: ReactNode;
  tag?: string;
  /** Element id the scroll cue points to; omit to hide the cue. */
  scrollTarget?: string;
}) {
  return (
    <section className="image-hero">
      <img src={image} width={1600} height={1104} alt={alt} fetchPriority="high" />
      <ContentTag label={tag} />
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
