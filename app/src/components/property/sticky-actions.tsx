import { t } from "../../lib/strings";

/** Bottom bar on phones: request a showing, or open Ask Matter of Place. */
export function StickyActions({ onShowing, onAsk }: { onShowing: () => void; onAsk: () => void }) {
  return (
    <div className="sticky-actions" role="group" aria-label="Property actions" data-print="hide">
      <button type="button" onClick={onShowing}>
        {t.common.requestShowing.toUpperCase()}
      </button>
      <button type="button" className="secondary" onClick={onAsk}>
        {t.common.ask.toUpperCase()}
      </button>
    </div>
  );
}
