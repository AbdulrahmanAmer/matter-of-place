// The admin navigation, written once with all 27 screens (admin-screens). A screen of a later slice shows the
// moment its route file exists, so no later slice edits this file: an entry renders only when its `routeId`
// is in the router's route table and, when `requiresAction` is set, the actor's `me.actions` holds it.

export const navGroups = [
  "Work",
  "Distribution",
  "Money",
  "Editorial",
  "Automation",
  "System",
] as const;

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
  { screen: 2, path: "/admin", routeId: "/admin/", group: "Work", label: "Dashboard" },
  {
    screen: 3,
    path: "/admin/requests",
    routeId: "/admin/requests/",
    group: "Work",
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
    group: "Work",
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
    group: "Work",
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
  { screen: 9, path: "/admin/media", routeId: "/admin/media/", group: "Work", label: "Media" },
  { screen: 10, path: "/admin/assets", routeId: "/admin/assets/", group: "Work", label: "Assets" },
  {
    screen: 11,
    path: "/admin/inquiries",
    routeId: "/admin/inquiries/",
    group: "Work",
    label: "Inquiries",
  },
  {
    screen: 12,
    path: "/admin/channels",
    routeId: "/admin/channels/",
    group: "Distribution",
    label: "Channels",
  },
  {
    screen: 13,
    path: "/admin/newsletter",
    routeId: "/admin/newsletter/",
    group: "Distribution",
    label: "Newsletter",
  },
  {
    screen: 5,
    path: "/admin/invoices",
    routeId: "/admin/invoices/",
    group: "Money",
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
  {
    screen: 22,
    path: "/admin/reports",
    routeId: "/admin/reports/",
    group: "Money",
    label: "Reports",
  },
  {
    screen: 14,
    path: "/admin/stories",
    routeId: "/admin/stories/",
    group: "Editorial",
    label: "Stories",
  },
  {
    screen: 15,
    path: "/admin/markets",
    routeId: "/admin/markets/",
    group: "Editorial",
    label: "Markets",
  },
  {
    screen: 17,
    path: "/admin/automation/recipes",
    routeId: "/admin/automation/recipes",
    group: "Automation",
    label: "Recipes",
  },
  {
    screen: 18,
    path: "/admin/automation/emails",
    routeId: "/admin/automation/emails",
    group: "Automation",
    label: "Email templates",
  },
  {
    screen: 19,
    path: "/admin/automation/reasons",
    routeId: "/admin/automation/reasons",
    group: "Automation",
    label: "Decline reasons",
  },
  {
    screen: 20,
    path: "/admin/automation/settings",
    routeId: "/admin/automation/settings",
    group: "Automation",
    label: "Channels & schedules",
  },
  {
    screen: 21,
    path: "/admin/automation/revisions",
    routeId: "/admin/automation/revisions",
    group: "Automation",
    label: "Revisions",
  },
  { screen: 16, path: "/admin/jobs", routeId: "/admin/jobs/", group: "System", label: "Jobs" },
  {
    screen: 23,
    path: "/admin/team",
    routeId: "/admin/team/",
    group: "System",
    label: "Team",
    requiresAction: "team.users_list",
  },
  {
    screen: 24,
    path: "/admin/settings",
    routeId: "/admin/settings/",
    group: "System",
    label: "Settings",
    requiresAction: "settings.get",
  },
  {
    screen: 25,
    path: "/admin/audit",
    routeId: "/admin/audit/",
    group: "System",
    label: "Audit log",
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

/**
 * The screen whose link is highlighted for the open page: the entry of the leaf route, or that entry's parent when
 * it renders no link of its own. Entries never nest, so only the leaf can have one. `routeIds` runs from the root
 * to the leaf.
 */
export function activeScreen(routeIds: readonly string[]): number | null {
  const entry = navEntries.find((candidate) => candidate.routeId === routeIds.at(-1));
  return entry === undefined ? null : (entry.parent ?? entry.screen);
}
