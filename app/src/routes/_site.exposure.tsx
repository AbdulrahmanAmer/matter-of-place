import { createFileRoute } from "@tanstack/react-router";
import { OfferCard } from "../components/site/offer-card";
import { PageIntro } from "../components/site/page-intro";
import { TextLink } from "../components/site/text-link";
import { exposureFaq, offerings, programmatic, selectionSteps } from "../data/exposure";
import { padIndex } from "../lib/format";
import { faqJsonLd, pageHead } from "../lib/seo";

const description =
  "The Feature $295, The Reach $695, The Campaign $1,495 and Five Features $1,250. Editorial presentation with precision distribution, after editorial review.";

export const Route = createFileRoute("/_site/exposure")({
  head: () =>
    pageHead({
      title: "Property Exposure",
      description,
      path: "/exposure",
      jsonLd: faqJsonLd(exposureFaq),
    }),
  component: ExposurePage,
});

function ExposurePage() {
  return (
    <main>
      <PageIntro
        eyebrow="PROPERTY EXPOSURE"
        title="Exceptional properties deserve context."
        text="Editorial presentation, carried further through owned and precision-distribution channels."
      />
      <div className="fp exposure-body">
        <section className="fp-block exposure-products" aria-labelledby="products">
          <p className="fp-label" id="products">
            Products · USD
          </p>
          {offerings.map((offering) => (
            <OfferCard key={offering.id} offering={offering} />
          ))}
        </section>

        <section className="fp-block exposure-list" aria-labelledby="programmatic">
          <p className="fp-label">Precision distribution</p>
          <h2 className="exposure-heading" id="programmatic">
            Beyond the post.
          </h2>
          <p className="fp-text">
            A remarkable property should not depend on an algorithm finding the right person by
            accident. Selected campaigns can extend beyond our own audience through targeted media
            on premium inventory.
          </p>
          <dl>
            <div>
              <dt>
                Programmatic media <span>From {programmatic.minimum}</span>
              </dt>
              <dd>Billed separately from editorial products.</dd>
            </div>
            <div>
              <dt>
                Management <span>{programmatic.managementFee}</span>
              </dt>
              <dd>{programmatic.minimumFee} minimum management fee.</dd>
            </div>
            <div>
              <dt>Formats</dt>
              <dd>{programmatic.formats.join(" · ")}</dd>
            </div>
          </dl>
          <p className="fp-text">
            Channel selection varies by campaign: the property, location, audience, objective,
            budget and available creative.
          </p>
        </section>

        <section className="fp-block" aria-labelledby="selection">
          <p className="fp-label">How selection works</p>
          <h2 className="exposure-heading" id="selection">
            Review comes before payment.
          </h2>
          <ol className="steps-list">
            {selectionSteps.map((step, index) => (
              <li key={step.name}>
                <span>{padIndex(index + 1)}</span>
                <strong>{step.name}</strong>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="fp-block" aria-labelledby="exposure-faq">
          <p className="fp-label" id="exposure-faq">
            FAQ
          </p>
          <div className="fp-faq">
            {exposureFaq.map((item) => (
              <details key={item.q}>
                <summary>
                  {item.q} <span aria-hidden="true">+</span>
                </summary>
                <p className="fp-text">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="fp-block exposure-standard">
          <p className="fp-text">
            Matter of Place provides attention, presentation and distribution. It does not guarantee
            buyers, inquiries or transactions.
          </p>
          <TextLink to="/submit">Submit a Property</TextLink>
        </section>
      </div>
    </main>
  );
}
