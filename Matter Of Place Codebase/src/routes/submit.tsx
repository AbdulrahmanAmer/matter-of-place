import { createFileRoute } from "@tanstack/react-router";
import { SubmitWizard } from "../components/forms/submit/wizard";
import { PageIntro } from "../components/site/page-intro";
import { pageHead } from "../lib/seo";

const description =
  "Submit an existing residential property in California, New York or Florida for editorial review.";

export const Route = createFileRoute("/submit")({
  head: () => pageHead({ title: "Submit a Property", description, path: "/submit" }),
  component: SubmitPage,
});

function SubmitPage() {
  return (
    <main>
      <PageIntro
        eyebrow="FOR AGENTS, TEAMS & BROKERAGES"
        title="Submit a Property"
        text="Submitted as you would submit work to a publication. Every property is reviewed before anything else happens."
      />
      <div className="submit-page">
        <SubmitWizard />
      </div>
    </main>
  );
}
