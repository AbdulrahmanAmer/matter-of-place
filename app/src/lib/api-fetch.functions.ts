import { createIsomorphicFn, getGlobalStartContext } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import type { FetchImpl } from "../services/http/client";

// The id B1b's `start.ts` put in the request context for the page being rendered (ruling H39 (1)).
const startContext = z.object({ requestId: z.string() });

/**
 * During a server render the API is called in-process: no network hop and no second request counted against
 * the Worker (invariant 7). The call carries the visitor's address and the id of the page request it runs inside.
 */
const serverFetch: FetchImpl = async (input, init) => {
  const [{ handlePublic }, { waitUntilOf }] = await Promise.all([
    import("../server/public/pipeline"),
    import("../server/lib/wait-until"),
  ]);
  const page = getRequest();
  const { requestId } = startContext.parse(getGlobalStartContext());
  const headers = new Headers(init.headers);
  const address = page.headers.get("cf-connecting-ip");
  if (address !== null) headers.set("cf-connecting-ip", address);
  const request = new Request(new URL(input, page.url), { ...init, headers });
  return handlePublic(request, requestId, undefined, waitUntilOf(page));
};

/** In-process on the server, `fetch` in the browser. */
export const apiFetch: FetchImpl = createIsomorphicFn()
  .server(serverFetch)
  .client((input, init) => fetch(input, init));
