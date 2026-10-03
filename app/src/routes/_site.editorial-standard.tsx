import { createFileRoute } from "@tanstack/react-router";
import { PageIntro } from "../components/site/page-intro";
import { TextLink } from "../components/site/text-link";
import { editorialQualities } from "../data/exposure";
import { pageHead } from "../lib/seo";

const description =
  "What Matter of Place looks for in a property: architecture, design, originality, materiality, setting, history, craft and sense of place. Price is not the measure.";

export const Route = createFileRoute("/_site/editorial-standard")({
  head: () => pageHead({ title: "Editorial Standard", description, path: "/editorial-standard" }),
  component: StandardPage,
});

function StandardPage() {
  return (
    <main>
      <PageIntro
        eyebrow="EDITORIAL STANDARD"
        title="What we look for."
        text="A property's price does not decide whether it belongs here."
      />
      <div className="copy-page">
        <ul className="standard-list">
          {editorialQualities.map((quality) => (
            <li key={quality}>{quality}</li>
          ))}
        </ul>
        <section className="section-block">
          <h2>Selected, not bought</h2>
          <p>
            A thoughtful two million dollar house may deserve more attention than a generic twenty
            million dollar one. We read every submission for what it is.
          </p>
          <p>
            Every property is reviewed against this standard. Payment does not override selection.
            If a property is not accepted, nothing is charged.
          </p>
        </section>
        <section className="section-block">
          <h2>What we cover</h2>
          <p>
            Existing residential property in California, New York and Florida. Not every property in
            those places qualifies.
          </p>
          <TextLink to="/submit">Submit a Property</TextLink>
        </section>
      </div>
    </main>
  );
}
