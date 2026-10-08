import { useState } from "react";
import { skipReasonLabels } from "../../domain/automation";
import { Field } from "../ui/Field";
import { RoleGate } from "../ui/RoleGate";
import { StatusPill } from "../ui/StatusPill";
import { useDryRun, type StepSpecView } from "./automation-queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the planner would do with the saved recipe for one event, with nothing written. It reads the saved recipe, so
 * unsaved edits do not count; the panel says so while there are any.
 */
export function DryRunPanel({
  trigger,
  specs,
  unsaved,
}: {
  trigger: string;
  specs: readonly StepSpecView[];
  unsaved: boolean;
}) {
  const dryRun = useDryRun();
  const [entityId, setEntityId] = useState("");
  const [entityError, setEntityError] = useState<string | undefined>();
  const labelOf = (type: string) => specs.find((spec) => spec.type === type)?.label ?? type;
  const result = dryRun.data;

  return (
    <RoleGate action="automation.dry_run">
      <section className="admin-dryrun" aria-labelledby="dry-run-title">
        <h3 id="dry-run-title">Dry run</h3>
        <p className="admin-field__hint">
          Shows which steps the next event would queue and which it would skip. Nothing is sent.
          {unsaved ? " It reads the saved recipe, not your unsaved changes." : ""}
        </p>
        <form
          className="admin-dryrun__form"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = entityId.trim();
            if (trimmed !== "" && !UUID.test(trimmed)) {
              setEntityError("Use the id of a record, or leave this empty for sample data");
              return;
            }
            setEntityError(undefined);
            dryRun.mutate({ trigger, entityId: trimmed === "" ? undefined : trimmed });
          }}
        >
          <Field
            label="Record id"
            hint="Optional. Builds the sample event from this record."
            {...(entityError === undefined ? {} : { error: entityError })}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                value={entityId}
                onChange={(event) => {
                  setEntityId(event.target.value);
                }}
              />
            )}
          </Field>
          <button
            type="submit"
            className="admin-button admin-button--quiet"
            disabled={dryRun.isPending}
          >
            Run dry run
          </button>
        </form>
        {dryRun.isError ? (
          <p role="alert" className="admin-field__error">
            {dryRun.error.message}
          </p>
        ) : null}
        {result === undefined ? null : (
          <div className="admin-dryrun__result" aria-live="polite">
            {result.recipe_enabled ? null : <p>{skipReasonLabels.recipe_disabled}.</p>}
            <h4>Would queue</h4>
            {result.planned.length === 0 ? (
              <p>No step would run.</p>
            ) : (
              <ul>
                {result.planned.map((job) => (
                  <li key={job.step_id}>
                    <strong>{labelOf(job.type)}</strong> <code>{job.step_id}</code>{" "}
                    <StatusPill
                      label={job.status === "waiting_approval" ? "Waits for approval" : "Queued"}
                    />
                    {job.run_local ? <StatusPill label="Runs on the laptop" /> : null}
                  </li>
                ))}
              </ul>
            )}
            <h4>Would skip</h4>
            {result.skipped.length === 0 ? (
              <p>No step would be skipped.</p>
            ) : (
              <ul>
                {result.skipped.map((step) => (
                  <li key={step.step_id}>
                    <strong>{labelOf(step.type)}</strong> <code>{step.step_id}</code>{" "}
                    <span>{skipReasonLabels[step.reason]}</span>
                  </li>
                ))}
              </ul>
            )}
            {result.warnings.length === 0 ? null : (
              <>
                <h4>Warnings</h4>
                <ul>
                  {result.warnings.map((warning) => (
                    <li key={`${warning.code}:${warning.step_id ?? ""}`}>{warning.message}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>
    </RoleGate>
  );
}
