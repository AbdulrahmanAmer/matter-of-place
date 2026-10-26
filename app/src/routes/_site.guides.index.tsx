import { createFileRoute } from "@tanstack/react-router";
import { PageIntro } from "../components/site/page-intro";
import { seoPages } from "../content/seo";
import type { SeoPageContent } from "../content/seo/types";
import { breadcrumbLd, collectionLd } from "../lib/jsonld";
import { ogImageFor, ogStaticOf } from "../lib/og";
import { pageHead } from "../lib/seo";

const DESCRIPTION =
  "Plain guides to historic homes and to selling them, from Matter of Place, for owners, agents and readers in California, New York and Florida.";

const groups: { heading: string; kind: SeoPageContent["kind"] }[] = [
  { heading: "Kinds of home", kind: "collection" },
  { heading: "Selling and marketing", kind: "guide" },
];

export const Route = createFileRoute("/_site/guides/")({
  head: ({ matches }) =>
    pageHead({
      title: "Guides",
      description: DESCRIPTION,
      path: "/guides",
      image: ogImageFor({ key: "default", ogStatic: ogStaticOf(matches) }),
      jsonLd: [
        collectionLd(
          "guides",
          "Guides",
          "/guides",
          seoPages.map((page) => ({ name: page.h1, path: page.path })),
        ),
        breadcrumbLd([{ name: "Guides", path: "/guides" }]),
      ],
    }),
  component: GuidesPage,
});

function GuidesPage() {
  return (
    <main>
      <PageIntro
        eyebrow="GUIDES"
        title="Guides"
        text="Plain writing on the homes we follow and on how they are sold."
      />
      <div className="copy-page seo-page">
        {groups.map(({ heading, kind }) => {
          const pages = seoPages.filter((page) => page.kind === kind);
          return pages.length === 0 ? null : (
            <section key={kind} className="section-block">
              <h2>{heading}</h2>
              <ul className="seo-index">
                {pages.map((page) => (
                  <li key={page.path}>
                    <a href={page.path}>{page.h1}</a>
                    <p>{page.description}</p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}
