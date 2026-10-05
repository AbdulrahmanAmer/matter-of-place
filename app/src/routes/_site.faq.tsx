import { createFileRoute, Link } from "@tanstack/react-router";
import { PageIntro } from "../components/site/page-intro";
import { faq } from "../data/faq";
import { faqJsonLd, pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";

export const Route = createFileRoute("/_site/faq")({
  head: () =>
    pageHead({
      title: "FAQ",
      description: pageDescription("faq"),
      path: "/faq",
      jsonLd: faqJsonLd(faq),
    }),
  component: FaqPage,
});

function FaqPage() {
  return (
    <main>
      <PageIntro eyebrow="FAQ" title="Asked often." />
      <section className="section-wrap faq-page">
        <div className="faq">
          {faq.map((item) => (
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
