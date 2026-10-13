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

        <h2 id="settings">Accessibility settings</h2>
        <p>
          The round mark at the bottom right of every page opens the accessibility settings, as do
          Alt + A and the Accessibility settings link at the foot of every page. They read a page,
          or a passage you select, aloud in your browser&apos;s own voice. They make text larger,
          raise the contrast, set the text spacing of WCAG 1.4.12, change the type to a plainer
          face, underline every link, add a reading guide that follows the pointer, and stop all
          motion. For colour vision they apply a corrective filter for green-weak, red-weak or
          blue-yellow sight, which moves the colour differences you cannot see into ones you can.
        </p>
        <p>
          Your choices are kept in this browser only and are never sent to us. The mark can be
          hidden behind a tab at the edge of the screen, and the tab, the link or Alt + A brings it
          back.
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
