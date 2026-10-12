import { StatusPill } from "../ui/StatusPill";
import type { Step, StepSpecView } from "./automation-queries";
import { ConditionsField } from "./ConditionsField";
import { ParamsForm } from "./ParamsForm";

/**
 * One step of a recipe: its name and switches on top, its settings and conditions behind "Settings". The id is shown
 * and never edited: jobs of earlier events are keyed by it.
 */
export function StepCard({
  step,
  spec,
  position,
  count,
  errors,
  selected = false,
  onChange,
  onMove,
  onRemove,
}: {
  step: Step;
  /** Absent when the catalog no longer holds the step's type. */
  spec: StepSpecView | undefined;
  position: number;
  count: number;
  errors: Readonly<Record<string, string>>;
  /** Chosen on the flow above: its settings open and the card is marked. */
  selected?: boolean;
  onChange: (next: Step) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const label = spec?.label ?? step.step_type;
  const invalid = Object.keys(errors).length > 0;
  return (
    <li
      id={`step-${step.id}`}
      className="admin-step"
      data-enabled={step.enabled}
      data-invalid={invalid}
      data-selected={selected ? "" : undefined}
    >
      <div className="admin-step__head">
        <span className="admin-step__position">{position + 1}</span>
        <div className="admin-step__name">
          <strong>{label}</strong>
          {spec === undefined ? null : (
            <span className="admin-step__about">{spec.description}</span>
          )}
        </div>
        <div className="admin-step__pills">
          {spec === undefined ? <StatusPill label="Unknown step" tone="danger" /> : null}
          {spec?.implemented === false ? <StatusPill label="Not built yet" tone="warning" /> : null}
          {spec?.heavy === true ? <StatusPill label="Heavy" /> : null}
          {spec?.local === true ? <StatusPill label="Runs on the laptop" /> : null}
        </div>
        <label className="admin-check">
          <input
            type="checkbox"
            aria-label={`${label}: on`}
            checked={step.enabled}
            onChange={(event) => {
              onChange({ ...step, enabled: event.target.checked });
            }}
          />
          On
        </label>
        <label className="admin-check">
          <input
            type="checkbox"
            aria-label={`${label}: needs approval`}
            checked={step.requires_approval}
            onChange={(event) => {
              onChange({ ...step, requires_approval: event.target.checked });
            }}
          />
          Needs approval
        </label>
        <div className="admin-actions">
          <button
            type="button"
            className="admin-step__action"
            disabled={position === 0}
            aria-label={`Move ${label} up`}
            onClick={() => {
              onMove(-1);
            }}
          >
            Up
          </button>
          <button
            type="button"
            className="admin-step__action"
            disabled={position === count - 1}
            aria-label={`Move ${label} down`}
            onClick={() => {
              onMove(1);
            }}
          >
            Down
          </button>
          <button
            type="button"
            className="admin-step__action"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
          >
            Remove
          </button>
        </div>
      </div>
      <details open={invalid || selected}>
        <summary>Change its settings and when it runs</summary>
        <p className="admin-field__hint">
          Reference <code>{step.id}</code>, kept so earlier runs stay linked.
        </p>
        {spec === undefined ? null : (
          <ParamsForm
            fields={spec.fields}
            value={step.params}
            errors={errors}
            onChange={(params) => {
              onChange({ ...step, params: { ...params } });
            }}
          />
        )}
        <h4>When it applies</h4>
        <ConditionsField
          value={step.conditions}
          onChange={(conditions) => {
            onChange({ ...step, conditions });
          }}
        />
      </details>
    </li>
  );
}
