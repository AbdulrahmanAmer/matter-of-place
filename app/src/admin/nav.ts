// The admin navigation, written once with every screen. An entry renders only when its `routeId` is in the router's
// route table and, when `requiresAction` is set, the actor's `me.actions` holds it.
// W3 (2026-10-12): the rail shows eight areas, one link each, named for the work rather than the tables; the screens
// of an area are its tabs across the top of the page (`areaTabs`), in the order they are written here.

export const navGroups = [
  "Today",
  "Inbox",
  "Listings",
  "Publishing",
  "Clients",
  "Automation",
  "Settings",
  "System",
] as const;

/** What the rail calls each area, where a longer name reads better than the key. */
export const areaLabels: Record<NavGroup, string> = {
  Today: "Today",
  Inbox: "Inbox",
  Listings: "Listings",
  Publishing: "Publishing",
  Clients: "Clients and money",
  Automation: "Automation",
  Settings: "Settings",
  System: "System",
};

type NavGroup = (typeof navGroups)[number];

export interface NavEntry {
  screen: number;
  path: string;
  routeId: string;
  group?: NavGroup;
  label: string;
  requiresAction?: string;
  hidden?: true;
  /** The screen whose link stays highlighted while this one is open. */
  parent?: number;
}

export const navEntries: readonly NavEntry[] = [
  { screen: 1, path: "/admin/sign-in", routeId: "/admin/sign-in", label: "Sign in", hidden: true },
  { screen: 2, path: "/admin", routeId: "/admin/", group: "Today", label: "Overview" },
  // W1 (2026-10-12): the AI employees' office and what they propose for a person to approve.
  {
    screen: 28,
    path: "/admin/office",
    routeId: "/admin/office",
    group: "Today",
    label: "Office",
    requiresAction: "workforce.office",
  },
  {
    screen: 29,
    path: "/admin/approvals",
    routeId: "/admin/approvals",
    group: "Inbox",
    label: "Approvals",
    requiresAction: "workforce.approvals",
  },
  {
    screen: 3,
    path: "/admin/requests",
    routeId: "/admin/requests/",
    group: "Inbox",
    label: "Requests",
  },
  {
    screen: 4,
    path: "/admin/requests/$id",
    routeId: "/admin/requests/$id",
    label: "Request",
    hidden: true,
    parent: 3,
  },
  {
    screen: 26,
    path: "/admin/people",
    routeId: "/admin/people/",
    group: "Clients",
    label: "People",
    requiresAction: "people.list",
  },
  {
    screen: 27,
    path: "/admin/people/$id",
    routeId: "/admin/people/$id",
    label: "Person",
    hidden: true,
    parent: 26,
  },
  {
    screen: 7,
    path: "/admin/properties",
    routeId: "/admin/properties/",
    group: "Listings",
    label: "Properties",
  },
  {
    screen: 8,
    path: "/admin/properties/$id",
    routeId: "/admin/properties/$id",
    label: "Property",
    hidden: true,
    parent: 7,
  },
  {
    screen: 9,
    path: "/admin/media",
    routeId: "/admin/media/",
    group: "Listings",
    label: "Photographs",
  },
  {
    screen: 10,
    path: "/admin/assets",
    routeId: "/admin/assets/",
    group: "Listings",
    label: "Visuals",
  },
  {
    screen: 11,
    path: "/admin/inquiries",
    routeId: "/admin/inquiries/",
    group: "Inbox",
    label: "Inquiries",
  },
  // Operator, 2026-10-15: who asked to hear about which market, and from which page.
  {
    screen: 31,
    path: "/admin/interest",
    routeId: "/admin/interest/",
    group: "Inbox",
    label: "Interest",
    requiresAction: "newsletter.subscribers_export",
  },
  {
    screen: 12,
    path: "/admin/channels",
    routeId: "/admin/channels/",
    group: "Publishing",
    label: "Social posts",
  },
  // W8 item 11 (2026-10-16): posts a colleague proposes, previewed per channel, before anything is filed to go out.
  {
    screen: 34,
    path: "/admin/proposed-posts",
    routeId: "/admin/proposed-posts/",
    group: "Publishing",
    label: "Proposed posts",
    requiresAction: "channels.proposed_list",
  },
  {
    screen: 13,
    path: "/admin/newsletter",
    routeId: "/admin/newsletter/",
    group: "Publishing",
    label: "Place Notes",
  },
  {
    screen: 5,
    path: "/admin/invoices",
    routeId: "/admin/invoices/",
    group: "Clients",
    label: "Invoices",
  },
  {
    screen: 6,
    path: "/admin/invoices/$id",
    routeId: "/admin/invoices/$id",
    label: "Invoice",
    hidden: true,
    parent: 5,
  },
  // Admin pass (2026-10-12): the new-invoice form keeps the Invoices tab lit and the area's tabs above it.
  {
    screen: 30,
    path: "/admin/invoices/new",
    routeId: "/admin/invoices/new",
    label: "New invoice",
    hidden: true,
    parent: 5,
  },
  // W7 item 3: what each paid property is running, read only, leading to its Reports.
  {
    screen: 33,
    path: "/admin/campaigns",
    routeId: "/admin/campaigns/",
    group: "Clients",
    label: "Campaigns",
    requiresAction: "reports.list",
  },
  {
    screen: 22,
    path: "/admin/reports",
    routeId: "/admin/reports/",
    group: "Clients",
    label: "Reports",
  },
  {
    screen: 14,
    path: "/admin/stories",
    routeId: "/admin/stories/",
    group: "Publishing",
    label: "Stories",
  },
  {
    screen: 15,
    path: "/admin/markets",
    routeId: "/admin/markets/",
    group: "Publishing",
    label: "Markets",
  },
  {
    screen: 17,
    path: "/admin/automation/recipes",
    routeId: "/admin/automation/recipes",
    group: "Automation",
    label: "Flows",
  },
  {
    screen: 18,
    path: "/admin/automation/emails",
    routeId: "/admin/automation/emails",
    group: "Automation",
    label: "Emails",
  },
  {
    screen: 19,
    path: "/admin/automation/reasons",
    routeId: "/admin/automation/reasons",
    group: "Automation",
    label: "Decline reasons",
  },
  {
    screen: 21,
    path: "/admin/automation/revisions",
    routeId: "/admin/automation/revisions",
    group: "Automation",
    label: "History",
  },
  {
    screen: 24,
    path: "/admin/settings",
    routeId: "/admin/settings/",
    group: "Settings",
    label: "Business",
    requiresAction: "settings.get",
  },
  {
    screen: 20,
    path: "/admin/automation/settings",
    routeId: "/admin/automation/settings",
    group: "Settings",
    label: "Channels and schedules",
  },
  {
    screen: 23,
    path: "/admin/team",
    routeId: "/admin/team/",
    group: "Settings",
    label: "Team and access",
    requiresAction: "team.users_list",
  },
  { screen: 16, path: "/admin/jobs", routeId: "/admin/jobs/", group: "System", label: "Jobs" },
  // W9 item 2 and W7 item 1: every email we sent and what became of it.
  {
    screen: 32,
    path: "/admin/emails",
    routeId: "/admin/emails/",
    group: "System",
    label: "Sent emails",
    requiresAction: "audit.list",
  },
  {
    screen: 25,
    path: "/admin/audit",
    routeId: "/admin/audit/",
    group: "System",
    label: "Activity log",
    requiresAction: "audit.list",
  },
];

