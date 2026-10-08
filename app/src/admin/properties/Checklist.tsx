import type { ChecklistResult } from "../../domain/admin-properties";

/** The publish checklist (invariant 8): each item, and for the facts every empty field by name. */
export function Checklist({ items }: { items: readonly ChecklistResult[] }) {
  return (
    <ul className="admin-checklist" aria-label="Publish checklist">
      {items.map((item) => (
        <li key={item.id} className="admin-checklist__item" data-passed={item.passed}>
          <span>{item.passed ? "Done" : "Missing"}</span> {item.label}
          {item.missing.length > 0 ? (
            <span className="admin-checklist__missing">: {item.missing.join(", ")}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
