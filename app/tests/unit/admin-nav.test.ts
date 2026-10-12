import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeScreen,
  areaOf,
  areaTabs,
  navEntries,
  navGroups,
  visibleNav,
} from "../../src/admin/nav";
import { matrix, type AppRole } from "../../src/server/lib/authz";

// The 27 routeIds of B7 step 3, one per screen of admin-screens; an `.index.tsx` file gives a trailing slash.
const ROUTE_IDS: Record<number, string> = {
  1: "/admin/sign-in",
  2: "/admin/",
  3: "/admin/requests/",
  4: "/admin/requests/$id",
  5: "/admin/invoices/",
  6: "/admin/invoices/$id",
  7: "/admin/properties/",
  8: "/admin/properties/$id",
  9: "/admin/media/",
  10: "/admin/assets/",
  11: "/admin/inquiries/",
  12: "/admin/channels/",
  13: "/admin/newsletter/",
  14: "/admin/stories/",
  15: "/admin/markets/",
  16: "/admin/jobs/",
  17: "/admin/automation/recipes",
  18: "/admin/automation/emails",
  19: "/admin/automation/reasons",
  20: "/admin/automation/settings",
  21: "/admin/automation/revisions",
  22: "/admin/reports/",
  23: "/admin/team/",
  24: "/admin/settings/",
  25: "/admin/audit/",
  26: "/admin/people/",
  27: "/admin/people/$id",
  // W1 (2026-10-12): the office of the AI employees and their approvals.
  28: "/admin/office",
  29: "/admin/approvals",
  30: "/admin/invoices/new",
};

const everyRoute = () => true;
const everyAction = () => matrix.map((entry) => entry.action);
const actionsOf = (role: AppRole) =>
  matrix.filter((entry) => entry.roles.includes(role)).map((entry) => entry.action);
const screensShown = (sections: ReturnType<typeof visibleNav>) =>
  sections.flatMap((section) => section.entries.map((entry) => entry.screen));

describe("the nav registry", () => {
  it("holds 30 entries, one per screen, with the routeId list of the plan, W1 and the new-invoice form", () => {
    expect(navEntries).toHaveLength(30);
    expect(Object.fromEntries(navEntries.map((entry) => [entry.screen, entry.routeId]))).toEqual(
      ROUTE_IDS,
    );
  });

  it("shows 24 screens in eight areas when every route and action exists (W3)", () => {
    const sections = visibleNav({ hasRoute: everyRoute, actions: everyAction() });
    expect(sections.map((section) => section.group)).toEqual([...navGroups]);
    expect(sections.map((section) => section.entries.length)).toEqual([2, 3, 3, 4, 3, 4, 3, 2]);
    expect(screensShown(sections)).toHaveLength(24);
  });

  it("names each area's screens for the work: Inbox, Listings, Automation and Settings", () => {
    const sections = visibleNav({ hasRoute: everyRoute, actions: everyAction() });
    const labels = (group: string) =>
      sections.find((section) => section.group === group)?.entries.map((entry) => entry.label);
    expect({
      inbox: labels("Inbox"),
      listings: labels("Listings"),
      automation: labels("Automation"),
      settings: labels("Settings"),
    }).toEqual({
      inbox: ["Approvals", "Requests", "Inquiries"],
      listings: ["Properties", "Photographs", "Visuals"],
      automation: ["Flows", "Emails", "Decline reasons", "History"],
      settings: ["Business", "Channels and schedules", "Team and access"],
    });
  });

  it("gives a screen its area's tabs, a detail screen its parent's, and a lone screen none", () => {
    const sections = visibleNav({ hasRoute: everyRoute, actions: everyAction() });
    const tabsOf = (screen: number) => areaTabs(sections, screen).map((entry) => entry.screen);
    expect({
      requests: tabsOf(3),
      request: tabsOf(4),
      areaOfRequest: areaOf(4),
      signIn: tabsOf(1),
    }).toEqual({ requests: [29, 3, 11], request: [29, 3, 11], areaOfRequest: "Inbox", signIn: [] });
    // An editor without the settings and team actions sees one Settings tab, so no tab strip.
    const editor = visibleNav({ hasRoute: everyRoute, actions: actionsOf("managing_editor") });
    expect(areaTabs(editor, 20)).toEqual([]);
  });

  it("renders no link for screens 1, 4, 6, 8, 27 and 30, and gives five of them a parent", () => {
    const shown = screensShown(visibleNav({ hasRoute: everyRoute, actions: everyAction() }));
    const hidden = navEntries.filter((entry) => entry.hidden === true);
    expect(hidden.map((entry) => entry.screen).sort((a, b) => a - b)).toEqual([1, 4, 6, 8, 27, 30]);
    expect(hidden.some((entry) => shown.includes(entry.screen))).toBe(false);
    expect(Object.fromEntries(hidden.map((entry) => [entry.screen, entry.parent]))).toEqual({
      1: undefined,
      4: 3,
      6: 5,
      8: 7,
      27: 26,
      30: 5,
    });
  });

  it("hides an entry whose route does not exist", () => {
    const sections = visibleNav({
      hasRoute: (routeId) => routeId !== "/admin/team/",
      actions: everyAction(),
    });
    expect(screensShown(sections)).not.toContain(23);
    expect(screensShown(sections)).toHaveLength(23);
  });

  it("hides the team screen from a commercial actor", () => {
    const shown = screensShown(
      visibleNav({ hasRoute: everyRoute, actions: actionsOf("commercial") }),
    );
    expect(shown).not.toContain(23);
    expect(shown).not.toContain(24);
    expect(shown).toContain(26);
  });

  it("hides the audit log from a managing editor who holds audit.usage but not audit.list", () => {
    const actions = [...actionsOf("managing_editor"), "audit.usage"];
    expect(actions).not.toContain("audit.list");
    expect(screensShown(visibleNav({ hasRoute: everyRoute, actions }))).not.toContain(25);
  });
});

