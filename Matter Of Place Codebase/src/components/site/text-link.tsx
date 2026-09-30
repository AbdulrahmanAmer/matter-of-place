import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "react";
import { createLink } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { cx } from "../../lib/cx";

const Arrow = () => <ArrowUpRight size={16} aria-hidden="true" />;

const TextAnchor = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(
  function TextAnchor({ children, className, ...rest }, ref) {
    return (
      <a ref={ref} className={cx("text-link", className)} {...rest}>
        {children}
        <Arrow />
      </a>
    );
  },
);

/** Uppercase underlined link with a trailing arrow; fully typed router link. */
export const TextLink = createLink(TextAnchor);

/** Same treatment as `TextLink`, for actions that stay on the page. */
export function TextButton({
  children,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={cx("text-link", className)} {...rest}>
      {children}
      <Arrow />
    </button>
  );
}
