import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "../components/site/coming-soon";
import { Newsletter } from "../components/site/newsletter";
import { PageIntro } from "../components/site/page-intro";
import { StoryGrid } from "../components/site/story-card";
import { storiesQuery } from "../lib/queries";
import { breadcrumbLd, collectionLd } from "../lib/jsonld";
import { ogImageFor, ogStaticOf } from "../lib/og";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";

export const Route = createFileRoute("/_site/stories/")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(storiesQuery()),
  head: ({ loaderData, matches }) =>
    pageHead({
      title: "Stories",
      description: pageDescription("stories.index"),
      path: "/stories",
      image: ogImageFor({ key: "stories", ogStatic: ogStaticOf(matches) }),
      jsonLd: [
        collectionLd(
          "stories",
          "Stories",
          "/stories",
          (loaderData ?? []).map((story) => ({
            name: story.title,
            path: `/stories/${story.slug}`,
          })),
        ),
        breadcrumbLd([{ name: "Stories", path: "/stories" }]),
      ],
    }),
  component: StoriesPage,
});

function StoriesPage() {
  const stories = Route.useLoaderData();
  return (
    <main>
      <PageIntro
        eyebrow="ARCHITECTURE · INTERIORS · PLACES"
        title="Stories"
        text="Original writing from three editorial desks."
      />
      {stories.length === 0 ? (
        <ComingSoon scope="stories" />
      ) : (
        <section className="section-wrap collection">
          <StoryGrid items={stories} />
        </section>
      )}
      <Newsletter source="stories" />
    </main>
  );
}
