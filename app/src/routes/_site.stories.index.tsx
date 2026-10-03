import { createFileRoute } from "@tanstack/react-router";
import { Newsletter } from "../components/site/newsletter";
import { PageIntro } from "../components/site/page-intro";
import { StoryGrid } from "../components/site/story-card";
import { storiesQuery } from "../lib/queries";
import { pageHead } from "../lib/seo";

const description =
  "Architecture, interiors and places across California, New York and Florida, from the Matter of Place editorial desks.";

export const Route = createFileRoute("/_site/stories/")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(storiesQuery()),
  head: () => pageHead({ title: "Stories", description, path: "/stories" }),
  component: StoriesPage,
});

function StoriesPage() {
  const stories = Route.useLoaderData();
  return (
    <main>
      <PageIntro
        eyebrow="ARCHITECTURE · INTERIORS · PLACES"
        title="Stories"
        text="Original writing from three editorial desks. Sample stories, shown to set the format."
      />
      <section className="section-wrap collection">
        <StoryGrid items={stories} />
      </section>
      <Newsletter source="stories" />
    </main>
  );
}
