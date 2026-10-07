import { useEffect } from "react";
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { reportClientError } from "../../lib/report-error";
import { t } from "../../lib/strings";
import { HttpServiceError } from "../../services/http/client";

/** The request id the server gave a failed read, for support (ASSUMED G33); none for any other error. */
// eslint-disable-next-line react-refresh/only-export-components -- the plan pins this pure helper beside its one caller (B17 invariant 19); a full reload on edit is fine
export function errorReference(error: unknown): string | undefined {
  return error instanceof HttpServiceError &&
    typeof error.requestId === "string" &&
    error.requestId !== ""
    ? error.requestId
    : undefined;
}

/** Rendered by the root route when a page fails to load or render. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const reference = errorReference(error);

  useEffect(() => {
    reportClientError(error, { route: router.state.location.pathname });
  }, [error, router]);

  return (
    <main className="not-found">
      <div>
        <p className="eyebrow">SOMETHING WENT WRONG</p>
        <h1>This page did not open as it should.</h1>
        <p>Try once more, or return home.</p>
        {reference !== undefined && (
          <p>
            {t.errors.reference} {reference}
          </p>
        )}
        <div className="not-found-links">
          <button
            type="button"
            className="text-link"
            onClick={() => {
              void router.invalidate();
              reset();
            }}
          >
            Try again
          </button>
          <a href="/" className="text-link">
            Home
          </a>
        </div>
      </div>
    </main>
  );
}
