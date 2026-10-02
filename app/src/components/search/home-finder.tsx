import { useState, type SyntheticEvent } from "react";
import { useAsyncAction } from "../../hooks/use-async-action";
import { track } from "../../lib/analytics";
import { pluralize } from "../../lib/format";
import { services, type SearchMatch } from "../../services";
import { FormError } from "../forms/form-notice";
import { PropertyGrid } from "../site/property-card";

const examples = [
  "A mid-century house with a garden and views, under $6M",
  "Modern home by the water with a terrace",
  "Something with original details in San Francisco",
];

/** Natural-language home search. Ranking comes from the search service. */
export function HomeFinder() {
  const [text, setText] = useState("");
  const { state, run, pending } = useAsyncAction((query: string) =>
    services.search.match({ text: query }),
  );

  const search = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setText(query);
    const matches = await run(trimmed);
    if (matches) track("home_finder", { q: trimmed, matches: matches.length });
  };

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void search(text);
  };

  return (
    <section className="home-finder" aria-labelledby="finder-heading">
      <p className="eyebrow">DESCRIBE IT</p>
      <h2 id="finder-heading">Tell us the home you have in mind.</h2>
      <form onSubmit={onSubmit} aria-busy={pending}>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type, architecture, light, setting, budget"
          aria-label="Describe your ideal home"
        />
        <button type="submit" className="button" disabled={!text.trim() || pending}>
          {pending ? "Finding" : "Find"}
        </button>
      </form>
      <div className="finder-examples">
        {examples.map((example) => (
          <button key={example} type="button" onClick={() => void search(example)}>
            {example}
          </button>
        ))}
      </div>
      <FormError message={state.status === "error" ? state.message : null} />
      {state.status === "success" && <FinderResults matches={state.result} />}
    </section>
  );
}

function FinderResults({ matches }: { matches: SearchMatch[] }) {
  if (!matches.length) {
    return (
      <div className="finder-results" aria-live="polite">
        <p>Nothing close yet. Try a place, a style or a feature.</p>
      </div>
    );
  }
  return (
    <div className="finder-results" aria-live="polite">
      <p className="result-count">
        {matches.length} CLOSE {pluralize(matches.length, "MATCH", "MATCHES")}
      </p>
      <ul className="finder-reasons">
        {matches.map((match) => (
          <li key={match.property.slug}>
            <strong>{match.property.city}</strong> · {match.reasons.join(" · ")}
          </li>
        ))}
      </ul>
      <PropertyGrid items={matches.map((match) => match.property)} />
    </div>
  );
}
