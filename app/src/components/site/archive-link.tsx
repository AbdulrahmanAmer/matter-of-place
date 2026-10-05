import { Link } from "@tanstack/react-router";
import type { ArchiveKind, FacetMap } from "../../domain/archive";

/** The label as a link to its archive page when that page exists, and plain text otherwise. */
export function ArchiveLink({
  kind,
  label,
  facets,
}: {
  kind: ArchiveKind;
  label: string;
  facets: FacetMap | null;
}) {
  const slug = facets?.[kind][label];
  if (slug === undefined) return label;
  return (
    <Link to="/archive/$kind/$slug" params={{ kind, slug }} className="archive-link">
      {label}
    </Link>
  );
}
