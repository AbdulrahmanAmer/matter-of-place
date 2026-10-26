import { Link } from "@tanstack/react-router";
import type { Story } from "../../domain/story";
import { Picture } from "./picture";

/** `level` keeps the outline whole: h2 when the grid sits directly under the page h1, h3 under a section heading. */
export function StoryCard({ story, level = 3 }: { story: Story; level?: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <Link to="/stories/$slug" params={{ slug: story.slug }} className="story-card">
      {story.image !== undefined && (
        <Picture
          src={story.image}
          sizes="(max-width: 700px) 100vw, (max-width: 900px) 50vw, 33vw"
          width={1200}
          height={1500}
          alt=""
        />
      )}
      <span className="eyebrow">{story.category.toUpperCase()}</span>
      <Heading>
        <span className="card-title">{story.title}</span>
      </Heading>
      <p>{story.deck}</p>
    </Link>
  );
}

export function StoryGrid({ items, level = 3 }: { items: Story[]; level?: 2 | 3 }) {
  return (
    <div className="story-grid">
      {items.map((story) => (
        <StoryCard key={story.slug} story={story} level={level} />
      ))}
    </div>
  );
}
