import { useState } from "react";
import type { DailyLimits } from "../../domain/admin-team";
import { Field } from "../ui/Field";

const fields: { key: keyof DailyLimits; label: string; min: number }[] = [
  { key: "decisions_per_day", label: "Decisions per day", min: 0 },
  { key: "publish_per_day", label: "Publications per day", min: 0 },
  { key: "requests_per_day", label: "Requests per day", min: 1 },
];

/** The daily caps every agent works under; each counts per agent and resets at midnight UTC. */
export function DailyLimitsForm({
  limits,
  pending,
  onSave,
}: {
  limits: DailyLimits;
  pending: boolean;
  onSave: (limits: DailyLimits) => void;
}) {
  const [values, setValues] = useState(limits);
  return (
    <form
      className="admin-toolbar"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(values);
      }}
    >
      {fields.map((field) => (
        <Field key={field.key} label={field.label}>
          {(control) => (
            <input
              {...control}
              type="number"
              required
              min={field.min}
              step={1}
              value={values[field.key]}
              onChange={(event) => {
                setValues({ ...values, [field.key]: Number(event.target.value) });
              }}
            />
          )}
        </Field>
      ))}
      <button type="submit" className="admin-button" disabled={pending}>
        Save limits
      </button>
    </form>
  );
}
