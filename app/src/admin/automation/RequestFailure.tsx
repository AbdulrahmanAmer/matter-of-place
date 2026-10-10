import { AdminApiError } from "../ui/admin-fetch";

/** The words of a failed request and, when the server sent one, the request id a person can quote (STANDARDS C17). */
export function RequestFailure({ error, className }: { error: Error; className?: string }) {
  const requestId = error instanceof AdminApiError ? error.requestId : undefined;
  return (
    <p role="alert" className={className}>
      {error.message}
      {requestId === undefined ? null : ` Request ${requestId}.`}
    </p>
  );
}
