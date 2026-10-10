import { StatusPill } from "../ui/StatusPill";
import type { RecipeRow } from "./automation-queries";

/** One row per event type; the open recipe is marked with `aria-current`. */
export function RecipeList({
  recipes,
  selected,
  onSelect,
}: {
  recipes: readonly RecipeRow[];
  selected: string | undefined;
  onSelect: (trigger: string) => void;
}) {
  return (
    <nav className="admin-recipes__list" aria-label="Events">
      <ul>
        {recipes.map((recipe) => (
          <li key={recipe.id}>
            <button
              type="button"
              aria-current={recipe.trigger === selected ? "true" : undefined}
              onClick={() => {
                onSelect(recipe.trigger);
              }}
            >
              <span className="admin-recipes__name">{recipe.name}</span>
              <code>{recipe.trigger}</code>
              <span className="admin-recipes__meta">
                <StatusPill
                  label={recipe.enabled ? "On" : "Off"}
                  tone={recipe.enabled ? "ok" : "neutral"}
                />
                {recipe.steps.length === 1 ? "1 step" : `${String(recipe.steps.length)} steps`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
