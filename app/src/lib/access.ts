// The visitor's accessibility settings (operator, 2026-10-13). Kept on this device only, in localStorage under
// ACCESS_KEY, and drawn as data attributes on <html> that the styles read (src/styles/components/access.css). The head
// script ACCESS_BOOTSTRAP applies a stored choice before the first paint, so nothing jumps as a page loads.

import { ACCESS_KEY } from "./access-bootstrap";

export { ACCESS_BOOTSTRAP, ACCESS_KEY } from "./access-bootstrap";
const CHANGED = "mop-access-change";

export const textSteps = [0, 1, 2] as const;
type TextStep = (typeof textSteps)[number];

/** Corrective colour filters (daltonization), never a simulation: each moves the colour difference an eye loses into
 * one it sees. The matrices are worked in src/components/layout/vision-filters.tsx. */
export const visions = ["none", "deutan", "protan", "tritan"] as const;
type Vision = (typeof visions)[number];

export type Access = {
  text: TextStep;
  contrast: boolean;
  /** WCAG 1.4.12 text spacing. */
  spacing: boolean;
  /** The light serif and the light sans give way to Urbanist at a regular weight. */
  font: boolean;
  links: boolean;
  /** A band that follows the pointer and dims the rest of the page; it lives in the panel, not on <html>. */
  guide: boolean;
  still: boolean;
  vision: Vision;
  /** The mark is hidden behind a tab at the edge of the screen. */
  hidden: boolean;
};

export const STANDARD: Access = {
  text: 0,
  contrast: false,
  spacing: false,
  font: false,
  links: false,
  guide: false,
  still: false,
  vision: "none",
  hidden: false,
};

/** The flags drawn on <html> as empty attributes, in order. */
const FLAGS = ["contrast", "spacing", "font", "links", "still"] as const;

/** A stored value read leniently: anything unknown is the standard setting. */
export function parseAccess(raw: string | null): Access {
  let value: unknown = null;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    value = null;
  }
  if (typeof value !== "object" || value === null) return STANDARD;
  const field = (name: string): unknown => (name in value ? Reflect.get(value, name) : undefined);
  const flag = (name: string) => field(name) === true;
  const text = textSteps.find((step) => step === field("text")) ?? 0;
  const vision = visions.find((kind) => kind === field("vision")) ?? "none";
  return {
    text,
    contrast: flag("contrast"),
    spacing: flag("spacing"),
    font: flag("font"),
    links: flag("links"),
    guide: flag("guide"),
    still: flag("still"),
    vision,
    hidden: flag("hidden"),
  };
}

export function readAccess(): Access {
  try {
    return parseAccess(window.localStorage.getItem(ACCESS_KEY));
  } catch {
    return STANDARD;
  }
}

/** The attributes on <html> the styles read; a setting at its standard value leaves none. */
function applyAccess(access: Access, root: HTMLElement = document.documentElement): void {
  if (access.text === 0) root.removeAttribute("data-text");
  else root.setAttribute("data-text", String(access.text));
  if (access.vision === "none") root.removeAttribute("data-vision");
  else root.setAttribute("data-vision", access.vision);
  for (const name of FLAGS) {
    if (access[name]) root.setAttribute(`data-${name}`, "");
    else root.removeAttribute(`data-${name}`);
  }
}

/** Stores and applies a choice; a browser that refuses storage still gets it for this page. */
export function writeAccess(access: Access): void {
  try {
    window.localStorage.setItem(ACCESS_KEY, JSON.stringify(access));
  } catch {
    // Private browsing or storage turned off: the choice lasts until the page is left.
  }
  applyAccess(access);
  window.dispatchEvent(new Event(CHANGED));
}

export function onAccessChange(listener: () => void): () => void {
  window.addEventListener(CHANGED, listener);
  return () => {
    window.removeEventListener(CHANGED, listener);
  };
}
