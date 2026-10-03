import { SocialFrame } from "./SocialFrame.tsx";

interface OgImage {
  url: string;
  alt: string;
}

type OgCardProps =
  | { variant: "default"; kicker: string; title: string }
  | { variant: "market" | "story"; kicker: string; title: string; image: OgImage };

/**
 * A 1200×630 card for a page that is not a property. The market and story variants carry a photograph; the default
 * one is the band alone. The title takes the frame's large serif line.
 */
export function OgCard(props: OgCardProps) {
  const image =
    props.variant === "default" ? null : <img src={props.image.url} alt={props.image.alt} />;
  return <SocialFrame format="cover" image={image} location={props.kicker} price={props.title} />;
}
