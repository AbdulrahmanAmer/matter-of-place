import { createFileRoute } from "@tanstack/react-router";
import { SubmitWizard } from "../components/forms/submit/wizard";
import { PageIntro } from "../components/site/page-intro";
import { breadcrumbLd } from "../lib/jsonld";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";

export const Route = createFileRoute("/_site/submit")({
  head: () =>
    pageHead({
      title: "Submit a Property",
      description: pageDescription("submit"),
      path: "/submit",
      jsonLd: [breadcrumbLd([{ name: "Submit a Property", path: "/submit" }])],
    }),
  component: SubmitPage,
});

function SubmitPage() {
  return (
    <main>
      <PageIntro
        eyebrow="FOR AGENTS, BROKERAGES & OWNERS"
        title="Submit a Property"
        text="Submitted as you would submit work to a publication. Every property is reviewed before anything else happens."
      />
      <div className="submit-page">
        <SubmitWizard />
      </div>
    </main>
  );
}
