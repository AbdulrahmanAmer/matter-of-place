import { createFileRoute, Link } from "@tanstack/react-router";
import { PageIntro } from "../components/site/page-intro";
import { legalUpdated } from "../config/site";
import { presentLines } from "../domain/settings";
import { breadcrumbLd } from "../lib/jsonld";
import { ogImageFor, ogStaticOf } from "../lib/og";
import { useSite } from "../lib/queries";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";
import { t } from "../lib/strings";

export const Route = createFileRoute("/_site/accessibility")({
  head: ({ matches }) =>
    pageHead({
      title: t.nav.accessibility,
      description: pageDescription("accessibility"),
      path: "/accessibility",
      image: ogImageFor({ key: "default", ogStatic: ogStaticOf(matches) }),
      jsonLd: [breadcrumbLd([{ name: t.nav.accessibility, path: "/accessibility" }])],
    }),
  component: AccessibilityPage,
});

function AccessibilityPage() {
  const email = presentLines(useSite().contact.email)[0];
  return (
    <main>
      <PageIntro
        eyebrow="ACCESSIBILITY"
        title={t.nav.accessibility}
        text="How Matter of Place works to stay usable by everyone, and how to tell us when it is not."
      />
      <div className="copy-page">
        <h2>Our commitment</h2>
        <p>Our target is WCAG 2.2 level AA on every page.</p>

        <h2>What we do</h2>
        <p>
          Pages work with a keyboard, and the focus is always visible. Motion respects the
          reduced-motion setting of your device. Text colours come from one palette chosen for
          contrast. An editor writes the alt text of every photograph. Each page has one main
          heading.
        </p>

        <h2>How we check</h2>
        <p>
          Automated axe checks run on every route in continuous integration, on a desktop and a
          phone screen. Manual keyboard and screen reader checks are made before launch, and they
          are listed here only once they are done.
        </p>

        <h2>Known limits</h2>
        <p>None recorded at the date below.</p>

        <h2>Tell us about a problem</h2>
        <p>
          {email === undefined ? (
            <>
              Write to us through the <Link to="/contact">contact page</Link>.
            </>
          ) : (
            <>
              Write to <a href={`mailto:${email}`}>{email}</a>.
            </>
          )}{" "}
          Please send the address of the page and what was hard. We reply within five business days.
        </p>

        <h2>Last updated</h2>
        <p>
          <time dateTime={legalUpdated}>{legalUpdated}</time>
        </p>
      </div>
    </main>
  );
}
