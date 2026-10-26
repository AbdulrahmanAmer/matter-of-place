import { createFileRoute } from "@tanstack/react-router";
import { SubmitWizard } from "../components/forms/submit/wizard";
import { PageIntro } from "../components/site/page-intro";
import { breadcrumbLd, type Crumb } from "../lib/jsonld";
import { ogImageFor, ogStaticOf } from "../lib/og";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";

const trail: Crumb[] = [{ name: "Submit a Property", path: "/submit" }];

export const Route = createFileRoute("/_site/submit")({
  // The client room's "Submit my next property" opens the form with Five Features chosen (W6 item 8).
  validateSearch: (search: Record<string, unknown>): { package?: "five-features" } =>
    search["package"] === "five-features" ? { package: "five-features" } : {},
  head: ({ matches }) =>
    pageHead({
      title: "Submit a Property",
      description: pageDescription("submit"),
      path: "/submit",
      image: ogImageFor({ key: "default", ogStatic: ogStaticOf(matches) }),
      jsonLd: [breadcrumbLd(trail)],
    }),
  component: SubmitPage,
});

function SubmitPage() {
  const { package: chosen } = Route.useSearch();
  return (
    <main>
      <PageIntro
        trail={trail}
        eyebrow="FOR AGENTS, BROKERAGES & OWNERS"
        title="Submit a Property"
        text="Submitted as you would submit work to a publication. Every property is reviewed before anything else happens."
      />
      <div className="submit-page">
        <SubmitWizard {...(chosen === "five-features" ? { chosenPackage: "Five Features" } : {})} />
      </div>
    </main>
  );
}
