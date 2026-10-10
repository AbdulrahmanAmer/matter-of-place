import { Link } from "@tanstack/react-router";

/** The body of a taken-down property's page (invariant 10): the same for every visitor, with one way on. */
export function PropertyGone() {
  return (
    <main className="not-found">
      <div>
        <p className="eyebrow">NO LONGER LISTED</p>
        <h1>This property is no longer listed.</h1>
        <p>It has been taken down and will not return at this address.</p>
        <div className="not-found-links">
          <Link to="/properties" className="text-link">
            Properties
          </Link>
        </div>
      </div>
    </main>
  );
}
