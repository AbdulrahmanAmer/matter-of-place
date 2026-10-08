import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `jobs.index.lazy.tsx`, which the public entry never loads. The search keeps
// the filters of the table, its cursor and `job`, the open job; an `entity` or a `job` that is not a uuid is dropped.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const uuid = (value: unknown): string | undefined => {
  const found = text(value);
  return found !== undefined && UUID.test(found) ? found : undefined;
};

export const Route = createFileRoute("/admin/jobs/")({
  validateSearch: (search: Record<string, unknown>) => ({
    status: text(search["status"]),
    type: text(search["type"]),
    entity: uuid(search["entity"]),
    q: text(search["q"]),
    cursor: text(search["cursor"]),
    job: uuid(search["job"]),
  }),
  head: () =>
    pageHead({
      title: "Jobs",
      description: "Every job the platform has run, and the ones that ran out of attempts.",
      path: "/admin/jobs",
      noindex: true,
    }),
});
