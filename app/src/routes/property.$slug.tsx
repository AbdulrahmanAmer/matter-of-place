import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Bookmark, Check, Share2 } from "lucide-react";
import { InquiryDialog, type Intent } from "../components/forms/inquiry-dialog";
import { AskMatterOfPlace } from "../components/property/concierge";
import { DossierFacts } from "../components/property/dossier-facts";
import { Gallery } from "../components/property/gallery";
import { Representation } from "../components/property/representation";
import { ShareCover } from "../components/property/share-cover";
import { StickyActions } from "../components/property/sticky-actions";
import { Breadcrumb } from "../components/site/breadcrumb";
import { ImageHero } from "../components/site/image-hero";
import { InquiryBlock } from "../components/site/inquiry-block";
import { PlaceMap } from "../components/site/place-map";
import { PropertyGrid } from "../components/site/property-card";
import { SectionHeading } from "../components/site/section-heading";
import { TextButton, TextLink } from "../components/site/text-link";
import { absoluteUrl, siteConfig } from "../config/site";
import { useTrackView } from "../hooks/use-track-view";
import { track } from "../lib/analytics";
import { formatPrice, marketOf, regionOf, relatedProperties } from "../lib/catalog";
import { cx } from "../lib/cx";
import { formatNumber } from "../lib/format";
import { marketsQuery, propertiesQuery, propertyQuery } from "../lib/queries";
import { pageHead, unavailableHead } from "../lib/seo";

export const Route = createFileRoute("/property/$slug")({
  loader: async ({ params, context: { queryClient } }) => {
    const [property, properties, markets] = await Promise.all([
      queryClient.ensureQueryData(propertyQuery(params.slug)),
      queryClient.ensureQueryData(propertiesQuery()),
      queryClient.ensureQueryData(marketsQuery()),
    ]);
    if (!property) throw notFound();
    const market = marketOf(markets, property.market);
    const region = regionOf(markets, property.market, property.region);
    if (!market || !region) throw notFound();
    return { property, market, region, related: relatedProperties(properties, property, 3) };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return unavailableHead("Property");
    const { property } = loaderData;
    return pageHead({
      title: `${property.title} ${property.city}`,
      description: `${property.city}, ${property.state}: ${property.beds} bedrooms, ${formatNumber(property.interiorSqFt)} sq ft, ${property.style.toLowerCase()} architecture and a sense of place.`,
      path: `/property/${property.slug}`,
      type: "article",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "SingleFamilyResidence",
        name: property.title,
        url: absoluteUrl(`/property/${property.slug}`),
        numberOfRooms: property.beds,
        numberOfBathroomsTotal: property.baths,
        yearBuilt: property.yearBuilt,
        floorSize: { "@type": "QuantitativeValue", value: property.interiorSqFt, unitCode: "FTK" },
        address: {
          "@type": "PostalAddress",
          addressLocality: property.city,
          addressRegion: property.state,
          addressCountry: property.country,
        },
        publisher: { "@type": "Organization", name: siteConfig.name },
      },
    });
  },
  component: PropertyPage,
});