export interface NavVisibility {
  /** True when the router has a route with this id. */
  hasRoute: (routeId: string) => boolean;
  /** The registered action ids the actor may perform (`me.actions`). */
  actions: readonly string[];
}

export interface NavSection {
  group: NavGroup;
  entries: readonly NavEntry[];
}

/** The links to draw: groups in order, an entry whose route is absent or whose action is missing left out. */
export function visibleNav({ hasRoute, actions }: NavVisibility): NavSection[] {
  return navGroups
    .map((group) => ({
      group,
      entries: navEntries.filter(
        (entry) =>
          entry.group === group &&
          entry.hidden !== true &&
          hasRoute(entry.routeId) &&
          (entry.requiresAction === undefined || actions.includes(entry.requiresAction)),
      ),
    }))
    .filter((section) => section.entries.length > 0);
}

/** The area of a screen: its own group, or its parent's when it is a detail screen. */
export function areaOf(screen: number | null): NavGroup | null {
  const entry = navEntries.find((candidate) => candidate.screen === screen);
  if (entry === undefined) return null;
  if (entry.group !== undefined) return entry.group;
  return navEntries.find((candidate) => candidate.screen === entry.parent)?.group ?? null;
}

/** The tabs of the open screen's area, from the visible links; none when the area has a single screen. */
export function areaTabs(
  sections: readonly NavSection[],
  screen: number | null,
): readonly NavEntry[] {
  const area = areaOf(screen);
  const entries = sections.find((section) => section.group === area)?.entries ?? [];
  return entries.length > 1 ? entries : [];
}

/**
 * The screen whose link is highlighted for the open page: the entry of the leaf route, or that entry's parent when
 * it renders no link of its own. Entries never nest, so only the leaf can have one. `routeIds` runs from the root
 * to the leaf.
 */
export function activeScreen(routeIds: readonly string[]): number | null {
  const entry = navEntries.find((candidate) => candidate.routeId === routeIds.at(-1));
  return entry === undefined ? null : (entry.parent ?? entry.screen);
}
