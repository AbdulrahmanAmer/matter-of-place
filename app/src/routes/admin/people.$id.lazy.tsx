import { createLazyFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { PersonDetail } from "../../admin/people/PersonDetail";
import { PersonNotes } from "../../admin/people/PersonNotes";
import { usePerson, useSaveNotes } from "../../admin/people/people-queries";
import { AdminApiError } from "../../admin/ui/admin-fetch";
import { useAdminMe } from "../../admin/ui/admin-me";
import { AdminPending } from "../../admin/ui/AdminPending";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";
import { EmptyState } from "../../admin/ui/EmptyState";

// The page of the `people.$id.tsx` shell (ruling H66). The route has no loader: the page reads its own person, and a
// person who is not there throws `notFound`.
export const Route = createLazyFileRoute("/admin/people/$id")({
  errorComponent: AdminRouteError,
  notFoundComponent: () => (
    <EmptyState title="Person not found">
      This person does not exist, or the link is no longer valid.
    </EmptyState>
  ),
  component: PersonPage,
});

function PersonPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { actions } = useAdminMe();
  const person = usePerson(id);
  const save = useSaveNotes(id);
  const detail = person.data;
  if (detail === undefined) {
    if (person.error === null) return <AdminPending />;
    if (person.error instanceof AdminApiError && person.error.status === 404) throw notFound();
    throw person.error;
  }
  return (
    <PersonDetail
      person={detail}
      hasRoute={(routeId) => routeId in router.routesById}
      notes={
        <PersonNotes
          key={detail.contact.id}
          notes={detail.contact.notes}
          updatedAt={detail.contact.updated_at}
          canEdit={actions.includes("people.note")}
          onSave={(notes, expectedUpdatedAt) =>
            save.mutateAsync({ notes, expectedUpdatedAt }).then((answer) => answer.updated_at)
          }
          onReload={() =>
            person.refetch({ throwOnError: true }).then(({ data }) => {
              if (data === undefined) throw new Error("The notes could not be reloaded.");
              return { notes: data.contact.notes, updatedAt: data.contact.updated_at };
            })
          }
        />
      }
    />
  );
}
