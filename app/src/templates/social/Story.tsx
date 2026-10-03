import { locationLine, priceLine, specsLine } from "./facts.ts";
import { SocialFrame } from "./SocialFrame.tsx";
import type { SocialSource } from "./slides.ts";

/** The 1080×1920 story. */
export function Story({ spec }: { spec: SocialSource }) {
  const { property, images } = spec;
  const hero = images[0];
  return (
    <SocialFrame
      format="story"
      image={hero ? <img src={hero.url} alt={hero.alt} /> : null}
      location={locationLine(property)}
      headline={property.title}
      price={priceLine(property)}
      specs={specsLine(property)}
    />
  );
}
