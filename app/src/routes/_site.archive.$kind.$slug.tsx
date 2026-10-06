import { createFileRoute, notFound } from "@tanstack/react-router";
import { IllustrativeNotice } from "../components/site/illustrative-notice";
import { PageIntro } from "../components/site/page-intro";
import { PropertyGrid } from "../components/site/property-card";
import { archiveKinds, type ArchiveKind } from "../domain/archive";
import { useTrackView } from "../hooks/use-track-view";
import { pluralize } from "../lib/format";
import { breadcrumbLd, collectionLd } from "../lib/jsonld";
import { archiveQuery } from "../lib/queries";
import { ogImageFor, ogStaticOf } from "../lib/og";
import { pageHead, unavailableHead } from "../lib/seo";
import { archiveDescription } from "../lib/seo-copy";

const eyebrows: Record<ArchiveKind, string> = {
  city: "CITY",
  architect: "ARCHITECT",
  style: "STYLE",
};

const titles: Record<ArchiveKind, (label: string) => string> = {
  city: (label) => `Properties in ${label}`,
  architect: (label) => `Properties by ${label}`,
  style: (label) => `${label} properties`,
};

export const Route = createFileRoute("/_site/archive/$kind/$slug")({
  loader: async ({ params, context: { queryClient } }) => {
    const kind = archiveKinds.find((candidate) => candidate === params.kind);
    if (kind === undefined) throw notFound();
    const facet = await queryClient.ensureQueryData(archiveQuery(kind, params.slug));
    if (facet === null) throw notFound();
    return facet;
  },
  head: ({ loaderData, matches }) => {
    if (!loaderData) return unavailableHead("Archive");
    const { kind, slug, label, count, items } = loaderData;
    const title = titles[kind](label);
    const path = `/archive/${kind}/${slug}`;
    return pageHead({
      title,
      description: archiveDescription(kind, label, count),
      path,
      image: ogImageFor({ key: "default", ogStatic: ogStaticOf(matches) }),
      jsonLd: [
        collectionLd(
          kind,
          title,
          path,
          items.map((property) => ({ name: property.title, path: `/property/${property.slug}` })),
        ),
        breadcrumbLd([
          { name: "Properties", path: "/properties" },
          { name: title, path },
        ]),
      ],
    });
  },
  component: ArchivePage,
});

function ArchivePage() {
  const { kind, slug, label, count, items } = Route.useLoaderData();
  useTrackView("archive_view", `${kind}/${slug}`, { kind, slug, count });

  return (
    <main>
      <PageIntro
        eyebrow={eyebrows[kind]}
        title={label}
        text={`${String(count)} published ${pluralize(count, "property", "properties")}.`}
      />
      <IllustrativeNotice properties={items} />
      <section className="section-wrap featured">
        <PropertyGrid items={items} />
      </section>
    </main>
  );
}
