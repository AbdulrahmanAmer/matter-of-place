import { createFileRoute, notFound } from "@tanstack/react-router";
import { ImageHero } from "../components/site/image-hero";
import { PropertyGrid } from "../components/site/property-card";
import { SectionHeading } from "../components/site/section-heading";
import { TextLink } from "../components/site/text-link";
import { useTrackView } from "../hooks/use-track-view";
import { propertiesQuery, storyQuery } from "../lib/queries";
import { pageHead, unavailableHead } from "../lib/seo";

export const Route = createFileRoute("/_site/stories/$slug")({
  loader: async ({ params, context: { queryClient } }) => {
    const [story, properties] = await Promise.all([
      queryClient.ensureQueryData(storyQuery(params.slug)),
      queryClient.ensureQueryData(propertiesQuery()),
    ]);
    if (!story) throw notFound();
    return {
      story,
      mentioned: properties.filter((property) => story.properties.includes(property.slug)),
    };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return unavailableHead("Story");
    const { story } = loaderData;
    return pageHead({
      title: story.title.replace(/\.$/, ""),
      description: story.deck,
      path: `/stories/${story.slug}`,
      type: "article",
    });
  },
  component: StoryPage,
});

function StoryPage() {
  const { story, mentioned } = Route.useLoaderData();
  useTrackView("story_view", story.slug, { category: story.category });
  return (
    <main>
      <ImageHero
        image={story.image}
        alt=""
        eyebrow={`${story.category.toUpperCase()} · ILLUSTRATIVE STORY`}
        title={story.title}
      />
      <article className="copy-page story-body">
        <p className="story-deck">{story.deck}</p>
        {story.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </article>
      {mentioned.length > 0 && (
        <section className="section-wrap featured related-properties">
          <SectionHeading
            eyebrow="IN THIS STORY"
            title="The properties"
            action={<TextLink to="/stories">All stories</TextLink>}
          />
          <PropertyGrid items={mentioned} />
        </section>
      )}
    </main>
  );
}
