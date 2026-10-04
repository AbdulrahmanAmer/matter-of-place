import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { ImageHero } from "../components/site/image-hero";
import { PageIntro } from "../components/site/page-intro";
import { TextLink } from "../components/site/text-link";
import type { Note } from "../domain/market";
import { useTrackView } from "../hooks/use-track-view";
import { marketQuery } from "../lib/queries";
import { breadcrumbLd } from "../lib/jsonld";
import { pageHead, unavailableHead } from "../lib/seo";
import { marketGuideDescription } from "../lib/seo-copy";

export const Route = createFileRoute("/_site/$market/guide")({
  loader: async ({ params, context: { queryClient } }) => {
    const market = await queryClient.ensureQueryData(marketQuery(params.market));
    if (!market) throw notFound();
    return market;
  },
  head: ({ loaderData: market }) => {
    if (!market) return unavailableHead("Guide");
    return pageHead({
      title: `${market.name} guide`,
      description: marketGuideDescription(market),
      path: `/${market.slug}/guide`,
      jsonLd: [
        breadcrumbLd([
          { name: "Markets", path: "/markets" },
          { name: market.name, path: `/${market.slug}` },
          { name: "Guide", path: `/${market.slug}/guide` },
        ]),
      ],
      type: "article",
    });
  },
  component: GuidePage,
});

function NoteList({ notes, className }: { notes: Note[]; className?: string }) {
  return (
    <dl className={className}>
      {notes.map((note) => (
        <div key={note.label}>
          <dt>{note.label}</dt>
          <dd>{note.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function GuidePage() {
  const market = Route.useLoaderData();
  useTrackView("market_view", `${market.slug}/guide`, { market: market.name, page: "guide" });

  return (
    <main>
      {market.comingSoon || market.image === undefined ? (
        <PageIntro eyebrow="GUIDE" title={market.name} />
      ) : (
        <ImageHero
          image={market.image}
          alt={`${market.name} architecture`}
          eyebrow="GUIDE"
          title={market.name}
        />
      )}

      <section className="section-wrap guide-block">
        <p className="eyebrow">NEIGHBORHOODS</p>
        {market.regions.map((region) => {
          const list = market.guide.neighborhoods.filter((item) => item.region === region.slug);
          if (!list.length) return null;
          return (
            <div key={region.slug} className="guide-region">
              <Link
                to="/$market/$region"
                params={{ market: market.slug, region: region.slug }}
                className="guide-region-name"
              >
                {region.name} <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
              <dl>
                {list.map((item) => (
                  <div key={item.name}>
                    <dt>{item.name}</dt>
                    <dd>{item.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </section>

      <section className="section-wrap guide-block">
        <p className="eyebrow">WHAT CLIENTS ASK OF US</p>
        <NoteList notes={market.guide.needs} className="guide-cols" />
      </section>

      <section className="section-wrap guide-block">
        <p className="eyebrow">HOW WE WORK HERE</p>
        <NoteList notes={market.guide.service} className="guide-cols" />
        <div className="guide-links">
          <TextLink to="/$market" params={{ market: market.slug }}>
            Properties in {market.name}
          </TextLink>
          <TextLink to="/submit">Submit a property</TextLink>
        </div>
      </section>
    </main>
  );
}
