import { padIndex } from "../../lib/format.ts";
import { locationLine, priceLine, specsLine } from "./facts.ts";
import { SocialFrame } from "./SocialFrame.tsx";
import type { SlideSpec, SocialSource } from "./slides.ts";

interface CarouselSlideProps {
  spec: SocialSource;
  slide: SlideSpec;
  /** Zero-based position of the slide in the planned carousel. */
  index: number;
  total: number;
}

/** One 1080×1350 slide: the cover carries the full frame, the others one photograph and the lines that slide needs. */
export function CarouselSlide({ spec, slide, index, total }: CarouselSlideProps) {
  const { property, images } = spec;
  const photo = images[slide.image];
  const frame = {
    format: "carousel",
    image: photo ? <img src={photo.url} alt={photo.alt} /> : null,
    marker: `${padIndex(index + 1)} / ${padIndex(total)}`,
    location: locationLine(property),
  } as const;

  switch (slide.kind) {
    case "cover":
      return (
        <SocialFrame
          {...frame}
          headline={property.title}
          price={priceLine(property)}
          specs={specsLine(property)}
        />
      );
    case "facts":
      return (
        <SocialFrame
          {...frame}
          headline={`${property.type}, built ${String(property.yearBuilt)}`}
          price={priceLine(property)}
          specs={specsLine(property)}
        />
      );
    case "place":
      return <SocialFrame {...frame} headline={slide.text} />;
    case "close":
      return <SocialFrame {...frame} headline={property.title} />;
    case "photo":
      return <SocialFrame {...frame} />;
  }
}
