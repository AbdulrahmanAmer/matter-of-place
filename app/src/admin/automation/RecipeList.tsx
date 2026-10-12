import { StatusPill } from "../ui/StatusPill";
import type { RecipeRow, StepSpecView } from "./automation-queries";
import { flowTopics, thenOf, topicOf, whenOf } from "./flow-words";

/**
 * Every flow, under its topic (W3): its name, what it does as one sentence ("When a property is published: Purge
 * cache, Render carousel and 2 more") and whether it is on. A row opens the flow.
 */
export function RecipeList({
  recipes,
  specs,
  onSelect,
}: {
  recipes: readonly RecipeRow[];
  specs: readonly StepSpecView[];
  onSelect: (trigger: string) => void;
}) {
  return (
    <nav className="admin-flows" aria-label="Events">
      {flowTopics.map((topic) => {
        const rows = recipes.filter((recipe) => topicOf(recipe.trigger) === topic);
        if (rows.length === 0) return null;
        return (
          <section key={topic} className="admin-flows__topic" aria-label={topic}>
            <h2 className="admin-eyebrow">{topic}</h2>
            <ul>
              {rows.map((recipe) => (
                <li key={recipe.id}>
                  <button
                    type="button"
                    className="admin-flows__row"
                    onClick={() => {
                      onSelect(recipe.trigger);
                    }}
                  >
                    <span className="admin-flows__name">{recipe.name}</span>
                    <span className="admin-flows__sentence">
                      When {whenOf(recipe)}: {thenOf(recipe.steps, specs, 3)}.
                    </span>
                    <span className="admin-flows__meta">
                      <StatusPill
                        label={recipe.enabled ? "On" : "Off"}
                        tone={recipe.enabled ? "ok" : "neutral"}
                      />
                      {recipe.steps.length === 1
                        ? "1 step"
                        : `${String(recipe.steps.length)} steps`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
