import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Bookmark, Check, Share2 } from "lucide-react";
import type { Intent } from "../components/forms/inquiry-dialog";
import { AskMatterOfPlace } from "../components/property/concierge";
import { DossierFacts } from "../components/property/dossier-facts";
import { Gallery } from "../components/property/gallery";
import { Representation } from "../components/property/representation";
import { ShareCover } from "../components/property/share-cover";
import { StickyActions } from "../components/property/sticky-actions";
import { ArchiveLink } from "../components/site/archive-link";
import { Breadcrumb } from "../components/site/breadcrumb";
import { IllustrativeNotice } from "../components/site/illustrative-notice";
import { ImageHero } from "../components/site/image-hero";
import { InquiryBlock } from "../components/site/inquiry-block";
import { PlaceMap } from "../components/site/place-map";
import { PropertyGrid } from "../components/site/property-card";
import { SectionHeading } from "../components/site/section-heading";
import { TextButton, TextLink } from "../components/site/text-link";
import { siteConfig } from "../config/site";
import { useTrackView } from "../hooks/use-track-view";
import { track } from "../lib/analytics";
import { formatPrice, marketOf, regionOf, relatedProperties } from "../lib/catalog";
import { cx } from "../lib/cx";
import { formatNumber } from "../lib/format";
import { archiveFacetsQuery, marketsQuery, propertiesQuery, propertyQuery } from "../lib/queries";
import { breadcrumbLd, propertyListingLd, videoLd } from "../lib/jsonld";
import { pageHead, unavailableHead } from "../lib/seo";
import { propertyDescription } from "../lib/seo-copy";

// Opened by a click, so its code stays out of the first load (R60).
const InquiryDialog = lazy(() =>
  import("../components/forms/inquiry-dialog").then((module) => ({
    default: module.InquiryDialog,
  })),
);

export const Route = createFileRoute("/_site/property/$slug")({
  loader: async ({ params, context: { queryClient } }) => {
    const [property, properties, markets, archive] = await Promise.all([
      queryClient.ensureQueryData(propertyQuery(params.slug)),
      queryClient.ensureQueryData(propertiesQuery()),
      queryClient.ensureQueryData(marketsQuery()),
      queryClient.ensureQueryData(archiveFacetsQuery()),
    ]);
    if (!property) throw notFound();
    const market = marketOf(markets, property.market);
    const region = regionOf(markets, property.market, property.region);
    if (!market || !region) throw notFound();
    return {
      property,
      market,
      region,
      related: relatedProperties(properties, property, 3),
      facets: archive?.facets ?? null,
    };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return unavailableHead("Property");
    const { property, market, region } = loaderData;
    const film = videoLd(property);
    return pageHead({
      title: `${property.title} ${property.city}`,
      description: propertyDescription(property),
      path: `/property/${property.slug}`,
      type: "article",
      jsonLd: [
        propertyListingLd(property),
        breadcrumbLd([
          { name: "Markets", path: "/markets" },
          { name: market.name, path: `/${market.slug}` },
          { name: region.name, path: `/${market.slug}/${region.slug}` },
          { name: property.title, path: `/property/${property.slug}` },
        ]),
        ...(film ? [film] : []),
      ],
    });
  },
  component: PropertyPage,
});

function PropertyPage() {
  const { property, market, region, related, facets } = Route.useLoaderData();
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
      if (typeof navigator.share === "function") {
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

  const illustrative = property.status === "Illustrative";

  const subject = {
    kind: "property",
    slug: property.slug,
    title: `${property.title} ${property.city}`,
  } as const;

  return (
    <main>
      <ImageHero
        image={property.heroImage}
        variants={property.heroVariants}
        alt={`${illustrative ? "Illustrative architecture" : "Architecture"} in ${property.city}`}
        eyebrow={`${property.city.toUpperCase()}, ${property.state.toUpperCase()}`}
        title={property.title}
        {...(illustrative ? { tag: "ILLUSTRATIVE PROPERTY" } : {})}
        scrollTarget="dossier"
      >
        <p>{formatPrice(property)}</p>
      </ImageHero>
      <IllustrativeNotice properties={[property]} />

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
        status={property.status}
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
              <dd>
                <ArchiveLink kind="style" label={property.style} facets={facets} />
              </dd>
            </div>
            {property.architect !== undefined && (
              <div>
                <dt>Architect</dt>
                <dd>
                  <ArchiveLink kind="architect" label={property.architect} facets={facets} />
                </dd>
              </div>
            )}
            <div>
              <dt>City</dt>
              <dd>
                <ArchiveLink
                  kind="city"
                  label={`${property.city}, ${property.state}`}
                  facets={facets}
                />
              </dd>
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
      {intent !== null && (
        <Suspense fallback={null}>
          <InquiryDialog
            intent={intent}
            subject={subject}
            presentedByOwner={property.presentedByOwner}
            onClose={closeIntent}
          />
        </Suspense>
      )}
    </main>
  );
}
