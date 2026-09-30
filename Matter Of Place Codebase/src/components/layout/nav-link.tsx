import { Link } from "@tanstack/react-router";
import type { NavItem } from "./nav-links";

/** Renders a NavItem as a router link with the shared active state. */
export function NavLink({
  item,
  className,
  onClick,
}: {
  item: NavItem;
  className?: string;
  onClick?: () => void;
}) {
  const shared = { className, onClick, activeProps: { className: "active" } };
  return item.market ? (
    <Link to="/$market" params={{ market: item.market }} {...shared}>
      {item.label}
    </Link>
  ) : (
    <Link to={item.to} {...shared}>
      {item.label}
    </Link>
  );
}
