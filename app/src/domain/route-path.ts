const KEPT_ESCAPES = /(%25|%5C)/i;
const ESCAPE = /%[0-9A-F]{2}/gi;

/** `decodeURI`, or each ASCII escape alone when the whole is malformed, as the router does. */
function decodeLikeRouter(text: string): string {
  try {
    return decodeURI(text);
  } catch {
    return text.replace(ESCAPE, (escape) =>
      Number.parseInt(escape.slice(1), 16) < 0x80 ? decodeURI(escape) : escape,
    );
  }
}

/**
 * The path as the router matches it (`decodePath` in `@tanstack/router-core`): escapes decoded
 * except `%25` and `%5C`, leading slashes made one, case ignored. `/API/x`, `/%61pi/x` and
 * `//api/x` all reach the `/api/x` route, so every prefix rule reads this form.
 */
export function routePath(pathname: string): string {
  const decoded = pathname
    .split(KEPT_ESCAPES)
    .map((part, index) => (index % 2 === 1 ? part : decodeLikeRouter(part)))
    .join("");
  return `/${decoded.replace(/^\/+/, "")}`.toLowerCase();
}

/**
 * The key of a redirect address (URL-002): as the router reads it, without a trailing slash. The resolver and
 * `redirectSchema` both compare addresses by this key, so two spellings of one address are one address.
 */
export function redirectKey(pathname: string): string {
  const path = routePath(pathname);
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}
