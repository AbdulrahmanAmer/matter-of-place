/** What a social template reads from a render spec: the property facts and its photographs, hero first. */
export interface SocialSource {
  property: SpecProperty;
  images: SpecImage[];
}

export interface SpecProperty {
  id: string;
  slug: string;
  title: string;
  city: string;
  state: string;
  market: string;
  price: number;
  currency: string;
  beds: number;
  baths: number;
  interiorSqFt: number;
  yearBuilt: number;
  type: string;
  place?: string;
}

interface SpecImage {
  url: string;
  alt: string;
  orientation: "landscape" | "portrait";
  w: number;
  h: number;
}

/** One slide of the carousel. `image` indexes `SocialSource.images`. */
export type SlideSpec =
  | { kind: "cover" | "photo" | "facts" | "close"; image: number }
  | { kind: "place"; image: number; text: string };

const MIN_SLIDES = 6;
const LINKEDIN_PHOTOS = 3;

function firstSentence(text: string): string {
  const match = /^.*?[.!?](?=\s|$)/s.exec(text.trim());
  return match ? match[0] : text.trim();
}

/**
 * The slides of one carousel: the cover, three or four photographs, the facts, the place when the property has a
 * paragraph for it and `maxSlides` leaves room, and the close. Always 6 to 8 slides, whatever `maxSlides` is, and 6 when
 * it is 6. Every slide carries a photograph; they follow the gallery in order and the close returns to the hero.
 */
export function planCarousel(spec: SocialSource, maxSlides = 8): SlideSpec[] {
  const place = (spec.property.place ?? "").trim();
  const count = spec.images.length;
  const withPlace = place !== "" && maxSlides > MIN_SLIDES;
  const photos = count > 4 && maxSlides > MIN_SLIDES + (withPlace ? 1 : 0) ? 4 : 3;

  const slides: SlideSpec[] = [{ kind: "cover", image: 0 }];
  for (let at = 1; at <= photos; at += 1) slides.push({ kind: "photo", image: at % count });
  slides.push({ kind: "facts", image: slides.length % count });
  if (withPlace) {
    slides.push({ kind: "place", image: slides.length % count, text: firstSentence(place) });
  }
  slides.push({ kind: "close", image: 0 });
  return slides;
}

/** The square set for LinkedIn: the cover and two or three photographs, as many as the gallery holds. */
export function planLinkedInSet(spec: SocialSource): SlideSpec[] {
  const photos = Math.min(LINKEDIN_PHOTOS, spec.images.length - 1);
  const slides: SlideSpec[] = [{ kind: "cover", image: 0 }];
  for (let at = 1; at <= photos; at += 1) slides.push({ kind: "photo", image: at });
  return slides;
}
