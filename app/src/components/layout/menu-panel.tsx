import type { Ref } from "react";
import { t } from "../../lib/strings";
import { NavLink } from "./nav-link";
import { primaryLinks, secondaryLinks, submitLink } from "./nav-links";

/** Full-screen navigation for narrow screens. */
export function MenuPanel({
  onNavigate,
  onSearch,
  ref,
}: {
  onNavigate: () => void;
  onSearch: () => void;
  ref: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      id="mobile-menu"
      className="menu-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
    >
      <nav aria-label="Mobile navigation">
        {[...primaryLinks, ...secondaryLinks, submitLink].map((link) => (
          <NavLink item={link} key={link.label} onClick={onNavigate} />
        ))}
        <button type="button" onClick={onSearch}>
          {t.header.search}
        </button>
      </nav>
      <span className="menu-tagline">{t.header.tagline}</span>
    </div>
  );
}
