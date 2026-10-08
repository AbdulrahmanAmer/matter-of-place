import { StatusPill } from "../ui/StatusPill";
import { EmptyState } from "../ui/EmptyState";
import { useUrlFilters } from "../ui/use-url-filters";
import { useTemplates } from "./automation-queries";
import { EmailTemplateEditor } from "./EmailTemplateEditor";

const filterNames = ["key"] as const;

/**
 * Screen 18. The template in the address (`?key=received`) is the one open beside the list, so a link and a reload land
 * on the same template.
 */
export function EmailsPage() {
  const templates = useTemplates();
  const filters = useUrlFilters(filterNames);
  const key = filters.values.key;

  if (templates.isPending) return <p role="status">Loading templates.</p>;
  if (templates.isError) return <p role="alert">{templates.error.message}</p>;

  const open = templates.data.items.find((template) => template.key === key);
  return (
    <>
      <h1>Email templates</h1>
      <p className="admin-recipes__intro">
        What each email says. A saved change applies to the next send, with no deploy.
      </p>
      <div className="admin-recipes">
        <nav className="admin-recipes__list" aria-label="Templates">
          <ul>
            {templates.data.items.map((template) => (
              <li key={template.key}>
                <button
                  type="button"
                  aria-current={template.key === open?.key ? "true" : undefined}
                  onClick={() => {
                    filters.setFilters({ key: template.key });
                  }}
                >
                  <span className="admin-recipes__name">{template.subject}</span>
                  <code>{template.key}</code>
                  <span className="admin-recipes__meta">
                    <StatusPill
                      label={template.enabled ? "On" : "Off"}
                      tone={template.enabled ? "ok" : "neutral"}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {open === undefined ? (
          <EmptyState title="Choose a template">Pick one on the left to edit it.</EmptyState>
        ) : (
          <EmailTemplateEditor key={`${open.key}:${String(open.version)}`} template={open} />
        )}
      </div>
    </>
  );
}
