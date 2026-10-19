import { createFileRoute, notFound } from "@tanstack/react-router";
import { PlaceNotesThanks, type ThanksStatus } from "../components/site/place-notes-thanks";
import { pageHead } from "../lib/seo";

const statuses: readonly ThanksStatus[] = ["confirmed", "expired"];

/** The status in the address, or a 404 for any other word. */
function statusOf(value: string): ThanksStatus {
  const found = statuses.find((status) => status === value);
  if (found === undefined) throw notFound();
  return found;
}

// `GET /subscribers/confirm` answers 303 here: one server-rendered page per status, so the cached HTML never depends on
// a query string (architecture 13, rule 3), and kept out of search.
export const Route = createFileRoute("/_site/place-notes_/$status")({
  beforeLoad: ({ params }) => {
    statusOf(params.status);
  },
  head: ({ params }) =>
    pageHead({
      title: params.status === "confirmed" ? "Thank you" : "Link expired",
      description: "Place Notes from Matter of Place.",
      path: `/place-notes/${params.status}`,
      noindex: true,
    }),
  component: PlaceNotesThanksPage,
});

function PlaceNotesThanksPage() {
  const { status } = Route.useParams();
  return <PlaceNotesThanks status={statusOf(status)} />;
}
