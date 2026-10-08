import { useState, type SyntheticEvent } from "react";
import type { Representative, RepresentativePut } from "../../domain/admin-properties";
import { Field } from "../ui/Field";
import { RoleGate } from "../ui/RoleGate";
import type { EditFields } from "./editor-values";
import { usePutRepresentative, useRepresentatives } from "./properties-queries";

const blank: RepresentativePut = {
  name: "",
  brokerage: "",
  license: null,
  email: null,
  phone: null,
};

const formOf = (row: Representative): RepresentativePut => ({
  id: row.id,
  name: row.name,
  brokerage: row.brokerage,
  license: row.license,
  email: row.email,
  phone: row.phone,
});

/** Creates a representative or edits the one it was opened on (`properties.representative_put`). */
function RepresentativeForm({
  initial,
  pending,
  onSave,
  onCancel,
}: {
  initial: RepresentativePut;
  pending: boolean;
  onSave: (representative: RepresentativePut) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    onSave(form);
  };
  const line = (key: "license" | "email" | "phone", label: string) => (
    <Field label={label}>
      {(control) => (
        <input
          {...control}
          value={form[key] ?? ""}
          onChange={(event) => {
            setForm({ ...form, [key]: event.target.value === "" ? null : event.target.value });
          }}
        />
      )}
    </Field>
  );
  return (
    <form className="admin-editor__fields" onSubmit={submit}>
      <Field label="Name">
        {(control) => (
          <input
            {...control}
            required
            value={form.name}
            onChange={(event) => {
              setForm({ ...form, name: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label="Brokerage">
        {(control) => (
          <input
            {...control}
            value={form.brokerage}
            onChange={(event) => {
              setForm({ ...form, brokerage: event.target.value });
            }}
          />
        )}
      </Field>
      {line("license", "Licence")}
      {line("email", "Email")}
      {line("phone", "Phone")}
      <div className="admin-actions">
        <button type="submit" className="admin-button" disabled={pending}>
          Save representative
        </button>
        <button type="button" className="admin-button admin-button--quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Screen 8, Representation: the agent shown on the page, picked from the list or created here, or "Presented by the
 * owner" for an owner's home (S55). Choosing saves `representative_id` through the property's autosave.
 */
export function RepresentationTab({
  propertyId,
  representative,
  presentedByOwner,
  onEdit,
}: {
  propertyId: string;
  representative: Representative | null;
  presentedByOwner: boolean;
  onEdit: EditFields;
}) {
  const [current, setCurrent] = useState(representative);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<RepresentativePut | null>(null);
  const found = useRepresentatives(search.trim());
  const put = usePutRepresentative(propertyId);

  const choose = (row: Representative) => {
    setCurrent(row);
    onEdit({ representative_id: row.id });
  };

  return (
    <div className="admin-editor__fields">
      <label className="admin-editor__switch">
        <input
          type="checkbox"
          checked={presentedByOwner}
          onChange={(event) => {
            onEdit({ presented_by_owner: event.target.checked });
          }}
        />
        Presented by the owner
      </label>
      <section aria-label="Representative">
        {current === null ? (
          <p>No representative.</p>
        ) : (
          <p>
            {current.name}
            {current.brokerage === "" ? "" : `, ${current.brokerage}`}
          </p>
        )}
        <RoleGate action="properties.representative_put">
          <div className="admin-actions">
            {current === null ? null : (
              <button
                type="button"
                className="admin-button admin-button--quiet"
                onClick={() => {
                  setForm(formOf(current));
                }}
              >
                Edit representative
              </button>
            )}
            <button
              type="button"
              className="admin-button admin-button--quiet"
              onClick={() => {
                setForm(blank);
              }}
            >
              New representative
            </button>
          </div>
        </RoleGate>
      </section>
      {form === null ? null : (
        <RepresentativeForm
          key={form.id ?? "new"}
          initial={form}
          pending={put.isPending}
          onCancel={() => {
            setForm(null);
          }}
          onSave={(fields) => {
            put.mutate(fields, {
              onSuccess: ({ id }) => {
                setForm(null);
                choose({
                  id,
                  name: fields.name,
                  brokerage: fields.brokerage,
                  license: fields.license ?? null,
                  email: fields.email ?? null,
                  phone: fields.phone ?? null,
                });
              },
            });
          }}
        />
      )}
      {put.error === null ? null : (
        <p className="admin-field__error" role="alert">
          {put.error.message}
        </p>
      )}
      <Field label="Find a representative" hint="Name or brokerage">
        {(control) => (
          <input
            {...control}
            type="search"
            value={search}
            maxLength={120}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        )}
      </Field>
      <ul className="admin-editor__results">
        {(found.data?.items ?? []).map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className="admin-button admin-button--quiet"
              aria-pressed={current?.id === row.id}
              onClick={() => {
                choose(row);
              }}
            >
              {row.name}
              {row.brokerage === "" ? "" : `, ${row.brokerage}`}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