function PropertyPage() {
  const { property, market, region, related } = Route.useLoaderData();
  const [intent, setIntent] = useState<Intent | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const closeIntent = useCallback(() => setIntent(null), []);

  useTrackView("property_view", property.slug, { slug: property.slug });

  useEffect(() => {
    setSaved(false);
    setCopied(false);
    setAskOpen(false);
  }, [property.slug]);

  const share = async () => {
    track("share", { slug: property.slug });
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${property.title} | ${siteConfig.name}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // The visitor dismissed the share sheet.
    }
  };

  const toggleSaved = () => {
    setSaved((current) => !current);
    track("property_save", { slug: property.slug, saved: !saved });
  };

  const requestShowing = () => {
    setAskOpen(false);
    setIntent("showing");
  };

  const subject = {
    kind: "property",
    slug: property.slug,
    title: `${property.title} ${property.city}`,
  } as const;

  return (
    <main>
      <ImageHero
        image={property.heroImage}
        alt={`Illustrative architecture in ${property.city}`}
        eyebrow={`${property.city.toUpperCase()}, ${property.state.toUpperCase()}`}
        title={property.title}
        tag="ILLUSTRATIVE PROPERTY"
        scrollTarget="dossier"
      >
        <p>{formatPrice(property)}</p>
      </ImageHero>

      <div className="section-wrap" id="dossier">
        <div className="dossier-toolbar">
          <Breadcrumb>
            <Link to="/">Home</Link>
            <Link to="/markets">Markets</Link>
            <Link to="/$market" params={{ market: market.slug }}>
              {market.name}
            </Link>
            <Link to="/$market/$region" params={{ market: market.slug, region: region.slug }}>
              {region.name}
            </Link>
          </Breadcrumb>
          <div className="dossier-actions">
            <button
              type="button"
              className={cx("pill-button", saved && "on")}
              onClick={toggleSaved}
              aria-pressed={saved}
            >
              <Bookmark size={14} /> {saved ? "Saved" : "Save"}
            </button>
            <button type="button" className="pill-button" onClick={() => void share()}>
              {copied ? <Check size={14} /> : <Share2 size={14} />}{" "}
              {copied ? "Link copied" : "Share"}
            </button>
          </div>
        </div>

        <DossierFacts property={property} />

        <section className="story-layout">
          <p className="eyebrow">THE RESIDENCE</p>
          <div>
            <h2>The property</h2>
            <div className="prose">
              {property.story.map((paragraph) => (
                <p key={paragraph.slice(0, 40)}>{paragraph}</p>
              ))}
            </div>
            <p className="eyebrow">
              {property.type.toUpperCase()} · {property.style.toUpperCase()} ·{" "}
              {property.status.toUpperCase()}
            </p>
          </div>
        </section>
      </div>

      <Gallery
        images={property.gallery}
        video={property.video}
        city={property.city}
        slug={property.slug}
      />

      <section className="section-wrap details-section">
        <div>
          <p className="eyebrow">DETAILS</p>
          <h2>In particular</h2>
        </div>
        <div className="details-grid">
          <ul className="details-features">
            {property.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          <dl className="details-list">
            <div>
              <dt>Type</dt>
              <dd>{property.type}</dd>
            </div>
            <div>
              <dt>Architecture</dt>
              <dd>{property.style}</dd>
            </div>
            <div>
              <dt>Year</dt>
              <dd>{property.yearBuilt}</dd>
            </div>
            <div>
              <dt>Lot</dt>
              <dd>{property.lotAcres} acres</dd>
            </div>
            <div>
              <dt>Interior</dt>
              <dd>{formatNumber(property.interiorSqFt)} sq ft</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>{property.address}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{property.status}</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>{property.currency}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="section-wrap place-section">
        <div>
          <p className="eyebrow">LOCATION & CONTEXT</p>
          <h2>The place</h2>
          <span className="eyebrow">
            {property.city.toUpperCase()}, {property.state.toUpperCase()}
          </span>
        </div>
        <div>
          <p>{property.place}</p>
          {property.neighborhood !== property.city && (
            <p className="place-neighbourhood">
              {property.neighborhood} · {region.name}
            </p>
          )}
          <PlaceMap
            label={`Approximate location of ${property.city}`}
            note="Approximate location. Exact placement is shown for live listings only."
          />
          <TextLink to="/$market/$region" params={{ market: market.slug, region: region.slug }}>
            Explore {region.name}
          </TextLink>
        </div>
      </section>

      <div className="section-wrap">
        <Representation
          property={property}
          onContact={() => setIntent("agent")}
          onShowing={() => setIntent("showing")}
        />
      </div>

      <InquiryBlock
        eyebrow="INQUIRE"
        title="Begin a conversation."
        text="Every inquiry is read by a person and routed to the right representation."
      >
        <TextButton onClick={() => setIntent("showing")}>Request a private showing</TextButton>
        <TextButton onClick={() => setIntent("ask")}>Ask about this property</TextButton>
        <TextButton onClick={() => setIntent("similar")}>Find something similar</TextButton>
        <TextButton onClick={() => setIntent("sell")}>I need to sell first</TextButton>
        <TextButton onClick={() => setIntent("invest")}>I'm buying as an investment</TextButton>
      </InquiryBlock>

      <ShareCover property={property} copied={copied} onShare={() => void share()} />

      {related.length > 0 && (
        <section className="section-wrap featured related-properties">
          <SectionHeading
            eyebrow="CONTINUE EXPLORING"
            title={`More in ${market.name}`}
            action={<TextLink to="/properties">All properties</TextLink>}
          />
          <PropertyGrid items={related} />
        </section>
      )}

      <StickyActions onShowing={() => setIntent("showing")} onAsk={() => setAskOpen(true)} />

      <AskMatterOfPlace
        property={property}
        open={askOpen}
        onOpenChange={setAskOpen}
        onRequestShowing={requestShowing}
      />
      <InquiryDialog intent={intent} subject={subject} onClose={closeIntent} />
    </main>
  );
}
