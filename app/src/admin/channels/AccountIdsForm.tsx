import { useState } from "react";
import { channelIdsSchema, type ChannelIdsKey } from "../../domain/channels";
import { Field } from "../ui/Field";
import { useToast } from "../ui/use-toast";
import { useSaveIds } from "./channels-queries";

// The non-secret ids of one channel, for the roles of `channels.ids_put`. It never asks for a token (they live in
// the vault and the function secrets); the server refuses any field `channelIdsSchema` does not name, and so does
// this form, because it takes its field names from that schema.

type Kind = "text" | "number" | "list" | "flag";

const specs: Record<string, { label: string; hint?: string; kind: Kind }> = {
  page_id: { label: "Page id", hint: "Digits only", kind: "text" },
  ig_user_id: { label: "Instagram account id", hint: "Digits only", kind: "text" },
  graph_version: { label: "Graph version", hint: "For example v23.0", kind: "text" },
  user_id: { label: "X user id", hint: "Digits only", kind: "text" },
  handle: { label: "Handle", hint: "Without the @", kind: "text" },
  read_allowance: { label: "Monthly read allowance", kind: "number" },
  metrics_days: {
    label: "Metrics days",
    hint: "Days after posting, separated by commas",
    kind: "list",
  },
  organization_urn: { label: "Organization", hint: "urn:li:organization:<id>", kind: "text" },
  api_version: { label: "API version", hint: "YYYYMM", kind: "text" },
  multi_image: { label: "Multi-image posts", kind: "flag" },
};

const fieldNames = (key: ChannelIdsKey) => Object.keys(channelIdsSchema[key].shape);

function entered(kind: Kind, value: string): unknown {
  if (kind === "number") return Number(value);
  if (kind === "list") return value.split(",").map((day) => Number(day.trim()));
  if (kind === "flag") return value === "true";
  return value.trim();
}

/** Only the fields the person filled in are sent; the server merges them into what is stored. */
export function AccountIdsForm({ idsKey }: { idsKey: ChannelIdsKey }) {
  const toast = useToast();
  const save = useSaveIds(idsKey);
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    const body: Record<string, unknown> = {};
    for (const name of fieldNames(idsKey)) {
      const value = values[name] ?? "";
      if (value.trim() !== "") body[name] = entered(specs[name]?.kind ?? "text", value);
    }
    if (Object.keys(body).length === 0) {
      setErrors({});
      setFormError("Fill in at least one field.");
      return;
    }
    const parsed = channelIdsSchema[idsKey].safeParse(body);
    if (!parsed.success) {
      setFormError(null);
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    setErrors({});
    setFormError(null);
    save.mutate(parsed.data, {
      onSuccess: () => {
        setValues({});
        toast({ message: "Account ids saved." });
      },
      onError: (error) => {
        toast({ message: error.message, tone: "danger" });
      },
    });
  };

  return (
    <form
      className="admin-channel__ids"
      aria-label="Account ids"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h3>Account ids</h3>
      {fieldNames(idsKey).map((name) => {
        const spec = specs[name];
        if (spec === undefined) return null;
        return (
          <Field
            key={name}
            label={spec.label}
            {...(spec.hint === undefined ? {} : { hint: spec.hint })}
            {...(errors[name] === undefined ? {} : { error: errors[name] })}
          >
            {(control) =>
              spec.kind === "flag" ? (
                <select
                  {...control}
                  value={values[name] ?? ""}
                  onChange={(event) => {
                    setValues({ ...values, [name]: event.target.value });
                  }}
                >
                  <option value="">Unchanged</option>
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </select>
              ) : (
                <input
                  {...control}
                  type="text"
                  value={values[name] ?? ""}
                  maxLength={200}
                  onChange={(event) => {
                    setValues({ ...values, [name]: event.target.value });
                  }}
                />
              )
            }
          </Field>
        );
      })}
      {formError === null ? null : <p role="alert">{formError}</p>}
      <button type="submit" className="admin-button admin-button--quiet" disabled={save.isPending}>
        Save ids
      </button>
    </form>
  );
}
