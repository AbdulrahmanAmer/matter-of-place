import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `channels.index.lazy.tsx`, which the public entry never loads. The search
// keeps the filters of the posts table, its page and `post`, the id of a `social_posts` row a failure mail links to;
// a `post` that is not a uuid is dropped.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export const Route = createFileRoute("/admin/channels/")({
  validateSearch: (search: Record<string, unknown>) => {
    const post = text(search["post"]);
    return {
      channel: text(search["channel"]),
      status: text(search["status"]),
      cursor: text(search["cursor"]),
      post: post !== undefined && UUID.test(post) ? post : undefined,
    };
  },
  head: () =>
    pageHead({
      title: "Channels",
      description: "Where each approved asset has been posted, and how each channel is doing.",
      path: "/admin/channels",
      noindex: true,
    }),
});
