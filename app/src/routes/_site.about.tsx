import { createFileRoute } from "@tanstack/react-router";
import { PageIntro } from "../components/site/page-intro";
import { TextLink } from "../components/site/text-link";
import { breadcrumbLd } from "../lib/jsonld";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";

export const Route = createFileRoute("/_site/about")({
  head: () =>
    pageHead({
      title: "About",
      description: pageDescription("about"),
      path: "/about",
      jsonLd: [breadcrumbLd([{ name: "About", path: "/about" }])],
    }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <main>
      <PageIntro eyebrow="ABOUT" title="Real estate is not simply inventory." />

      <div className="copy-page">
        <section className="about-intro">
          <p>
            A property can carry architecture, memory, landscape, design, craft and culture. Matter
            of Place exists to find those places, present them with care, and give them the
            attention they deserve.
          </p>
          <p>
            Today we focus only on California, New York and Florida, and only on existing
            residential property. We are intentionally narrow.
          </p>
          <p>
            Our ambition is not to publish everything. It is to build a meaningful point of view on
            the properties, people, architecture and places shaping three of America's most
            significant residential markets.
          </p>
        </section>

        <section className="section-block">
          <h2>What we do</h2>
          <p>We curate it. We frame it. We publish it. We distribute it.</p>
          <p>
            Editorial authority decides what deserves attention. Precision distribution decides how
            far that attention travels.
          </p>
        </section>

        <section className="section-block">
          <h2>What we do not do</h2>
          <p>
            We are not a brokerage and do not represent anyone in a sale. We do not sell leads or
            guarantee buyers. We do not publish everything we receive.
          </p>
        </section>

        <section className="section-block">
          <h2>An Omnikom company</h2>
          <p>
            Omnikom provides the media and distribution infrastructure beneath the platform. Matter
            of Place owns the editorial point of view.
          </p>
        </section>

        <section className="about-footer">
          <p>Exceptional property. Properly considered.</p>
          <TextLink to="/properties">Explore Properties</TextLink>
        </section>
      </div>
    </main>
  );
}
