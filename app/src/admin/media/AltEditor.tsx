import { useState } from "react";
import { Field } from "../ui/Field";

/** The alt text of one photograph, saved on its own; an empty field clears it. */
export function AltEditor({
  label,
  value,
  saving = false,
  onSave,
}: {
  label: string;
  value: string | null;
  saving?: boolean;
  onSave: (alt: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const changed = draft.trim() !== (value ?? "");
  return (
    <form
      className="admin-alt"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft.trim());
      }}
    >
      <Field label={label}>
        {(control) => (
          <input
            {...control}
            type="text"
            maxLength={300}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
        )}
      </Field>
      <button
        type="submit"
        className="admin-button admin-button--quiet"
        disabled={!changed || saving}
      >
        Save alt
      </button>
    </form>
  );
}
