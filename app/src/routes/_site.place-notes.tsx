import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { NewsletterForm } from "../components/forms/newsletter-form";
import { PageIntro } from "../components/site/page-intro";
import { track } from "../lib/analytics";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";
import { t } from "../lib/strings";

export const Route = createFileRoute("/_site/place-notes")({
  head: () =>
    pageHead({
      title: "Place Notes",
      description: pageDescription("place-notes"),
      path: "/place-notes",
    }),
  component: PlaceNotesPage,
});

/**
 * Where a confirm link lands. The notice is read from `?confirmed` after hydration: the page cache keys drop the query
 * string (architecture 13, rule 3), so the server render never carries it.
 */
function PlaceNotesPage() {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const confirmed = new URLSearchParams(window.location.search).get("confirmed");
    if (confirmed === "1") {
      setNotice(t.newsletter.confirmed);
      track("newsletter_confirmed");
    } else if (confirmed === "0") {
      setNotice(t.newsletter.confirmFailed);
    }
  }, []);

  return (
    <main>
      <PageIntro
        eyebrow={t.newsletter.eyebrow}
        title={t.newsletter.title}
        text={t.newsletter.text}
      />
      <section className="section-wrap">
        {notice !== null && (
          <p className="form-notice" role="status">
            {notice}
          </p>
        )}
        <NewsletterForm source="place-notes" />
      </section>
    </main>
  );
}
