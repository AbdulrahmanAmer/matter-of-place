import { useState } from "react";
import { Field } from "../ui/Field";
import { RoleGate } from "../ui/RoleGate";
import { useAdminMe } from "../ui/admin-me";
import { useToast } from "../ui/use-toast";
import { useSaveRecipe, type RecipeRow, type StepSpecView } from "./automation-queries";
import { DryRunPanel } from "./DryRunPanel";
import { RequestFailure } from "./RequestFailure";
import { checkDraft, draftOf, maxSteps, newStep, sameDraft, type Draft } from "./recipe-draft";
import { StepCard } from "./StepCard";

/**
 * One recipe: its name, its switch and its steps in order. The draft is local until Save; a saved recipe applies to
 * the next event with no deploy. The parent keys this component by the recipe's version, so a refetch after a save
 * starts a fresh draft from what the server holds.
 */
export function RecipeEditor({
  recipe,
  specs,
}: {
  recipe: RecipeRow;
  specs: readonly StepSpecView[];
}) {
  const toast = useToast();
  const save = useSaveRecipe();
  const { actions } = useAdminMe();
  const [draft, setDraft] = useState<Draft>(() => draftOf(recipe));
  const [checked, setChecked] = useState(false);
  const [adding, setAdding] = useState("");

  const dirty = !sameDraft(draft, draftOf(recipe));
  const problems = checkDraft(draft, specs);
  const shown = checked ? problems : undefined;
  const canEdit = actions.includes("automation.recipes_put");

  const replaceStep = (index: number, next: Draft["steps"][number]) => {
    setDraft({ ...draft, steps: draft.steps.map((step, at) => (at === index ? next : step)) });
  };

  const move = (index: number, by: -1 | 1) => {
    const steps = [...draft.steps];
    const [moved] = steps.splice(index, 1);
    if (moved === undefined) return;
    steps.splice(index + by, 0, moved);
    setDraft({ ...draft, steps });
  };

  const add = () => {
    const spec = specs.find((candidate) => candidate.type === adding);
    if (spec === undefined) return;
    setDraft({ ...draft, steps: [...draft.steps, newStep(spec, draft.steps)] });
    setAdding("");
  };

  const submit = () => {
    setChecked(true);
    if (!problems.ok) return;
    save.mutate(
      { trigger: recipe.trigger, patch: draft },
      {
        onSuccess: () => {
          toast({ message: "Recipe saved. It applies to the next event." });
        },
      },
    );
  };

  return (
    <article className="admin-recipe" aria-label={recipe.name}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset className="admin-recipe__fields" disabled={!canEdit || save.isPending}>
          <legend className="admin-recipe__event">
            Event <code>{recipe.trigger}</code>
          </legend>
          <Field label="Name" {...(shown?.name === undefined ? {} : { error: shown.name })}>
            {(control) => (
              <input
                {...control}
                type="text"
                value={draft.name}
                maxLength={120}
                onChange={(event) => {
                  setDraft({ ...draft, name: event.target.value });
                }}
              />
            )}
          </Field>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => {
                setDraft({ ...draft, enabled: event.target.checked });
              }}
            />
            Recipe on
          </label>
          <h3>Steps</h3>
          {draft.steps.length === 0 ? (
            <p>This recipe has no steps. The event happens and nothing follows.</p>
          ) : (
            <ol className="admin-steps">
              {draft.steps.map((step, index) => (
                <StepCard
                  key={step.id}
                  step={step}
                  spec={specs.find((spec) => spec.type === step.step_type)}
                  position={index}
                  count={draft.steps.length}
                  errors={shown?.params[index] ?? {}}
                  onChange={(next) => {
                    replaceStep(index, next);
                  }}
                  onMove={(by) => {
                    move(index, by);
                  }}
                  onRemove={() => {
                    setDraft({ ...draft, steps: draft.steps.filter((_, at) => at !== index) });
                  }}
                />
              ))}
            </ol>
          )}
          {shown?.steps === undefined ? null : (
            <p className="admin-field__error" role="alert">
              {shown.steps}
            </p>
          )}
          <div className="admin-recipe__add">
            <Field label="Add a step">
              {(control) => (
                <select
                  {...control}
                  value={adding}
                  onChange={(event) => {
                    setAdding(event.target.value);
                  }}
                >
                  <option value="">Choose a step</option>
                  {specs.map((spec) => (
                    <option key={spec.type} value={spec.type}>
                      {spec.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <button
              type="button"
              className="admin-button admin-button--quiet"
              disabled={adding === "" || draft.steps.length >= maxSteps}
              onClick={add}
            >
              Add step
            </button>
          </div>
        </fieldset>
        <RoleGate action="automation.recipes_put">
          <div className="admin-actions admin-recipe__save">
            <button type="submit" className="admin-button" disabled={!dirty || save.isPending}>
              Save recipe
            </button>
            <button
              type="button"
              className="admin-button admin-button--quiet"
              disabled={!dirty || save.isPending}
              onClick={() => {
                setDraft(draftOf(recipe));
                setChecked(false);
              }}
            >
              Discard changes
            </button>
            {dirty ? <span className="admin-field__hint">Unsaved changes</span> : null}
          </div>
        </RoleGate>
        {save.isError ? <RequestFailure error={save.error} className="admin-field__error" /> : null}
      </form>
      <DryRunPanel trigger={recipe.trigger} specs={specs} unsaved={dirty} />
    </article>
  );
}
