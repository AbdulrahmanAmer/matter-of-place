import { expect, test } from "@playwright/test";
import { getDynamicRoutes, notFoundRoute, staticRoutes } from "./fixtures/routes";

// H1-05: the policy breaks nothing. Every page route is opened with a listener for `securitypolicyviolation`, which a
// browser fires under a report-only policy as under an enforcing one, so the run is the same before and after the flip.
const pageRoutes = [
  ...staticRoutes,
  ...(await getDynamicRoutes()),
  notFoundRoute,
  { path: "/admin/sign-in", routeClass: "page" },
];

interface Violation {
  directive: string;
  blocked: string;
  sample: string;
}

for (const route of pageRoutes) {
  test(`csp ${route.path}`, async ({ page }) => {
    await page.addInitScript(() => {
      const seen: Violation[] = [];
      Reflect.set(window, "__cspViolations", seen);
      document.addEventListener("securitypolicyviolation", (event) => {
        seen.push({
          directive: event.violatedDirective,
          blocked: event.blockedURI,
          sample: event.sample,
        });
      });
    });
    const response = await page.goto(route.path, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(route.routeClass === "notFound" ? 404 : 200);
    const policy =
      response?.headers()["content-security-policy"] ??
      response?.headers()["content-security-policy-report-only"];
    expect(policy, "the page carries a policy").toContain("'sha256-");
    const violations = await page.evaluate((): unknown => Reflect.get(window, "__cspViolations"));
    expect(violations).toEqual([]);
  });
}
