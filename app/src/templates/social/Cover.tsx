import { locationLine, priceLine, specsLine } from "./facts.ts";
import { SocialFrame } from "./SocialFrame.tsx";
import type { SocialSource } from "./slides.ts";

interface CoverProps {
  spec: SocialSource;
  /** `x` is the 1200×675 image for X; `linkedin` is the cover itself, which the renderer clips to 1200×627. */
  crop?: "x" | "linkedin";
}

/** The 1200×630 cover, which is also the Open Graph image of a property. */
export function Cover({ spec, crop }: CoverProps) {
  const { property, images } = spec;
  const hero = images[0];
  return (
    <SocialFrame
      format={crop === "x" ? "cover-x" : "cover"}
      image={hero ? <img src={hero.url} alt={hero.alt} /> : null}
      location={locationLine(property)}
      price={priceLine(property)}
      specs={specsLine(property)}
    />
  );
}