/** The route ids the admin route files give: `invoices.index.tsx` is `/admin/invoices/`, `invoices.$id.lazy.tsx` `/admin/invoices/$id`. */
function adminRouteIds(): Set<string> {
  const folder = join(import.meta.dirname, "..", "..", "src", "routes", "admin");
  return new Set(
    readdirSync(folder)
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => name.replace(/(.lazy)?.tsx$/, "").split("."))
      .map((parts) =>
        parts.at(-1) === "index"
          ? `/admin/${parts.slice(0, -1).join("/")}/`
          : `/admin/${parts.join("/")}`,
      ),
  );
}

describe("the screens whose route files exist", () => {
  it("renders the Invoices link now that invoices.index.tsx exists, and no link for the invoice screen", () => {
    const routes = adminRouteIds();
    const shown = screensShown(
      visibleNav({ hasRoute: (routeId) => routes.has(routeId), actions: everyAction() }),
    );
    expect({
      files: [...routes].filter((routeId) => routeId.startsWith("/admin/invoices")).sort(),
      invoices: shown.includes(5),
      invoice: shown.includes(6),
    }).toEqual({
      files: ["/admin/invoices/", "/admin/invoices/$id", "/admin/invoices/new"],
      invoices: true,
      invoice: false,
    });
  });
});

describe("the open screen", () => {
  it("marks the screen of the leaf route", () => {
    expect(activeScreen(["__root__", "/admin", "/admin/"])).toBe(2);
    expect(activeScreen(["__root__", "/admin", "/admin/jobs/"])).toBe(16);
  });

  it("marks the parent's link while a detail screen is open", () => {
    expect(activeScreen(["__root__", "/admin", "/admin/people/$id"])).toBe(26);
    expect(activeScreen(["__root__", "/admin", "/admin/requests/$id"])).toBe(3);
    expect(activeScreen(["__root__", "/admin", "/admin/invoices/$id"])).toBe(5);
    expect(activeScreen(["__root__", "/admin", "/admin/properties/$id"])).toBe(7);
  });

  it("marks nothing for a route that is not a screen", () => {
    expect(activeScreen(["__root__", "/admin", "/admin/auth/confirm"])).toBeNull();
  });
});
