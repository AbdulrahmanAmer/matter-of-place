import { AssetCards } from "../assets/AssetCards";
import { useAssets } from "../assets/assets-queries";
import { EmptyState } from "../ui/EmptyState";

/**
 * W3 stage 6: the property's carousels, reels and images on its own page, approved, captioned or rendered again
 * here, without choosing the property a second time on the Visuals screen.
 */
export function VisualsTab({ propertyId }: { propertyId: string }) {
  const list = useAssets({ property_id: propertyId });
  if (list.isPending) return <p role="status">Loading the visuals.</p>;
  if (list.isError) return <p role="alert">{list.error.message}</p>;
  if (list.data.items.length === 0) {
    return (
      <EmptyState title="No visuals yet">
        The carousel, the reel and the share images appear here once the photographs are rendered.
      </EmptyState>
    );
  }
  return <AssetCards items={list.data.items} />;
}
