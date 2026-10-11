import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * Site-wide motion (operator, 2026-10-11: "elevate the whole website pages sections animation motion"). Sections,
 * cards, regions and footer columns ease up as they enter the screen, staggered within their group; hairlines draw
 * across. Nothing is hidden until this runs: the server HTML is the same for every visitor (caching contract S52) and
 * a visitor without JavaScript sees every element at once. Reduced motion skips it entirely.
 */
const TARGETS = [
  ".section-wrap",
  ".editorial-statement > *",
  ".market-notes dl > div",
  ".market-region-card",
  ".market-card",
  ".property-card",
  ".story-card",
  ".tile",
  ".coming-soon-body > *",
  ".footer-top",
  ".footer-col",
  ".footer-bottom",
].join(", ");

/** Children of one group arrive one after another; the delay is capped so a long list never waits. */
const STEP_MS = 90;
const MAX_STEPS = 6;

function prepare(root: ParentNode, observer: IntersectionObserver) {
  const nodes = root.querySelectorAll<HTMLElement>(TARGETS);
  const seen = new Map<Element, number>();
  for (const node of nodes) {
    if (
      node.dataset["motion"] !== undefined ||
      node.closest(".hero-text, .site-header, .consent-bar") !== null
    )
      continue;
    const parent = node.parentElement;
    const index = parent === null ? 0 : (seen.get(parent) ?? 0);
    if (parent !== null) seen.set(parent, index + 1);
    node.dataset["motion"] = "";
    node.style.setProperty("--motion-delay", `${String(Math.min(index, MAX_STEPS) * STEP_MS)}ms`);
    const box = node.getBoundingClientRect();
    // Already on screen at first paint: shown at once, so nothing the visitor is looking at fades in late.
    if (box.top < window.innerHeight && box.bottom > 0) node.dataset["motion"] = "in";
    else observer.observe(node);
  }
}

export function SiteMotion() {
  const router = useRouter();
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue;
          entry.target.dataset["motion"] = "in";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    document.documentElement.classList.add("motion-ready");
    prepare(document, observer);
    const stop = router.subscribe("onResolved", () => {
      requestAnimationFrame(() => {
        prepare(document, observer);
      });
    });
    return () => {
      stop();
      observer.disconnect();
      document.documentElement.classList.remove("motion-ready");
    };
  }, [router]);
  return null;
}
