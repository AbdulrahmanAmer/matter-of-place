import { useProperties } from "../properties/properties-queries";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { useUrlFilters } from "../ui/use-url-filters";
import { MediaGrid } from "./MediaGrid";

const filterNames = ["property_id"] as const;

/** Screen 9: one property's photographs at a time, the property chosen in the address (`?property_id=`). */
export function MediaPage() {
  const filters = useUrlFilters(filterNames);
  const properties = useProperties({});
  const propertyId = filters.values.property_id;
  return (
    <>
      <h1>Media</h1>
      <Field label="Property" hint="The 50 properties changed most recently.">
        {(control) => (
          <select
            {...control}
            value={propertyId ?? ""}
            onChange={(event) => {
              filters.setFilters({ property_id: event.target.value });
            }}
          >
            <option value="">Choose a property</option>
            {(properties.data?.items ?? []).map((property) => (
              <option key={property.id} value={property.id}>
                {property.title}
              </option>
            ))}
          </select>
        )}
      </Field>
      {propertyId === undefined ? (
        <EmptyState title="Choose a property">
          Its photographs and their renders appear here.
        </EmptyState>
      ) : (
        <MediaGrid key={propertyId} propertyId={propertyId} />
      )}
    </>
  );
}
