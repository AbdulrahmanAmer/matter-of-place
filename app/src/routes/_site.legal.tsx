import { createFileRoute } from "@tanstack/react-router";
import { PageIntro } from "../components/site/page-intro";
import { TextLink } from "../components/site/text-link";
import { siteConfig } from "../config/site";
import { isLive } from "../services";
import { breadcrumbLd } from "../lib/jsonld";
import { ogImageFor, ogStaticOf } from "../lib/og";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";

export const Route = createFileRoute("/_site/legal")({
  head: ({ matches }) =>
    pageHead({
      title: "Legal",
      description: pageDescription("legal"),
      path: "/legal",
      image: ogImageFor({ key: "default", ogStatic: ogStaticOf(matches) }),
      jsonLd: [breadcrumbLd([{ name: "Legal", path: "/legal" }])],
    }),
  component: LegalPage,
});

function LegalPage() {
  const { entity, address } = siteConfig.legal;
  return (
    <main>
      <PageIntro
        eyebrow="NOTICES"
        title="Legal"
        text="Plain statements about what this site is, what it is not, and how information is treated."
      />
      <div className="copy-page">
        <h2>Illustrative content</h2>
        <p>
          Every property, story, price, representative reference and photograph on this site is
          fictional and illustrative. Nothing shown is offered for sale or rent. Addresses are
          withheld or invented; any resemblance to a real property is coincidental.
        </p>

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

        <div className="section-block" id="privacy">
          <p className="eyebrow">PRIVACY</p>
          <h2>Information we collect</h2>
          <p>
            Forms on this site collect what you type into them: your name, contact details, your
            message, and, for submissions, information about the property. We use it to answer
            inquiries, review submissions and send Place Notes to those who ask for it. We keep it
            for as long as the conversation or the review is open, and we remove it on request.
          </p>
          <p>
            Interaction events (pages viewed, filters used, inquiries started) are recorded to
            understand how the site is used and to attribute inquiries to the right property. We
            never sell or share personal details.
          </p>
          {!isLive && (
            <p>
              Delivery is not yet connected on this site: nothing entered into a form leaves your
              device until it is.
            </p>
          )}
        </div>

        <div className="section-block" id="terms">
          <p className="eyebrow">TERMS</p>
          <h2>Use of this site</h2>
          <p>
            The photography, texts and design of Matter of Place may not be reproduced without
            permission. Property information is supplied by listing representatives and should be
            verified independently before any decision. Matter of Place accepts no liability for
            decisions made on the basis of illustrative content.
          </p>
        </div>

        <div className="section-block">
          <p className="eyebrow">COMPANY</p>
          <h2>{siteConfig.name}</h2>
          <p>Matter of Place is an {siteConfig.parentCompany} company.</p>
          {entity && <p>{entity}</p>}
          {address && <p>{address}</p>}
          <TextLink to="/contact">Contact</TextLink>
        </div>
      </div>
    </main>
  );
}
