import { Field } from "../ui/Field";
import type { StepField } from "./automation-queries";

type Params = Readonly<Record<string, unknown>>;

function without(params: Params, key: string): Params {
  return Object.fromEntries(Object.entries(params).filter(([name]) => name !== key));
}

/** The values a multiselect holds: a stored word such as `from_settings` means none are picked. */
function picked(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

const shown = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

function defaultText(field: StepField): string | undefined {
  const { default: fallback } = field;
  if (fallback === undefined || typeof fallback === "boolean") return undefined;
  return Array.isArray(fallback) ? fallback.join(", ") : String(fallback);
}

/**
 * The settings of one step, drawn from the `fields` of its spec. A key the person leaves empty is not written, so
 * the schema's own default applies when the step runs; a boolean is always written once it is touched.
 */
export function ParamsForm({
  fields,
  value,
  errors,
  onChange,
}: {
  fields: readonly StepField[];
  value: Params;
  errors: Readonly<Record<string, string>>;
  onChange: (next: Params) => void;
}) {
  if (fields.length === 0) return <p className="admin-step__none">This step has no settings.</p>;

  const set = (key: string, next: unknown) => {
    onChange(next === undefined ? without(value, key) : { ...value, [key]: next });
  };

  return (
    <div className="admin-params">
      {fields.map((field) => {
        const current = value[field.key];
        const hint = field.hint;
        const error = errors[field.key];
        const notes = {
          ...(hint === undefined ? {} : { hint }),
          ...(error === undefined ? {} : { error }),
        };

        if (field.kind === "multiselect") {
          const chosen = picked(current);
          return (
            <fieldset key={field.key} className="admin-params__group">
              <legend>{field.label}</legend>
              {(field.options ?? []).map((option) => (
                <label key={option.value} className="admin-check">
                  <input
                    type="checkbox"
                    checked={chosen.includes(option.value)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...chosen, option.value]
                        : chosen.filter((item) => item !== option.value);
                      set(field.key, next.length === 0 ? undefined : next);
                    }}
                  />
                  {option.label}
                </label>
              ))}
              {hint === undefined ? null : <p className="admin-field__hint">{hint}</p>}
              {error === undefined ? null : (
                <p className="admin-field__error" role="alert">
                  {error}
                </p>
              )}
            </fieldset>
          );
        }

        if (field.kind === "boolean") {
          const on = typeof current === "boolean" ? current : field.default === true;
          return (
            <div key={field.key} className="admin-params__group">
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(event) => {
                    set(field.key, event.target.checked);
                  }}
                />
                {field.label}
              </label>
              {hint === undefined ? null : <p className="admin-field__hint">{hint}</p>}
            </div>
          );
        }

        return (
          <Field key={field.key} label={field.label} {...notes}>
            {(control) => {
              if (field.kind === "select") {
                return (
                  <select
                    {...control}
                    value={shown(current)}
                    onChange={(event) => {
                      set(field.key, event.target.value === "" ? undefined : event.target.value);
                    }}
                  >
                    <option value="">{field.required === true ? "Choose" : "Default"}</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                );
              }
              const fallback = defaultText(field);
              return (
                <input
                  {...control}
                  type={field.kind === "number" ? "number" : "text"}
                  value={shown(current)}
                  placeholder={fallback}
                  {...(field.min === undefined ? {} : { min: field.min })}
                  {...(field.max === undefined ? {} : { max: field.max })}
                  onChange={(event) => {
                    const raw = event.target.value;
                    if (raw === "") set(field.key, undefined);
                    else set(field.key, field.kind === "number" ? Number(raw) : raw);
                  }}
                />
              );
            }}
          </Field>
        );
      })}
    </div>
  );
}
