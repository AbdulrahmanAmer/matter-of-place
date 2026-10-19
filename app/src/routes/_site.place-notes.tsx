import { createFileRoute } from "@tanstack/react-router";
import { NewsletterForm } from "../components/forms/newsletter-form";
import { PageIntro } from "../components/site/page-intro";
import { ogImageFor, ogStaticOf } from "../lib/og";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";
import { t } from "../lib/strings";

export const Route = createFileRoute("/_site/place-notes")({
  head: ({ matches }) =>
    pageHead({
      title: "Place Notes",
      description: pageDescription("place-notes"),
      path: "/place-notes",
      image: ogImageFor({ key: "default", ogStatic: ogStaticOf(matches) }),
    }),
  component: PlaceNotesPage,
});

/** The signup page. A confirm link lands on `/place-notes/$status` instead (operator, 2026-10-19). */
function PlaceNotesPage() {
  return (
    <main>
      <PageIntro
        eyebrow={t.newsletter.eyebrow}
        title={t.newsletter.title}
        text={t.newsletter.text}
      />
      <section className="section-wrap">
        <NewsletterForm source="place-notes" />
      </section>
    </main>
  );
}
