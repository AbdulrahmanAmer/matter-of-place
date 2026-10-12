import { StatusPill } from "../ui/StatusPill";
import { EmptyState } from "../ui/EmptyState";
import { useUrlFilters } from "../ui/use-url-filters";
import { useTemplates } from "./automation-queries";
import { emailTopics, emailWords } from "./email-words";
import { EmailTemplateEditor } from "./EmailTemplateEditor";
import { RequestFailure } from "./RequestFailure";

const filterNames = ["key"] as const;

/**
 * Screen 18. Every email under its topic, by the name a person uses for it, with its subject, who receives it and
 * whether it is on (admin pass, 2026-10-12, the same shape as Flows). The template in the address (`?key=received`)
 * opens at full width with the way back above it, so a link and a reload land on the same template.
 */
export function EmailsPage() {
  const templates = useTemplates();
  const filters = useUrlFilters(filterNames);
  const key = filters.values.key;

  if (templates.isPending) return <p role="status">Loading templates.</p>;
  if (templates.isError) return <RequestFailure error={templates.error} />;

  const open = templates.data.items.find((template) => template.key === key);
  if (open !== undefined)
    return (
      <>
        <button
          type="button"
          className="admin-flows__back"
          onClick={() => {
            filters.setFilters({});
          }}
        >
          All emails
        </button>
        <header className="admin-email-head">
          <h1>{emailWords[open.key].name}</h1>
          <p>Sent to {emailWords[open.key].to}.</p>
        </header>
        <EmailTemplateEditor key={`${open.key}:${String(open.version)}`} template={open} />
      </>
    );

  return (
    <>
      <h1>Emails</h1>
      <p className="admin-recipes__intro">
        What each email says. Open one to change its words, see it as the reader will, and send a
        test to yourself. A saved change applies to the next send.
      </p>
      {key === undefined || key === "" ? null : (
        <EmptyState title="That email is not here">Choose one from the list below.</EmptyState>
      )}
      <nav className="admin-flows" aria-label="Templates">
        {emailTopics.map((topic) => {
          const rows = templates.data.items.filter(
            (template) => emailWords[template.key].topic === topic,
          );
          if (rows.length === 0) return null;
          return (
            <section key={topic} className="admin-flows__topic" aria-label={topic}>
              <h2 className="admin-eyebrow">{topic}</h2>
              <ul>
                {rows.map((template) => (
                  <li key={template.key}>
                    <button
                      type="button"
                      className="admin-flows__row"
                      onClick={() => {
                        filters.setFilters({ key: template.key });
                      }}
                    >
                      <span className="admin-flows__name">{emailWords[template.key].name}</span>
                      <span className="admin-flows__sentence">
                        Subject: {template.subject}
                        {/[.?!]$/.test(template.subject) ? "" : "."} Sent to{" "}
                        {emailWords[template.key].to}.
                      </span>
                      <span className="admin-flows__meta">
                        <StatusPill
                          label={template.enabled ? "On" : "Off"}
                          tone={template.enabled ? "ok" : "neutral"}
                        />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </nav>
    </>
  );
}
