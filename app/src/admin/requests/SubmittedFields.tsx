import type { ReactNode } from "react";
import { submitterKindLabels } from "../../domain/contracts";
import type { SubmissionDetail } from "../../domain/admin-submissions";
import { formatMoney, formatNumber } from "../../lib/format";

/** A link a submitter typed in is opened only when it is a web address. */
function webAddress(value: string): string | null {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="admin-fields" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Rows with no value are left out, so a group shows what was submitted and nothing else. */
function Facts({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl>
      {rows
        .filter(([, value]) => value !== null && value !== "")
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

const external = (value: string | null): ReactNode => {
  const href = value === null ? null : webAddress(value);
  if (value === null || href === null) return value;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {value}
    </a>
  );
};

const optionalCount = (value: number | null, unit: string): ReactNode =>
  value === null ? null : `${formatNumber(value)}${unit}`;

/** Everything the submitter entered, grouped as screen 4 lists it (invariant 23 for the People group). */
export function SubmittedFields({ detail }: { detail: SubmissionDetail }) {
  const owner = detail.submitter_kind === "owner";
  return (
    <>
      <Group title="Property">
        <Facts
          rows={[
            ["Address", `${detail.address}, ${detail.city}, ${detail.state} ${detail.zip}`],
            ["Type", detail.property_type],
            ["Price", detail.price === null ? null : formatMoney(detail.price, detail.currency)],
            ["Bedrooms", optionalCount(detail.beds, "")],
            ["Bathrooms", optionalCount(detail.baths, "")],
            ["Interior", optionalCount(detail.interior_sq_ft, " sq ft")],
            ["Built", detail.year_built === null ? null : String(detail.year_built)],
            ["Renovated", detail.year_renovated === null ? null : String(detail.year_renovated)],
            ["Architect", detail.architect],
            ["Designer", detail.designer],
            ["Package", detail.package],
            [
              "Media budget",
              detail.media_budget === null
                ? null
                : formatMoney(detail.media_budget, detail.currency),
            ],
          ]}
        />
      </Group>
      <Group title="People">
        <Facts
          rows={[
            ["Submitted by", submitterKindLabels[detail.submitter_kind]],
            ["Name", detail.submitter_name],
            ["Email", <a href={`mailto:${detail.submitter_email}`}>{detail.submitter_email}</a>],
            ["Phone", detail.submitter_phone],
            ["Brokerage", owner ? null : detail.brokerage],
            [
              "Listed with an agent",
              !owner || detail.listed_with_agent === null
                ? null
                : detail.listed_with_agent
                  ? "Yes"
                  : "No",
            ],
            ["Listing agent", owner ? detail.listing_agent_name : null],
            ["Listing agent brokerage", owner ? detail.listing_agent_brokerage : null],
          ]}
        />
        {detail.contact_id === null ? null : (
          <p>
            <a href={`/admin/people/${detail.contact_id}`}>Open person</a>
          </p>
        )}
        {detail.contact_id !== null || detail.property_id === null ? null : (
          <p>
            <a href={`/admin/properties/${detail.property_id}`}>Open property</a>
          </p>
        )}
      </Group>
      <Group title="Links">
        <Facts
          rows={[
            ["Listing", external(detail.listing_url)],
            ["Source", external(detail.source_url)],
            ["Photography", external(detail.photography_url)],
            ["Video", external(detail.video_url)],
          ]}
        />
      </Group>
      <Group title="Story">
        <p className="admin-prose">{detail.story}</p>
      </Group>
      <Group title="Significance">
        <p className="admin-prose">{detail.significance}</p>
      </Group>
    </>
  );
}
