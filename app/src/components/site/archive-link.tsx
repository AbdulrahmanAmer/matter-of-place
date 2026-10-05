import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ArchiveKind } from "../../domain/archive";
import { archiveFacetsQuery } from "../../lib/queries";

/** The label as a link to its archive page when that page exists, and plain text otherwise. */
export function ArchiveLink({ kind, label }: { kind: ArchiveKind; label: string }) {
  const { data } = useQuery(archiveFacetsQuery());
  const slug = data?.facets[kind][label];
  if (slug === undefined) return label;
  return (
    <Link to="/archive/$kind/$slug" params={{ kind, slug }} className="archive-link">
      {label}
    </Link>
  );
}
