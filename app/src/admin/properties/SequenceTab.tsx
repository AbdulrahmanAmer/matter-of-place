import { MediaGrid } from "../media/MediaGrid";

/**
 * Screen 8, Sequence: the property's photographs in order, the first being the hero (G66), with the same upload,
 * order, alt text and render state as screen 9. Orientation is shown, never edited, and is blank until the render
 * has run (G63).
 */
export function SequenceTab({ propertyId }: { propertyId: string }) {
  return <MediaGrid propertyId={propertyId} />;
}
