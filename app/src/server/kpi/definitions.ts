import { z } from "zod";
import { formatUsd } from "../email/format.ts";

// The weekly numbers of B11 invariant 12 (GG-03): what each one counts, in words, and how it reads in the CEO's email.
// SQL `kpi_weekly` counts them; this file is the one place that names and explains them, for the email and for
// B14's audit report. No model writes any of it (S20).

/** The owner's zone (ASSUMED): a week runs Monday to Sunday on New York's calendar. */
const KPI_ZONE = "America/New_York";

const count = z.number().int().nonnegative();

/** What `kpi_weekly(p_week_start)` returns for one week. */
export const kpiWeekSchema = z.object({
  week_start: z.string(),
  week_end: z.string(),
  submissions_received: count,
  decisions: z.object({ accepted: count, declined: count }),
  time_to_decision_hours: z.number().nullable(),
  invoices: z.object({
    issued: count,
    issued_amount: z.number(),
    paid: count,
    paid_amount: z.number(),
  }),
  properties_published: count,
  posts_by_channel: z.record(count),
  newsletter: z.object({
    confirmed: count,
    unsubscribed: count,
    net: z.number().int(),
    total_confirmed: count,
  }),
  inquiries: z.object({
    received: count,
    published_properties: count,
    top: z.array(z.object({ slug: z.string(), title: z.string(), count })),
  }),
});

export type KpiWeek = z.infer<typeof kpiWeekSchema>;

export interface KpiDefinition {
  key: string;
  label: string;
  definition: string;
  unit: string;
  value: (week: KpiWeek) => string;
  change: (current: KpiWeek, previous: KpiWeek) => string;
}

/** One line of the email: the label, this week's value and its change against the week before. */
export interface KpiLine {
  key: string;
  label: string;
  value: string;
  change: string;
}

const plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

/** A difference as `+3`, `-2.5` or `no change`, with an optional unit after the number. */
function delta(difference: number, unit = ""): string {
  if (difference === 0) return "no change";
  return `${signed.format(difference)}${unit}`;
}

const prior = (text: string): string => `prior week ${text}`;

const decided = (week: KpiWeek): number => week.decisions.accepted + week.decisions.declined;

const hours = (value: number): string => `${plain.format(value)} hours`;

const postTotal = (week: KpiWeek): number =>
  Object.values(week.posts_by_channel).reduce((sum, value) => sum + value, 0);

/** Inquiries per published property, or null when nothing is published. */
const perProperty = (week: KpiWeek): number | null =>
  week.inquiries.published_properties === 0
    ? null
    : week.inquiries.received / week.inquiries.published_properties;

export const NO_PUBLISHED_PROPERTIES = "No published properties yet";

function timeToDecisionChange(current: KpiWeek, previous: KpiWeek): string {
  const now = current.time_to_decision_hours;
  const before = previous.time_to_decision_hours;
  if (now === null || before === null) return prior(before === null ? "none" : hours(before));
  return delta(now - before, " hours");
}

function perPropertyValue(week: KpiWeek): string {
  const ratio = perProperty(week);
  if (ratio === null) return NO_PUBLISHED_PROPERTIES;
  const { received, published_properties: published } = week.inquiries;
  return `${plain.format(ratio)} (${String(received)} inquiries, ${String(published)} properties)`;
}

function perPropertyChange(current: KpiWeek, previous: KpiWeek): string {
  const now = perProperty(current);
  const before = perProperty(previous);
  if (now === null || before === null)
    return prior(before === null ? "none" : plain.format(before));
  return delta(now - before);
}

export const kpiDefinitions: readonly KpiDefinition[] = [
  {
    key: "submissions_received",
    label: "Submissions received",
    definition: "Requests received in the week, by submissions.received_at.",
    unit: "requests",
    value: (week) => String(week.submissions_received),
    change: (current, previous) =>
      delta(current.submissions_received - previous.submissions_received),
  },
  {
    key: "acceptance_rate",
    label: "Acceptance rate",
    definition:
      "Accept decisions out of all accept and decline decisions made in the week: the submission.accepted and submission.declined events, dated by events.at.",
    unit: "decisions",
    value: (week) => `${String(week.decisions.accepted)} of ${String(decided(week))}`,
    change: (_current, previous) =>
      prior(`${String(previous.decisions.accepted)} of ${String(decided(previous))}`),
  },
  {
    key: "time_to_decision",
    label: "Time to decision",
    definition:
      "Median hours from a request's received_at to its first accept or decline, for the requests first decided in the week.",
    unit: "hours",
    value: (week) =>
      week.time_to_decision_hours === null ? "none" : hours(week.time_to_decision_hours),
    change: timeToDecisionChange,
  },
  {
    key: "invoices",
    label: "Invoices",
    definition:
      "Invoices issued and invoices paid in the week, by payments.issued_at and paid_at, with their amounts; void invoices are left out.",
    unit: "invoices and US dollars",
    value: ({ invoices }) =>
      `${String(invoices.issued)} issued (${formatUsd(invoices.issued_amount)}), ${String(invoices.paid)} paid (${formatUsd(invoices.paid_amount)})`,
    change: ({ invoices: now }, { invoices: before }) =>
      `issued ${delta(now.issued - before.issued)}, paid ${delta(now.paid - before.paid)}`,
  },
  {
    key: "properties_published",
    label: "Properties published",
    definition: "Properties whose published_at falls in the week.",
    unit: "properties",
    value: (week) => String(week.properties_published),
    change: (current, previous) =>
      delta(current.properties_published - previous.properties_published),
  },
  {
    key: "posts_by_channel",
    label: "Posts by channel",
    definition: "Social posts made in the week, by social_posts.posted_at, per channel.",
    unit: "posts",
    value: (week) => {
      const channels = Object.entries(week.posts_by_channel).sort(([a], [b]) => a.localeCompare(b));
      if (channels.length === 0) return "none";
      return channels.map(([channel, posts]) => `${channel} ${String(posts)}`).join(", ");
    },
    change: (current, previous) => delta(postTotal(current) - postTotal(previous), " posts"),
  },
  {
    key: "newsletter_growth",
    label: "Newsletter growth",
    definition:
      "Subscribers confirmed and unsubscribed in the week, the net of the two, and everyone confirmed at the end of the week.",
    unit: "subscribers",
    value: ({ newsletter }) =>
      `${String(newsletter.confirmed)} confirmed, ${String(newsletter.unsubscribed)} unsubscribed, net ${signed.format(newsletter.net)}, ${String(newsletter.total_confirmed)} in total`,
    change: (current, previous) =>
      delta(current.newsletter.total_confirmed - previous.newsletter.total_confirmed, " in total"),
  },
  {
    key: "inquiries_per_property",
    label: "Inquiries per published property",
    definition:
      "Inquiries received in the week, by inquiries.received_at, divided by the properties published at the end of the week; the five properties asked about most follow, by inquiries.subject_slug.",
    unit: "inquiries per property",
    value: perPropertyValue,
    change: perPropertyChange,
  },
];

/** Every KPI of `current`, with its change against `previous`, in the order of the email. */
export function kpiLines(current: KpiWeek, previous: KpiWeek): KpiLine[] {
  return kpiDefinitions.map(({ key, label, value, change }) => ({
    key,
    label,
    value: value(current),
    change: change(current, previous),
  }));
}

const zoneDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: KPI_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `date` (`YYYY-MM-DD`) moved by whole days. */
export function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** The Monday of the last full week before `now`, on New York's calendar. */
export function lastFullWeekStart(now: Date): string {
  const today = zoneDate.format(now);
  const sinceMonday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(today, -sinceMonday - 7);
}
