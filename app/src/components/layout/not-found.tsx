import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <main className="not-found">
      <div>
        <p className="eyebrow">NOT FOUND</p>
        <h1>This place is not on our map.</h1>
        <p>
          The page may have moved, or it was never here. We cover California, Florida and New York.
        </p>
        <div className="not-found-links">
          <Link to="/" className="text-link">
            Home
          </Link>
          <Link to="/properties" className="text-link">
            Properties
          </Link>
          <Link to="/markets" className="text-link">
            Markets
          </Link>
        </div>
      </div>
    </main>
  );
}
