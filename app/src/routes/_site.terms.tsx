import { createFileRoute, Link } from "@tanstack/react-router";
import { PageIntro } from "../components/site/page-intro";
import { legalVersions } from "../config/site";
import { presentLines } from "../domain/settings";
import { breadcrumbLd } from "../lib/jsonld";
import { ogImageFor, ogStaticOf } from "../lib/og";
import { useSite } from "../lib/queries";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";
import { t } from "../lib/strings";

export const Route = createFileRoute("/_site/terms")({
  head: ({ matches }) =>
    pageHead({
      title: t.nav.terms,
      description: pageDescription("terms"),
      path: "/terms",
      image: ogImageFor({ key: "default", ogStatic: ogStaticOf(matches) }),
      jsonLd: [breadcrumbLd([{ name: t.nav.terms, path: "/terms" }])],
    }),
  component: TermsPage,
});

function TermsPage() {
  const email = presentLines(useSite().contact.email)[0];
  return (
    <main>
      <PageIntro
        eyebrow="TERMS"
        title={t.nav.terms}
        text="These terms are for agents, brokers, architects and owners who submit a property, and for anyone using the site."
      />
      <div className="copy-page">
        <h2>Using this site</h2>
        <p>
          You may read the site and share links to it. Do not copy it in bulk, interfere with it or
          use it to harm others. Nothing on the site is an offer to sell or rent a property.
        </p>

        <h2>Accuracy of property information</h2>
        <p>
          Property information is supplied by the submitter and reviewed by our editors. It is not
          verified as a survey or an appraisal.
        </p>

        <h2>Editorial independence</h2>
        <p>
          Matter of Place decides what is published, how it is written and how it is ranked. Payment
          does not buy acceptance or a particular narrative.
        </p>

        <h2>Submitting a property</h2>
        <p>
          A submission is a request for editorial consideration. Acceptance is not promised. The
          review time is the one stated on the <Link to="/exposure">exposure page</Link>.
        </p>

        <h2 id="rights-to-photographs">Rights to photographs</h2>
        <p>
          When you submit a property you confirm that you hold the rights to every image you upload.
          You grant Matter of Place a licence to publish, resize and share those images in the
          editorial and its channels.
        </p>
        <p>
          You accept that this confirmation is recorded with the version of these terms, which is{" "}
          {legalVersions.terms}.
        </p>

        <h2>Removal requests</h2>
        <p>
          A rights holder or the submitter can ask for removal. We unpublish within 24 hours, and
          the address then reports that the page has been removed.
        </p>

        <h2>Fees and payment</h2>
        <p>
          An invoice is issued only after a property is accepted. Payment terms are those printed on
          the invoice.
        </p>

        <h2>Refunds</h2>
        <p>
          A declined submission is never charged. Once a property is accepted and paid, a withdrawal
          by the submitter after publication is not refunded.
        </p>

        <h2>No promise of results</h2>
        <p>
          Matter of Place does not promise leads, buyers or a sale price. A package describes what
          we publish and where, not what follows.
        </p>

        <h2>Changes to these terms</h2>
        <p>
          Each version of these terms is dated. This is version {legalVersions.terms}. A copy change
          adds a new version.
        </p>

        <h2>Contact</h2>
        <p>
          {email === undefined ? (
            <>
              Write to us through the <Link to="/contact">contact page</Link>.
            </>
          ) : (
            <>
              <a href={`mailto:${email}`}>{email}</a>, or the{" "}
              <Link to="/contact">contact page</Link>.
            </>
          )}
        </p>
      </div>
    </main>
  );
}
