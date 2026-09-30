import { Link } from "@tanstack/react-router";
import type { Story } from "../../domain/story";

export function StoryCard({ story }: { story: Story }) {
  return (
    <Link to="/stories/$slug" params={{ slug: story.slug }} className="story-card">
      <img src={story.image} loading="lazy" width={1200} height={1500} alt="" />
      <span className="eyebrow">{story.category.toUpperCase()} · ILLUSTRATIVE</span>
      <h3>{story.title}</h3>
      <p>{story.deck}</p>
    </Link>
  );
}

export function StoryGrid({ items }: { items: Story[] }) {
  return (
    <div className="story-grid">
      {items.map((story) => (
        <StoryCard key={story.slug} story={story} />
      ))}
    </div>
  );
}
