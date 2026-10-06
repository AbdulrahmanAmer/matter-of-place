import { useState } from "react";
import { acceptedStates, exposurePackages, submissionStates } from "../../domain/contracts";
import { Field } from "../ui/Field";
import type { RequestFilterName } from "./requests-queries";

type Values = Readonly<Partial<Record<RequestFilterName, string>>>;

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: readonly string[];
  onChange: (next: string) => void;
}) {
  return (
    <Field label={label}>
      {(control) => (
        <select
          {...control}
          value={value ?? ""}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          <option value="">All</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** The state, market and package choices apply at once; the search applies on Enter. */
export function RequestFilters({
  values,
  onChange,
}: {
  values: Values;
  onChange: (next: Values) => void;
}) {
  const [search, setSearch] = useState(values.search ?? "");
  const set = (name: RequestFilterName) => (next: string) => {
    onChange({ ...values, [name]: next });
  };
  return (
    <form
      className="admin-toolbar"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onChange({ ...values, search: search.trim() });
      }}
    >
      <Choice
        label="State"
        value={values.workflow_state}
        options={submissionStates}
        onChange={set("workflow_state")}
      />
      <Choice
        label="Market"
        value={values.market}
        options={acceptedStates}
        onChange={set("market")}
      />
      <Choice
        label="Package"
        value={values.package}
        options={exposurePackages}
        onChange={set("package")}
      />
      <Field label="Search" hint="Address, submitter or brokerage">
        {(control) => (
          <input
            {...control}
            type="search"
            value={search}
            maxLength={200}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        )}
      </Field>
    </form>
  );
}
