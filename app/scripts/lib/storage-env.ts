// The project a script writes to. `media-store.mjs` reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, which a shell may
// hold for another project, so a script that uploads sets them from its own names first (the same rule as the seed's
// client: the guard, the lock and the writes must all be on one project).

export interface Project {
  url: string;
  key: string;
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

/** The one cloud project (ruling H35), from the names `scripts/load-env.mjs --profile dev` loads. */
export function devProject(): Project {
  return {
    url: `https://${requiredEnv("DEV_SUPABASE_PROJECT_REF")}.supabase.co`,
    key: requiredEnv("DEV_SUPABASE_SERVICE_ROLE_KEY"),
  };
}

/** Points `scripts/lib/media-store.mjs` at `project` for the rest of this process. */
export function useForMediaStore(project: Project): void {
  process.env["SUPABASE_URL"] = project.url;
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = project.key;
}
