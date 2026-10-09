import { useState } from "react";
import {
  siteFieldSpecs,
  siteSettingsSchema,
  type SiteFieldSpec,
  type SiteSettings,
} from "../../domain/settings";
import { Field } from "../ui/Field";

type Values = Readonly<Record<string, string>>;

/** The stored leaf of a field spec key (`legal.entity`), blank when unset. */
function leafOf(site: SiteSettings, key: string): string {
  const [group = "", field = ""] = key.split(".");
  const leaves: unknown = Reflect.get(site, group);
  const value: unknown = typeof leaves === "object" && leaves !== null ? Reflect.get(leaves, field) : null;
  return typeof value === "string" ? value : "";
}

/** The edited values in the nested shape B16 stores; the schema turns a blank leaf into null. */
function siteOf(values: Values): Record<string, Record<string, string>> {
  const site: Record<string, Record<string, string>> = {};
  for (const spec of siteFieldSpecs) {
    const [group = "", field = ""] = spec.key.split(".");
    site[group] = { ...site[group], [field]: values[spec.key] ?? "" };
  }
  return site;
}

function Control({
  spec,
  value,
  onChange,
  control,
}: {
  spec: SiteFieldSpec;
  value: string;
  onChange: (value: string) => void;
  control: { id: string; "aria-describedby": string | undefined; "aria-invalid": boolean };
}) {
  if (spec.input === "textarea") {
    return (
      <textarea
        {...control}
        rows={3}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    );
  }
  return (
    <input
      {...control}
      type={spec.input}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );
}

/**
 * The legal identity every surface reads (B16's `siteFieldSpecs`, in their order). A required field that is still
 * unset says so beside it, from the same readiness list the banner shows.
 */
export function IdentitySection({
  site,
  readiness,
  pending,
  onSave,
}: {
  site: SiteSettings;
  readiness: readonly string[];
  pending: boolean;
  onSave: (site: SiteSettings) => void;
}) {
  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(siteFieldSpecs.map((spec) => [spec.key, leafOf(site, spec.key)])),
  );
  const [errors, setErrors] = useState<Values>({});
  return (
    <form
      className="admin-fields"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = siteSettingsSchema.safeParse(siteOf(values));
        if (parsed.success) {
          setErrors({});
          onSave(parsed.data);
          return;
        }
        setErrors(
          Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message])),
        );
      }}
    >
      {siteFieldSpecs.map((spec) => (
        <Field
          key={spec.key}
          label={spec.label}
          hint={readiness.includes(spec.key) ? `${spec.help} Needed before launch.` : spec.help}
          {...(errors[spec.key] === undefined ? {} : { error: errors[spec.key] })}
        >
          {(control) => (
            <Control
              spec={spec}
              control={control}
              value={values[spec.key] ?? ""}
              onChange={(value) => {
                setValues({ ...values, [spec.key]: value });
              }}
            />
          )}
        </Field>
      ))}
      <button type="submit" className="admin-button" disabled={pending}>
        Save identity
      </button>
    </form>
  );
}
