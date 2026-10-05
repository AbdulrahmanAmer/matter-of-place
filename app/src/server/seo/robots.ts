/**
 * True only on the real domain under production: every `.workers.dev` host is false whatever
 * `MOP_ENV` says (G19), and any host follows `MOP_ENV` otherwise. The robots route and the
 * request pipeline both call it.
 */
export function isIndexableHost(host: string, mopEnv: string): boolean {
  if (mopEnv !== "production") return false;
  const name = host.toLowerCase().replace(/:\d+$/, "");
  return !name.endsWith(".workers.dev");
}

const SITEMAP = "https://matterofplace.com/sitemap.xml";
const INDEXABLE_BODY = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api

Sitemap: ${SITEMAP}
`;
const CLOSED_BODY = "User-agent: *\nDisallow: /\n";

/**
 * The `robots.txt` answer for a host: one allow block for every crawler on the real domain, a closed
 * door everywhere else. A pure function of its two arguments, so only the indexable body is ever stored.
 */
export function buildRobots(host: string, mopEnv: string): Response {
  return new Response(isIndexableHost(host, mopEnv) ? INDEXABLE_BODY : CLOSED_BODY, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
