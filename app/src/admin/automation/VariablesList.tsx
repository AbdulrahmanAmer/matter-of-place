import { useState } from "react";
import { sampleVariables, variablesByKey, type EmailTemplateKey } from "../../domain/email";
import { Field } from "../ui/Field";
import { StatusPill } from "../ui/StatusPill";

/**
 * What a template may name as `{{variable}}`, which of those its text uses now, and a warning for each name the sender
 * cannot supply. A value typed here replaces the sample in the preview; an empty one keeps the sample.
 */
export function VariablesList({
  templateKey,
  used,
  missing,
  onApply,
}: {
  templateKey: EmailTemplateKey;
  /** Every variable the draft names. */
  used: readonly string[];
  /** The variables the draft names that this template cannot supply. */
  missing: readonly string[];
  onApply: (values: Record<string, string>) => void;
}) {
  const names = variablesByKey[templateKey];
  const samples = sampleVariables(templateKey);
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <section className="admin-variables" aria-labelledby="variables-title">
      <h3 id="variables-title">Variables</h3>
      {missing.length === 0 ? null : (
        <p className="admin-field__error" role="alert">
          {`Not available in this email: ${missing.map((name) => `{{${name}}}`).join(", ")}. The email would not send with ${missing.length === 1 ? "it" : "them"}. Remove ${missing.length === 1 ? "it" : "them"} to save.`}
        </p>
      )}
      {names.length === 0 ? (
        <p className="admin-field__hint">This email takes no variables.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onApply(Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "")));
          }}
        >
          <ul className="admin-variables__list">
            {names.map((name) => (
              <li key={name}>
                <div className="admin-variables__name">
                  <code>{`{{${name}}}`}</code>
                  {used.includes(name) ? <StatusPill label="Used" tone="ok" /> : null}
                </div>
                <Field label={`Preview value for ${name}`}>
                  {(control) => (
                    <input
                      {...control}
                      type="text"
                      value={values[name] ?? ""}
                      placeholder={samples[name] ?? ""}
                      onChange={(event) => {
                        setValues({ ...values, [name]: event.target.value });
                      }}
                    />
                  )}
                </Field>
              </li>
            ))}
          </ul>
          <button type="submit" className="admin-button admin-button--quiet">
            Draw preview
          </button>
        </form>
      )}
    </section>
  );
}
