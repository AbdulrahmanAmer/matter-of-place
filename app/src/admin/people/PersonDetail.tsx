import type { ReactNode } from "react";
import type { PersonDetail as Person } from "../../domain/admin-people";
import { submitterKindLabels } from "../../domain/contracts";
import { formatMoney } from "../../lib/format";
import { marketSlugOf, stateTone } from "../requests/state-tone";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill } from "../ui/StatusPill";

/** One section of screen 27: a heading, then its list, or a calm line when there is nothing to list. */
function Section({
  title,
  none,
  children,
}: {
  title: string;
  none: string;
  children: readonly ReactNode[];
}) {
  return (
    <section className="admin-fields" aria-label={title}>
      <h2>{title}</h2>
      {children.length === 0 ? <p className="admin-history__none">{none}</p> : <ul>{children}</ul>}
    </section>
  );
}

/** A link to another screen while its route exists, otherwise the plain text. */
function Linked({ href, live, children }: { href: string; live: boolean; children: ReactNode }) {
  return live ? <a href={href}>{children}</a> : <>{children}</>;
}

/**
 * Screen 27: one person, as first recorded, and the six sections of invariant 23. `hasRoute` tells which of the
 * screens these rows link to exist yet (properties, invoices and inquiries arrive with later steps). `notes` is the
 * internal notes panel, drawn beside the details.
 */
export function PersonDetail({
  person,
  notes,
  hasRoute,
}: {
  person: Person;
  notes: ReactNode;
  hasRoute: (routeId: string) => boolean;
}) {
  const { contact } = person;
  const details: (readonly [string, string | null])[] = [
    ["Kind", submitterKindLabels[contact.kind]],
    ["Name", contact.name],
    ["Email", contact.email],
    ["Phone", contact.phone],
    ["Brokerage", contact.brokerage],
  ];
  return (
    <>
      <header className="admin-page-head">
        <div>
          <p className="admin-request__crumb">
            <a href="/admin/people">People</a>
          </p>
          <h1>{contact.name}</h1>
        </div>
      </header>
      <div className="admin-request">
        <div className="admin-request__main">
          <section className="admin-fields" aria-label="Details">
            <h2>Details</h2>
            <dl>
              {details
                .filter(([, value]) => value !== null && value !== "")
                .map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>
          </section>
          <Section title="Requests" none="No requests.">
            {person.requests.map((request) => (
              <li key={request.id}>
                <Linked
                  href={`/admin/requests/${request.id}`}
                  live={hasRoute("/admin/requests/$id")}
                >
                  {request.address}, {request.city}
                </Linked>{" "}
                <StatusPill
                  label={request.workflow_state}
                  tone={stateTone[request.workflow_state]}
                />{" "}
                <LocalTime
                  value={request.received_at}
                  marketSlug={marketSlugOf[request.state]}
                  style="date"
                />
              </li>
            ))}
          </Section>
          <Section title="Properties" none="No properties.">
            {person.properties.map((property) => (
              <li key={property.id}>
                <Linked
                  href={`/admin/properties/${property.id}`}
                  live={hasRoute("/admin/properties/$id")}
                >
                  {property.title}
                </Linked>{" "}
                <StatusPill label={property.editorial_state} />
              </li>
            ))}
          </Section>
          <Section title="Invoices and payments" none="No invoices.">
            {person.payments.map((payment) => (
              <li key={payment.id}>
                <Linked
                  href={`/admin/invoices/${payment.id}`}
                  live={hasRoute("/admin/invoices/$id")}
                >
                  {payment.invoice_number ?? "Not issued"}
                </Linked>
                , {payment.product}, {formatMoney(payment.amount, payment.currency)}{" "}
                <StatusPill label={payment.status} />
                {payment.issued_at === null ? null : (
                  <>
                    {" "}
                    Issued <LocalTime value={payment.issued_at} style="date" />
                  </>
                )}
                {payment.paid_at === null ? null : (
                  <>
                    {" "}
                    Paid <LocalTime value={payment.paid_at} style="date" />
                  </>
                )}
              </li>
            ))}
          </Section>
          <Section title="Emails" none="No emails sent.">
            {person.emails.map((email) => (
              <li key={email.id}>
                {email.template_key} <StatusPill label={email.status} />{" "}
                <LocalTime value={email.sent_at ?? email.created_at} />
              </li>
            ))}
          </Section>
          <Section title="Inquiries" none="No inquiries about their properties.">
            {person.inquiries.map((inquiry) => (
              <li key={inquiry.id}>
                <Linked
                  href={`/admin/inquiries?id=${inquiry.id}`}
                  live={hasRoute("/admin/inquiries/")}
                >
                  <LocalTime value={inquiry.received_at} />
                </Linked>
                , {inquiry.intent}
                {inquiry.subject_title === null ? null : `, ${inquiry.subject_title}`}{" "}
                <StatusPill label={inquiry.state} />
              </li>
            ))}
          </Section>
        </div>
        <aside className="admin-request__side">{notes}</aside>
      </div>
    </>
  );
}
