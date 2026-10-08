import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

interface SignInSearch {
  next?: string;
  state?: "disabled" | "expired";
}

// A shell (ruling H66): the page is imported by the lazy component.
export const Route = createFileRoute("/admin/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => {
    const { next, state } = search;
    return {
      ...(typeof next === "string" && next !== "" ? { next } : {}),
      ...(state === "disabled" || state === "expired" ? { state } : {}),
    };
  },
  head: () =>
    pageHead({
      title: "Sign in",
      description: "Sign in to the Matter of Place admin.",
      path: "/admin/sign-in",
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/team/SignInPage"), "SignInPage"),
});
