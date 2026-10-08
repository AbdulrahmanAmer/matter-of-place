import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { reportClientError } from "../../lib/report-error";
import { AdminApiError } from "../ui/admin-fetch";
import { EmptyState } from "../ui/EmptyState";
import { useUrlFilters } from "../ui/use-url-filters";
import { useRecipes } from "./automation-queries";
import { RecipeEditor } from "./RecipeEditor";
import { RecipeList } from "./RecipeList";
import { RequestFailure } from "./RequestFailure";

const filterNames = ["trigger"] as const;

/**
 * Screen 17. The event in the address (`?trigger=property.published`) is the recipe open beside the list, so a link and
 * a reload land on the same recipe.
 */
export function RecipesPage() {
  const recipes = useRecipes();
  const filters = useUrlFilters(filterNames);
  const trigger = filters.values.trigger;
  const router = useRouter();
  const failure = recipes.error;
  const requestId = failure instanceof AdminApiError ? failure.requestId : undefined;

  useEffect(() => {
    if (failure === null) return;
    reportClientError(failure, {
      route: router.state.location.pathname,
      ...(requestId === undefined ? {} : { requestId }),
    });
  }, [failure, requestId, router]);

  if (recipes.isPending) return <p role="status">Loading recipes.</p>;
  if (recipes.isError) return <RequestFailure error={recipes.error} />;

  const { items, steps } = recipes.data;
  const open = items.find((recipe) => recipe.trigger === trigger);
  return (
    <>
      <h1>Recipes</h1>
      <p className="admin-recipes__intro">
        What follows each event. A saved change applies to the next event, with no deploy.
      </p>
      <div className="admin-recipes">
        <RecipeList
          recipes={items}
          selected={open?.trigger}
          onSelect={(next) => {
            filters.setFilters({ trigger: next });
          }}
        />
        {open === undefined ? (
          <EmptyState title="Choose an event">Pick one on the left to see its steps.</EmptyState>
        ) : (
          <RecipeEditor key={`${open.id}:${String(open.version)}`} recipe={open} specs={steps} />
        )}
      </div>
    </>
  );
}
