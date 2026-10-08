// Run by Deno, not by vitest (T-11): `MOP_ENV=development deno run --config supabase/functions/job-runner/deno.json
// --allow-env tests/deno/site-context.smoke.ts`, and in CI by `deno test` over `tests/deno/*.smoke.ts`. It loads the
// chain the job runner loads for an email (`context.ts`, `settings/service.ts`, `public/state.ts`) and reads the site
// through it, so a Node-only or Worker-only import anywhere in the chain fails here. It uses no `Deno` global, which
// lets `bun run check` type-check it like any file.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/db/index.ts";
import { loadSiteContext } from "../../src/server/email/context.ts";

const ENTITY = "Example Fixture Holdings LLC";
const ADDRESS = "100 Example Street, Suite 0, Testville, CA 90000";

const state = {
  catalog_version: 1,
  flags: {},
  coming_soon_global: false,
  coming_soon_markets: {},
  site: {
    contact: { email: "hello@example.test", phone: null, privacy_email: null },
    legal: { entity: ENTITY, address: ADDRESS },
    social: { instagram: null, x: null, linkedin: null },
  },
  illustrative_content: false,
};

// The client is the real supabase-js one; only its transport answers from here.
const stubFetch: typeof fetch = Object.assign(
  (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (!url.pathname.endsWith("/rest/v1/rpc/public_state")) {
      throw new Error(`smoke: unexpected request to ${url.pathname}`);
    }
    return Promise.resolve(Response.json(state));
  },
  { preconnect: () => undefined },
);

const db = createClient<Database>("https://smoke.invalid", "smoke-key", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: stubFetch },
});

const context = await loadSiteContext(db, "https://dev.example.invalid");
if (context.entity !== ENTITY || context.address !== ADDRESS) {
  throw new Error(`smoke: the site context lost its identity lines: ${JSON.stringify(context)}`);
}
