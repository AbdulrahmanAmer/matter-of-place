import { createFileRoute, Link } from "@tanstack/react-router";
import { PageIntro } from "../components/site/page-intro";
import { faqFor } from "../data/faq";
import { ogImageFor, ogStaticOf } from "../lib/og";
import { siteQuery } from "../lib/queries";
import { faqJsonLd, pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";

export const Route = createFileRoute("/_site/faq")({
  loader: async ({ context: { queryClient } }) =>
    (await queryClient.ensureQueryData(siteQuery())).products,
  head: ({ loaderData, matches }) =>
    pageHead({
      title: "FAQ",
      description: pageDescription("faq"),
      path: "/faq",
      image: ogImageFor({ key: "default", ogStatic: ogStaticOf(matches) }),
      jsonLd: faqJsonLd(faqFor(loaderData ?? [])),
    }),
  component: FaqPage,
});

function FaqPage() {
  const plans = Route.useLoaderData();
  return (
    <main>
      <PageIntro eyebrow="FAQ" title="Asked often." />
      <section className="section-wrap faq-page">
        <div className="faq">
          {faqFor(plans).map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
        <p className="faq-more">
          Still wondering?{" "}
          <Link to="/contact" className="text-link">
            Write to us
          </Link>
        </p>
      </section>
    </main>
  );
}
