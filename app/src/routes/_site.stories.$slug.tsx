import { createFileRoute, notFound } from "@tanstack/react-router";
import { ImageHero } from "../components/site/image-hero";
import { PageIntro } from "../components/site/page-intro";
import { PropertyGrid } from "../components/site/property-card";
import { SectionHeading } from "../components/site/section-heading";
import { TextLink } from "../components/site/text-link";
import { useTrackView } from "../hooks/use-track-view";
import { propertiesQuery, storyQuery } from "../lib/queries";
import { articleLd, breadcrumbLd } from "../lib/jsonld";
import { pageHead, unavailableHead } from "../lib/seo";
import { storyDescription } from "../lib/seo-copy";

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
      description: storyDescription(story),
      path: `/stories/${story.slug}`,
      type: "article",
      published: story.publishedAt,
      jsonLd: [
        articleLd(story),
        breadcrumbLd([
          { name: "Stories", path: "/stories" },
          { name: story.title.replace(/\.$/, ""), path: `/stories/${story.slug}` },
        ]),
      ],
    });
  },
  component: StoryPage,
});

function StoryPage() {
  const { story, mentioned } = Route.useLoaderData();
  useTrackView("story_view", story.slug, { category: story.category });
  return (
    <main>
      {story.image === undefined ? (
        <PageIntro eyebrow={story.category.toUpperCase()} title={story.title} />
      ) : (
        <ImageHero
          image={story.image}
          alt=""
          eyebrow={story.category.toUpperCase()}
          title={story.title}
        />
      )}
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
