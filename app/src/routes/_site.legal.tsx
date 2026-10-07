import { createFileRoute } from "@tanstack/react-router";
import { PageIntro } from "../components/site/page-intro";
import { TextLink } from "../components/site/text-link";
import { siteConfig } from "../config/site";
import { presentLines } from "../domain/settings";
import { breadcrumbLd } from "../lib/jsonld";
import { useSite } from "../lib/queries";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";

export const Route = createFileRoute("/_site/legal")({
  head: () =>
    pageHead({
      title: "Legal",
      description: pageDescription("legal"),
      path: "/legal",
      jsonLd: [breadcrumbLd([{ name: "Legal", path: "/legal" }])],
    }),
  component: LegalPage,
});

function LegalPage() {
  const { legal, illustrativeContent } = useSite();
  return (
    <main>
      <PageIntro
        eyebrow="NOTICES"
        title="Legal"
        text="Plain statements about what this site is, what it is not, and how information is treated."
      />
      <div className="copy-page">
        {illustrativeContent && (
          <>
            <h2>Illustrative content</h2>
            <p>
              Every property, story, price, representative reference and photograph on this site is
              fictional and illustrative. Nothing shown is offered for sale or rent. Addresses are
              withheld or invented; any resemblance to a real property is coincidental.
            </p>
          </>
        )}

        <h2>Representation</h2>
        <p>
          Matter of Place is a property publication and amplification service. It is not a
          real-estate brokerage and does not represent buyers or sellers. Live listings show the
          listing agent, brokerage and licence clearly on each property page, and inquiries are
          routed to that representation.
        </p>

        <h2>Editorial independence</h2>
        <p>
          Editorial consideration is free and cannot be purchased. Paid packages amplify properties
          that have already been accepted editorially; they do not influence whether a property is
          accepted.
        </p>

        <div className="section-block">
          <p className="eyebrow">COMPANY</p>
          <h2>{siteConfig.name}</h2>
          <p>
            {siteConfig.name} is a product of {siteConfig.parentCompany}.
          </p>
          {presentLines(legal.entity, legal.address).map((line) => (
            <p key={line}>{line}</p>
          ))}
          <TextLink to="/contact">Contact</TextLink>
        </div>
      </div>
    </main>
  );
}
