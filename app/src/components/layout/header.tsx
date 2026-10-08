import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, Search, X } from "lucide-react";
import { Emblem } from "../brand/emblem";
import { useModal } from "../../hooks/use-modal";
import { useScrolled } from "../../hooks/use-scrolled";
import { cx } from "../../lib/cx";
import { t } from "../../lib/strings";
import { MenuPanel } from "./menu-panel";
import { NavLink } from "./nav-link";
import { primaryLinks, secondaryLinks, submitLink } from "./nav-links";
import { SearchOverlay } from "./search-overlay";

/**
 * Fixed header. Over the home page photograph it is transparent with a soft
 * scrim; once the page scrolls, or on any other route, it settles into a solid
 * bar. Other pages reserve its height with a spacer so nothing hides beneath it.
 */
export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const scrolled = useScrolled();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const isHome = path === "/";
  const overlay = isHome && !menuOpen && !scrolled;

  const closeAll = useCallback(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, []);

  useEffect(() => {
    closeAll();
  }, [path, closeAll]);

  useModal(menuOpen || searchOpen, closeAll, menuOpen ? menuRef : searchRef);

  return (
    <>
      <header className={cx("site-header", overlay && "site-header-overlay")} data-print="hide">
        <div className="hf-inner header-grid">
          <nav className="header-nav header-nav-left" aria-label="Main navigation">
            {primaryLinks.map((link) => (
              <NavLink item={link} key={link.label} />
            ))}
          </nav>

          <button
            type="button"
            className="header-toggle"
            aria-label={menuOpen ? t.header.closeMenu : t.header.openMenu}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>

          <Link to="/" aria-label={t.header.home} className="header-brand">
            <Emblem className="header-emblem" />
            <span className="hf-wordmark">Matter of Place</span>
          </Link>

          <nav className="header-nav header-nav-right" aria-label="Secondary navigation">
            {secondaryLinks.map((link) => (
              <NavLink item={link} key={link.label} />
            ))}
            <NavLink item={submitLink} className="header-cta" />
            <button
              type="button"
              className="header-search"
              aria-label={t.header.search}
              title={t.header.search}
              onClick={() => setSearchOpen(true)}
            >
              <Search size={17} />
            </button>
          </nav>

          <button
            type="button"
            className="header-search header-search-mobile"
            aria-label={t.header.search}
            onClick={() => setSearchOpen(true)}
          >
            <Search size={19} />
          </button>
        </div>
      </header>

      {!isHome && <div className="header-spacer" aria-hidden="true" data-print="hide" />}

      {menuOpen && (
        <MenuPanel
          ref={menuRef}
          onNavigate={() => setMenuOpen(false)}
          onSearch={() => {
            setMenuOpen(false);
            setSearchOpen(true);
          }}
        />
      )}

      {searchOpen && <SearchOverlay ref={searchRef} onClose={() => setSearchOpen(false)} />}
    </>
  );
}
