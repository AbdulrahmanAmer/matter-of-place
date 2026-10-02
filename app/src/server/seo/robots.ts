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
