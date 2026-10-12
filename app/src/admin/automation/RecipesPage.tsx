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
  // W3: the list is the page; an open flow takes the whole width, with the way back above it.
  if (open !== undefined)
    return (
      <>
        <button
          type="button"
          className="admin-flows__back"
          onClick={() => {
            filters.setFilters({});
          }}
        >
          All flows
        </button>
        <RecipeEditor key={`${open.id}:${String(open.version)}`} recipe={open} specs={steps} />
      </>
    );
  return (
    <>
      <h1>Flows</h1>
      <p className="admin-recipes__intro">
        What the site does by itself after each event. Open one to change its steps, try it safely,
        then save. A saved change applies to the next event.
      </p>
      {trigger === undefined || trigger === "" ? null : (
        <EmptyState title="That flow is not here">Choose one from the list below.</EmptyState>
      )}
      <RecipeList
        recipes={items}
        specs={steps}
        onSelect={(next) => {
          filters.setFilters({ trigger: next });
        }}
      />
    </>
  );
}
