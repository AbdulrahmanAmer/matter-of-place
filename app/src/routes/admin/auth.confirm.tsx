import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

interface ConfirmSearch {
  token_hash: string;
  type: "email" | "invite";
  next?: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

// A shell (ruling H66): the page is imported by the lazy component.
export const Route = createFileRoute("/admin/auth/confirm")({
  validateSearch: (search: Record<string, unknown>): ConfirmSearch => {
    const next = text(search["next"]);
    return {
      token_hash: text(search["token_hash"]),
      type: search["type"] === "invite" ? "invite" : "email",
      ...(next === "" ? {} : { next }),
    };
  },
  head: () =>
    pageHead({
      title: "Sign in",
      description: "Finish signing in to Matter of Place.",
      path: "/admin/auth/confirm",
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/team/ConfirmPage"), "ConfirmPage"),
});
