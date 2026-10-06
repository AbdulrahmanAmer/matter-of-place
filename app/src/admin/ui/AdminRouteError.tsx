import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";
import { reportClientError } from "../../lib/report-error";
import { AdminApiError } from "./admin-fetch";

/**
 * The `errorComponent` of every admin child route (FE-06). It draws inside the shell, in the main column, so the
 * navigation stays; it names the request id when the server sent one and reports the failure once.
 */
export function AdminRouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const requestId = error instanceof AdminApiError ? error.requestId : undefined;

  useEffect(() => {
    reportClientError(error, {
      route: router.state.location.pathname,
      ...(requestId === undefined ? {} : { requestId }),
    });
  }, [error, requestId, router]);

  return (
    <div className="admin-error" role="alert">
      <p className="admin-eyebrow">Could not load</p>
      <h1>This screen did not open as it should.</h1>
      <p>Try once more. If it keeps happening, quote the request id below.</p>
      {requestId === undefined ? null : (
        <p>
          Request id <code>{requestId}</code>
        </p>
      )}
      <div className="admin-actions">
        <button
          type="button"
          className="admin-button"
          onClick={() => {
            void router.invalidate();
            reset();
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
