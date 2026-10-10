const SEPARATORS = /[\\/]+/;
// Browsers strip control characters from a URL, so "/<tab>/host" would read as "//host".
// eslint-disable-next-line no-control-regex -- the range is the point
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Where an old `/markets/<splat>` address goes: the same path without `/markets`, always on this origin.
 * Empty segments are dropped (so no leading `//` or `/\` can read as another host), and a splat with a
 * dot segment or a control character goes to the home page. The result starts with one `/` followed by
 * a segment that is not empty.
 */
export function legacyMarketTarget(splat: string | undefined): string {
  const segments = (splat ?? "").split(SEPARATORS).filter((segment) => segment !== "");
  if (segments.some((segment) => segment === "." || segment === ".." || CONTROL.test(segment))) {
    return "/";
  }
  return `/${segments.join("/")}`;
}
