import { useEffect } from "react";
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";

/** Rendered by the root route when a page fails to load or render. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="not-found">
      <div>
        <p className="eyebrow">SOMETHING WENT WRONG</p>
        <h1>This page did not open as it should.</h1>
        <p>Try once more, or return home.</p>
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
