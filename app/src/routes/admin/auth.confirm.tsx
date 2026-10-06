import { createFileRoute } from "@tanstack/react-router";
import { ConfirmForm } from "../../admin/team/ConfirmForm";
import { pageHead } from "../../lib/seo";

interface ConfirmSearch {
  token_hash: string;
  type: "email" | "invite";
  next?: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

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
  component: ConfirmPage,
});

function ConfirmPage() {
  const search = Route.useSearch();
  return (
    <main className="admin-auth">
      {search.token_hash === "" ? (
        <p>This sign-in link is incomplete. Please ask for a new one.</p>
      ) : (
        <ConfirmForm tokenHash={search.token_hash} type={search.type} next={search.next} />
      )}
    </main>
  );
}
