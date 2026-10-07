import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { t } from "../../lib/strings";
import { Field } from "../forms/field";

// The search is a plain GET form, so it works without JavaScript; `/properties?q=` runs the query and tracks it.
export function NotFound() {
  return (
    <main className="not-found">
      <div>
        <p className="eyebrow">NOT FOUND</p>
        <h1>This place is not on our map.</h1>
        <p>
          The page may have moved, or it was never here. We cover California, Florida and New York.
        </p>
        <form method="get" action="/properties" className="not-found-search">
          <Field label={t.notFound.searchLabel}>
            <input type="search" name="q" />
          </Field>
          <button type="submit" className="icon-button" aria-label={t.header.search}>
            <ArrowRight size={22} />
          </button>
        </form>
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
