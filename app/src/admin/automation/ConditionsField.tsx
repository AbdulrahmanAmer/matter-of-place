import { assetKinds, marketSlugs, tiers } from "../../domain/events";
import { conditionsSchema, type Conditions } from "../../domain/automation";

const groups = [
  {
    key: "tiers",
    legend: "Tier",
    options: tiers.map((value) => ({ value, label: value })),
  },
  {
    key: "markets",
    legend: "Market",
    options: marketSlugs.map((value) => ({
      value,
      label: { california: "California", "new-york": "New York", florida: "Florida" }[value],
    })),
  },
  {
    key: "kinds",
    legend: "Asset",
    options: assetKinds.map((value) => ({ value, label: value.replaceAll("_", " ") })),
  },
] as const;

type GroupKey = (typeof groups)[number]["key"];

/**
 * When a step applies. A group with nothing picked puts no condition on that part of the event, so the step runs for
 * every tier, market or asset kind; an empty list is never written, because the server refuses one.
 */
export function ConditionsField({
  value,
  onChange,
}: {
  value: Conditions;
  onChange: (next: Conditions) => void;
}) {
  const toggle = (key: GroupKey, option: string, on: boolean) => {
    const chosen: readonly string[] = value[key] ?? [];
    const next = on ? [...chosen, option] : chosen.filter((item) => item !== option);
    const kept = Object.entries(value).filter(([name]) => name !== key);
    onChange(
      conditionsSchema.parse(Object.fromEntries(next.length === 0 ? kept : [...kept, [key, next]])),
    );
  };

  return (
    <div className="admin-conditions">
      <p className="admin-field__hint">Leave a group empty to run for every event.</p>
      {groups.map((group) => {
        const chosen: readonly string[] = value[group.key] ?? [];
        return (
          <fieldset key={group.key} className="admin-params__group">
            <legend>{group.legend}</legend>
            {group.options.map((option) => (
              <label key={option.value} className="admin-check">
                <input
                  type="checkbox"
                  checked={chosen.includes(option.value)}
                  onChange={(event) => {
                    toggle(group.key, option.value, event.target.checked);
                  }}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}
