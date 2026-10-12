import { useState } from "react";
import { Field } from "../ui/Field";
import { RoleGate } from "../ui/RoleGate";
import { useAdminMe } from "../ui/admin-me";
import { useToast } from "../ui/use-toast";
import { useSaveRecipe, type RecipeRow, type StepSpecView } from "./automation-queries";
import { DryRunPanel } from "./DryRunPanel";
import { FlowCanvas } from "./FlowCanvas";
import { thenOf, whenOf } from "./flow-words";
import { RequestFailure } from "./RequestFailure";
import { checkDraft, draftOf, maxSteps, newStep, sameDraft, type Draft } from "./recipe-draft";
import { StepCard } from "./StepCard";

/**
 * One flow (W3): what it does as a sentence, Save and Try it safely at the top, then its steps as a list with "Add a
 * step here" between them; the drawing is a second view of the same steps. The draft is local until Save; a saved
 * flow applies to the next event with no deploy. The parent keys this component by the recipe's version, so a
 * refetch after a save starts a fresh draft from what the server holds.
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
  const [pickerAt, setPickerAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "diagram">("list");

  const dirty = !sameDraft(draft, draftOf(recipe));
  const problems = checkDraft(draft, specs);
  const shown = checked ? problems : undefined;
  const canEdit = actions.includes("automation.recipes_put");
  const full = draft.steps.length >= maxSteps;

  const replaceStep = (index: number, next: Draft["steps"][number]) => {
    setDraft({ ...draft, steps: draft.steps.map((step, at) => (at === index ? next : step)) });
  };

  const moveTo = (from: number, to: number) => {
    const steps = [...draft.steps];
    const [moved] = steps.splice(from, 1);
    if (moved === undefined) return;
    steps.splice(to, 0, moved);
    setDraft({ ...draft, steps });
  };

  const insertAt = (index: number, spec: StepSpecView) => {
    if (full) return;
    const step = newStep(spec, draft.steps);
    const steps = [...draft.steps];
    steps.splice(index, 0, step);
    setDraft({ ...draft, steps });
    setSelected(step.id);
    setPickerAt(null);
  };

  const submit = () => {
    setChecked(true);
    if (!problems.ok) return;
    save.mutate(
      { trigger: recipe.trigger, patch: draft },
      {
        onSuccess: () => {
          toast({ message: "Flow saved. It applies to the next event." });
        },
      },
    );
  };

  const nameOf = (type: string) => specs.find((spec) => spec.type === type)?.label ?? type;

  /** The place between steps where a new one goes: a quiet button, or the list of steps to choose from. */
  const addHere = (index: number) => {
    if (!canEdit || full) return null;
    const before = draft.steps[index];
    const label =
      before === undefined
        ? "Add a step at the end"
        : `Add a step before ${nameOf(before.step_type)}`;
    if (pickerAt !== index)
      return (
        <li className="admin-flow__add" key={`add-${String(index)}`}>
          <button
            type="button"
            className="admin-flow__add-button"
            aria-label={label}
            onClick={() => {
              setPickerAt(index);
            }}
          >
            {before === undefined ? "Add a step at the end" : "Add a step here"}
          </button>
        </li>
      );
    return (
      <li className="admin-flow__add" key={`add-${String(index)}`}>
        <fieldset className="admin-flow__picker">
          <legend>Choose the step to add</legend>
          <ul>
            {specs.map((spec) => (
              <li key={spec.type}>
                <button
                  type="button"
                  className="admin-flow__choice"
                  onClick={() => {
                    insertAt(index, spec);
                  }}
                >
                  <strong>{spec.label}</strong>
                  <span>{spec.description}</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="admin-button admin-button--quiet"
            onClick={() => {
              setPickerAt(null);
            }}
          >
            Cancel
          </button>
        </fieldset>
      </li>
    );
  };

  return (
    <article className="admin-flow" aria-label={recipe.name}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <header className="admin-flow__head">
          <div className="admin-flow__title">
            <h1>{draft.name.trim() === "" ? recipe.name : draft.name}</h1>
            <p className="admin-flow__sentence">
              When {whenOf(recipe)}: {thenOf(draft.steps, specs)}.
            </p>
            <p className="admin-flow__state">
              {draft.enabled ? "This flow is on." : "This flow is off: nothing follows the event."}
              {dirty ? " You have unsaved changes." : ""}
            </p>
          </div>
          <div className="admin-actions admin-flow__actions">
            <RoleGate action="automation.dry_run">
              <a className="admin-button admin-button--quiet" href="#dry-run-title">
                Try it safely
              </a>
            </RoleGate>
            <RoleGate action="automation.recipes_put">
              <button
                type="button"
                className="admin-button admin-button--quiet"
                disabled={!dirty || save.isPending}
                onClick={() => {
                  setDraft(draftOf(recipe));
                  setChecked(false);
                  setPickerAt(null);
                }}
              >
                Discard changes
              </button>
              <button type="submit" className="admin-button" disabled={!dirty || save.isPending}>
                Save flow
              </button>
            </RoleGate>
          </div>
        </header>
        {save.isError ? <RequestFailure error={save.error} className="admin-field__error" /> : null}
        <fieldset className="admin-recipe__fields" disabled={!canEdit || save.isPending}>
          <legend className="admin-visually-hidden">The flow</legend>
          <div className="admin-flow__basics">
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
            <label className="admin-check admin-flow__switch">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => {
                  setDraft({ ...draft, enabled: event.target.checked });
                }}
              />
              This flow is on
            </label>
          </div>
          <div className="admin-flow__steps-head">
            <h2>Steps, in order</h2>
            <div className="admin-flow__views" role="group" aria-label="Show the steps as">
              <button
                type="button"
                aria-pressed={view === "list"}
                onClick={() => {
                  setView("list");
                }}
              >
                List
              </button>
              <button
                type="button"
                aria-pressed={view === "diagram"}
                onClick={() => {
                  setView("diagram");
                }}
              >
                Diagram
              </button>
            </div>
          </div>
          {view === "diagram" ? (
            <FlowCanvas
              event={recipe.trigger}
              steps={draft.steps}
              specs={specs}
              canEdit={canEdit}
              selected={selected}
              onSelect={(id) => {
                setSelected(id);
                setView("list");
                window.requestAnimationFrame(() => {
                  document.getElementById(`step-${id}`)?.scrollIntoView({ block: "nearest" });
                });
              }}
              onInsert={insertAt}
              onMoveTo={moveTo}
            />
          ) : (
            <ol className="admin-steps">
              {draft.steps.length === 0 ? (
                <li className="admin-step__none">
                  No steps yet. The event happens and nothing follows.
                </li>
              ) : null}
              {draft.steps.flatMap((step, index) => [
                addHere(index),
                <StepCard
                  key={step.id}
                  step={step}
                  spec={specs.find((spec) => spec.type === step.step_type)}
                  position={index}
                  count={draft.steps.length}
                  errors={shown?.params[index] ?? {}}
                  selected={selected === step.id}
                  onChange={(next) => {
                    replaceStep(index, next);
                  }}
                  onMove={(by) => {
                    moveTo(index, index + by);
                  }}
                  onRemove={() => {
                    setDraft({ ...draft, steps: draft.steps.filter((_, at) => at !== index) });
                  }}
                />,
              ])}
              {addHere(draft.steps.length)}
            </ol>
          )}
          {full ? (
            <p className="admin-field__hint">A flow holds at most {String(maxSteps)} steps.</p>
          ) : null}
          {shown?.steps === undefined ? null : (
            <p className="admin-field__error" role="alert">
              {shown.steps}
            </p>
          )}
        </fieldset>
      </form>
      <DryRunPanel trigger={recipe.trigger} specs={specs} unsaved={dirty} />
    </article>
  );
}
