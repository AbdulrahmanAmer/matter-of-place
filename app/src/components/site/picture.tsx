import type { ImageVariants } from "../../domain/property";

/**
 * The one component that draws a content photograph. With `variants` (WebP renditions at `/media/<key>`) the
 * browser picks from a `srcset`; without them (the bundled stills) it takes `src`. The size is always declared, so
 * the page never shifts; a `priority` image (the first screen) is fetched at once, every other one is lazy.
 */
export function Picture({
  src,
  alt,
  width,
  height,
  sizes,
  priority = false,
  variants,
  className,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  priority?: boolean;
  variants?: ImageVariants | undefined;
  className?: string;
}) {
  const srcSet = [variants?.card, variants?.hero]
    .map((rendition) => rendition && `${rendition.webp} ${String(rendition.w)}w`)
    .filter(Boolean)
    .join(", ");
  return (
    <img
      className={className}
      src={src}
      srcSet={srcSet || undefined}
      sizes={sizes}
      width={width}
      height={height}
      alt={alt}
      {...(priority ? { fetchPriority: "high" } : { loading: "lazy", decoding: "async" })}
    />
  );
}
