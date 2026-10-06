// One database (G-901, P-331, the READ FIRST line of GOTCHAS.md). The two generic Supabase names resolve from the
// dev profile first; the shell's own values count only behind CI's E2E_STACK=1, never on a laptop, where they can
// belong to another project (they did, on 2026-10-06).

/**
 * The value of `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` for the one project, or `undefined` when `name` is any
 * other variable (the caller then reads the environment as usual).
 * @param {string} name
 * @param {string} label  the script's name, for the error message
 * @returns {string | undefined}
 */
export function oneDatabaseValue(name, label) {
  if (name !== "SUPABASE_URL" && name !== "SUPABASE_SERVICE_ROLE_KEY") return undefined;
  const ref = process.env["DEV_SUPABASE_PROJECT_REF"] ?? "";
  const devKey = process.env["DEV_SUPABASE_SERVICE_ROLE_KEY"] ?? "";
  if (ref !== "" && devKey !== "") {
    return name === "SUPABASE_URL" ? `https://${ref}.supabase.co` : devKey;
  }
  if (process.env["E2E_STACK"] !== "1") {
    throw new Error(`${label}: ${name} is read only from the dev profile; load it first`);
  }
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${label}: ${name} is not set`);
  return value;
}
