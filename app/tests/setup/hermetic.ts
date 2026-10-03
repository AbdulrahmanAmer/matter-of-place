// R50, HO-8: a unit or component test sees no credentials and makes no network call. A test that needs fetch
// injects a fake (`fetchImpl`) or uses `vi.stubGlobal("fetch", ...)`.
const CREDENTIAL =
  /^(PROD_|BACKUP_)|^(SUPABASE_ACCESS_TOKEN|CLOUDFLARE_API_TOKEN|CF_EDGE_TOKEN|RESEND_API_KEY|SUPABASE_SERVICE_ROLE_KEY)$/;

for (const name of Object.keys(process.env)) {
  if (CREDENTIAL.test(name)) Reflect.deleteProperty(process.env, name);
}

function refuseNetwork(input: string | URL | Request): never {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  throw new Error(`hermetic: network call to ${url} in a unit test`);
}

Object.defineProperty(globalThis, "fetch", {
  value: refuseNetwork,
  writable: true,
  configurable: true,
});
