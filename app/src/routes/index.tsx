import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ContentTag } from "../components/site/content-tag";
import { MarketGrid } from "../components/site/market-card";
import { OfferCard } from "../components/site/offer-card";
import { PropertyGrid } from "../components/site/property-card";
import { SectionHeading } from "../components/site/section-heading";
import { TextLink } from "../components/site/text-link";
import { siteConfig } from "../config/site";
import { editorialQualities, offerings, programmatic } from "../data/exposure";
import type { Property } from "../domain/property";
import { featuredProperties, heroProperties } from "../lib/catalog";
import { padIndex } from "../lib/format";
import { marketsQuery, propertiesQuery } from "../lib/queries";
import { pageHead } from "../lib/seo";

export const Route = createFileRoute("/")({
  loader: async ({ context: { queryClient } }) => {
    const [properties, markets] = await Promise.all([
      queryClient.ensureQueryData(propertiesQuery()),
      queryClient.ensureQueryData(marketsQuery()),
    ]);
    return {
      hero: heroProperties(properties),
      featured: featuredProperties(properties).slice(0, 6),
      markets,
    };
  },
  head: () =>
    pageHead({
      title: `${siteConfig.name} | Exceptional property. Properly considered.`,
      description: siteConfig.description,
      path: "/",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: siteConfig.name,
        url: siteConfig.url,
        parentOrganization: { "@type": "Organization", name: siteConfig.parentCompany },
      },
    }),
  component: HomePage,
});

const howItWorks = [
  {
    name: "Selected",
    text: "We review exceptional existing residential properties across California, New York and Florida.",
  },
  {
    name: "Edited",
    text: "Every selected property is shaped through our editorial and visual standards.",
  },
  { name: "Published", text: "The property receives a permanent place within Matter of Place." },
  {
    name: "Distributed",
    text: "Exposure products extend the story through social, email and precision programmatic media.",
  },
];

function HomePage() {
  const { hero, featured, markets } = Route.useLoaderData();
  return (
    <main>
      <Hero properties={hero} />

      <section className="section-wrap editorial-statement">
        <p className="eyebrow">MATTER OF PLACE</p>
        <div>
          <h2>Exceptional property. Properly considered.</h2>
          <p>
            An editorial real-estate media platform for exceptional residential property across
            California, New York and Florida. We select, present and distribute places worth
            attention.
          </p>
          <div className="home-actions">
            <TextLink to="/properties">Explore Properties</TextLink>
            <TextLink to="/submit">Submit a Property</TextLink>
          </div>
        </div>
      </section>

      <section className="section-wrap featured">
        <SectionHeading
          eyebrow="THE CURRENT EDIT"
          title="Selected properties"
          action={<TextLink to="/properties">All properties</TextLink>}
        />
        <PropertyGrid items={featured} />
      </section>

      <section className="markets-feature">
        <div className="section-wrap">
          <SectionHeading eyebrow="THREE MARKETS" title="One editorial point of view." />
          <MarketGrid markets={markets} />
        </div>
      </section>

      <section className="section-wrap editorial-statement home-idea">
        <p className="eyebrow">THE IDEA</p>
        <div>
          <h2>
            Not every property needs more marketing. The right property needs better attention.
          </h2>
          <p>
            We decide what deserves attention, frame it with editorial care, then extend it through
            owned and precision distribution.
          </p>
        </div>
      </section>

      <section className="section-wrap home-steps" aria-labelledby="how-heading">
        <SectionHeading eyebrow="HOW IT WORKS" title="Four steps." id="how-heading" />
        <ol className="steps-list steps-row">
          {howItWorks.map((step, index) => (
            <li key={step.name}>
              <span>{padIndex(index + 1)}</span>
              <strong>{step.name}</strong>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="professionals-strip" aria-labelledby="exposure-heading">
        <div className="section-wrap home-exposure">
          <SectionHeading
            eyebrow="PROPERTY EXPOSURE"
            title="Four ways in."
            id="exposure-heading"
            action={<TextLink to="/exposure">View Property Exposure</TextLink>}
          />
          <div className="offer-row">
            {offerings.map((offering) => (
              <OfferCard key={offering.id} offering={offering} compact />
            ))}
          </div>
        </div>
      </section>

      <section className="section-wrap editorial-statement home-idea">
        <p className="eyebrow">PRECISION DISTRIBUTION</p>
        <div>
          <h2>Beyond owned media.</h2>
          <p>
            Selected campaigns can extend beyond our editorial channels through targeted display,
            native, video, CTV and select digital out-of-home. Media from {programmatic.minimum}.
          </p>
          <TextLink to="/exposure">Explore Distribution</TextLink>
        </div>
      </section>

      <section className="section-wrap editorial-statement home-idea">
        <p className="eyebrow">EDITORIAL STANDARD</p>
        <div>
          <h2>{editorialQualities.join(". ")}.</h2>
          <TextLink to="/editorial-standard">Read Our Editorial Standard</TextLink>
        </div>
      </section>

      <section className="home-submit">
        <div className="section-wrap">
          <h2>A property worth attention?</h2>
          <p>
            Matter of Place is reviewing residential properties across California, New York and
            Florida.
          </p>
          <Link to="/submit" className="button">
            Submit a Property
          </Link>
        </div>
      </section>
    </main>
  );
}

function Hero({ properties }: { properties: Property[] }) {
  const [index, setIndex] = useState(0);
  const property = properties[index];
  const advance = (step: number) =>
    setIndex((current) => (current + step + properties.length) % properties.length);

  if (!property) return null;

  return (
    <section className="hero" aria-label="Selected properties">
      <img
        className="hero-image"
        key={property.slug}
        src={property.heroImage}
        width={1600}
        height={1104}
        alt={`Illustrative residence in ${property.city}`}
      />
      <ContentTag label="ILLUSTRATIVE PROPERTY" />

      <div className="hero-content">
        <p className="eyebrow">
          {property.city.toUpperCase()}, {property.state.toUpperCase()}
        </p>
        <h1>{property.title}</h1>
        <p className="hero-price">{property.style}</p>
        <TextLink to="/property/$slug" params={{ slug: property.slug }}>
          View property
        </TextLink>
      </div>

      <div className="hero-controls">
        <button type="button" aria-label="Previous property" onClick={() => advance(-1)}>
          <ArrowLeft size={20} />
        </button>
        <span className="hero-counter">
          {padIndex(index + 1)} / {padIndex(properties.length)}
        </span>
        <button type="button" aria-label="Next property" onClick={() => advance(1)}>
          <ArrowRight size={20} />
        </button>
      </div>
    </section>
  );
}
