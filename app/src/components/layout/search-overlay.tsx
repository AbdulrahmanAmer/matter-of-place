import type { SyntheticEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, X } from "lucide-react";
import { focusOnMount } from "../../hooks/use-modal";
import { track } from "../../lib/analytics";
import { formText } from "../../lib/form-data";
import { t } from "../../lib/strings";

/** Site-wide search: one field, sends the term to the Properties collection. */
export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = formText(new FormData(event.currentTarget), "q").trim();
    track("search", { term });
    onClose();
    void navigate({ to: "/properties", search: term ? { q: term } : {} });
  };

  return (
    <div
      className="search-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="search-panel" role="dialog" aria-modal="true" aria-label={t.header.search}>
        <div className="search-panel-head">
          <span className="eyebrow">{t.header.findAPlace}</span>
          <button
            type="button"
            className="icon-button"
            aria-label={t.header.closeSearch}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <input
            ref={focusOnMount}
            name="q"
            placeholder={t.header.searchPlaceholder}
            aria-label={t.header.searchLabel}
          />
          <button type="submit" className="icon-button" aria-label={t.header.search}>
            <ArrowRight size={22} />
          </button>
        </form>
        <p>{t.header.openMarkets}</p>
      </div>
    </div>
  );
}
