import type { ReactNode } from "react";

// The admin's own line icons (operator, 2026-10-12: "custom SVGs, every screen purposeful"): one drawing per screen,
// on a 20-unit grid with a 1.25 stroke in the current colour, so the navigation reads at a glance and every icon
// belongs to the same hand. The arch of the brand emblem recurs where a screen is about a place.

const drawings: Record<string, ReactNode> = {
  // A floor plan: the overview of everything.
  "/admin": (
    <>
      <rect x="3" y="3" width="14" height="14" />
      <path d="M3 10h8M11 3v14M11 13h6" />
    </>
  ),
  // Three figures around a table: the team at work.
  "/admin/office": (
    <>
      <circle cx="10" cy="6" r="2.25" />
      <circle cx="4.5" cy="8" r="1.75" />
      <circle cx="15.5" cy="8" r="1.75" />
      <path d="M2.5 16h15M6 13.5c.6-1.9 2.2-3 4-3s3.4 1.1 4 3" />
    </>
  ),
  // A seal with a tick: what waits for a yes.
  "/admin/approvals": (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m6.75 10.25 2.25 2.25 4.25-4.75" />
    </>
  ),
  // An in-tray: requests that arrived.
  "/admin/requests": (
    <>
      <path d="M3 11.5 5 4h10l2 7.5V16H3z" />
      <path d="M3 11.5h4l1 2h4l1-2h4" />
    </>
  ),
  // One figure: a person.
  "/admin/people": (
    <>
      <circle cx="10" cy="6.5" r="3" />
      <path d="M4 17c.8-3.2 3.1-5 6-5s5.2 1.8 6 5" />
    </>
  ),
  // The emblem's arch: a property.
  "/admin/properties": (
    <>
      <path d="M4 17V6.5L10 3l6 3.5V17" />
      <path d="M8 17v-5.5a2 2 0 0 1 4 0V17M2.5 17h15" />
    </>
  ),
  // A framed photograph with a horizon.
  "/admin/media": (
    <>
      <rect x="2.5" y="4" width="15" height="12" />
      <path d="m2.5 13.5 4.5-4 3.5 3 2.5-2 4.5 3.5" />
      <circle cx="13.5" cy="7.5" r="1.25" />
    </>
  ),
  // Sheets laid on one another: made assets.
  "/admin/assets": (
    <>
      <path d="m10 3 7.5 4L10 11 2.5 7z" />
      <path d="m2.5 10.5 7.5 4 7.5-4M2.5 14l7.5 4 7.5-4" />
    </>
  ),
  // A speech mark: someone asked.
  "/admin/inquiries": (
    <>
      <path d="M3 4h14v9.5H9l-4 3v-3H3z" />
      <path d="M6.5 8h7M6.5 10.5h4.5" />
    </>
  ),
  // A mast with waves: the social channels.
  "/admin/channels": (
    <>
      <circle cx="10" cy="9" r="1.5" />
      <path d="M10 10.5V17M6.5 5.5a5 5 0 0 0 0 7M13.5 5.5a5 5 0 0 1 0 7M4 3a8.5 8.5 0 0 0 0 12M16 3a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  // An open letter: Place Notes.
  "/admin/newsletter": (
    <>
      <path d="M2.5 8 10 3l7.5 5v9h-15z" />
      <path d="m2.5 8 7.5 5 7.5-5" />
    </>
  ),
  // A slip with a torn foot: invoices.
  "/admin/invoices": (
    <>
      <path d="M4.5 2.5h11v15l-2-1.25-1.75 1.25L10 16.25 8.25 17.5 6.5 16.25l-2 1.25z" />
      <path d="M7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" />
    </>
  ),
  // Columns on a base line: reports.
  "/admin/reports": (
    <>
      <path d="M2.5 17h15" />
      <path d="M5 17v-5M9 17V7M13 17v-8M17 17V4" />
    </>
  ),
  // An open book: stories.
  "/admin/stories": (
    <>
      <path d="M10 5.5C8.5 4 6 3.5 2.5 4v11.5c3.5-.5 6 0 7.5 1.5 1.5-1.5 4-2 7.5-1.5V4c-3.5-.5-6 0-7.5 1.5z" />
      <path d="M10 5.5V17" />
    </>
  ),
  // A pin over a place: markets.
  "/admin/markets": (
    <>
      <path d="M10 17.5s-5-4.6-5-9a5 5 0 0 1 10 0c0 4.4-5 9-5 9z" />
      <circle cx="10" cy="8.5" r="1.75" />
    </>
  ),
  // Nodes joined by lines: a recipe of steps.
  "/admin/automation/recipes": (
    <>
      <rect x="2.5" y="3" width="5" height="4" />
      <rect x="12.5" y="8" width="5" height="4" />
      <rect x="2.5" y="13" width="5" height="4" />
      <path d="M7.5 5h2.5v10H7.5M10 10h2.5" />
    </>
  ),
  // An envelope with its lines drafted: email templates.
  "/admin/automation/emails": (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" />
      <path d="m2.5 5 7.5 6 7.5-6" />
    </>
  ),
  // A circle struck through: why a request is declined.
  "/admin/automation/reasons": (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m5 15 10-10" />
    </>
  ),
  // A calendar page: channels and their schedules.
  "/admin/automation/settings": (
    <>
      <rect x="3" y="4.5" width="14" height="12.5" />
      <path d="M3 8.5h14M7 2.5v4M13 2.5v4M6.5 11.5h2M11.5 11.5h2M6.5 14h2" />
    </>
  ),
  // A clock turning back: revisions.
  "/admin/automation/revisions": (
    <>
      <path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" />
      <path d="M3 3v3.5h3.5M10 6.5V10l2.5 2" />
    </>
  ),
  // Rows in a queue: background jobs.
  "/admin/jobs": (
    <>
      <path d="M8 5h9.5M8 10h9.5M8 15h9.5" />
      <path d="m2.5 3.5 2.5 1.5-2.5 1.5zM2.5 8.5 5 10l-2.5 1.5zM2.5 13.5 5 15l-2.5 1.5z" />
    </>
  ),
  // A key: who may sign in, and with which role.
  "/admin/team": (
    <>
      <circle cx="6.5" cy="10" r="3.5" />
      <path d="M10 10h7.5M14.5 10v3M17 10v2" />
    </>
  ),
  // Three sliders: settings.
  "/admin/settings": (
    <>
      <path d="M3 5h14M3 10h14M3 15h14" />
      <circle cx="7" cy="5" r="1.5" />
      <circle cx="13" cy="10" r="1.5" />
      <circle cx="8.5" cy="15" r="1.5" />
    </>
  ),
  // A ledger with a margin: the audit log.
  "/admin/audit": (
    <>
      <rect x="3.5" y="2.5" width="13" height="15" />
      <path d="M6.5 2.5v15M9 6.5h5M9 9.5h5M9 12.5h3.5" />
    </>
  ),
};

/** The icon of a navigation entry, drawn beside its label; decorative, so assistive technology skips it. */
export function NavIcon({ path }: { path: string }) {
  const drawing = drawings[path];
  if (drawing === undefined) return null;
  return (
    <svg
      className="admin-icon"
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {drawing}
    </svg>
  );
}
