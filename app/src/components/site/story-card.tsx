import { Link } from "@tanstack/react-router";
import type { Story } from "../../domain/story";
import { Picture } from "./picture";

export function StoryCard({ story }: { story: Story }) {
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
