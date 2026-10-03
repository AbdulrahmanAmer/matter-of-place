import { z } from "zod";
import { AppError, toErrorResponse } from "../lib/errors";
import { readPublicObject, storageUnavailable } from "../lib/media-store";
import { mediaCached } from "./cache";
import { ipHashOf, logRequest } from "./request-log";

// `GET /media/<key>` (H33 (3), (4)): a published file from the `media` bucket, on our own domain. It makes
// no database call (S52): a warm image costs the edge cache, a cold one one Storage read.

const KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;
const PREFIX = "/media/";

function keyOf(pathname: string): string | undefined {
  if (!pathname.startsWith(PREFIX)) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname.slice(PREFIX.length));
  } catch {
    return undefined;
  }
  return KEY.test(decoded) && !decoded.split("/").includes("..") ? decoded : undefined;
}

const notFound = new AppError("not_found", undefined, "There is nothing at this address.");

// Supabase Storage answers a missing object, and a missing bucket, with HTTP 400 and the status in the body.
const storageStatusSchema = z.object({ statusCode: z.coerce.string() });

async function isMissing(upstream: Response): Promise<boolean> {
  if (upstream.status === 404) return true;
  if (upstream.status !== 400) return false;
  const body = storageStatusSchema.safeParse(await upstream.json().catch(() => null));
  return body.success && body.data.statusCode === "404";
}

/** Storage's file as is, or the error that names what went wrong; neither is stored unless it is the file. */
async function fromStorage(key: string, requestId: string): Promise<Response> {
  const upstream = await readPublicObject(key);
  if (upstream.status === 200) return upstream;
  return toErrorResponse((await isMissing(upstream)) ? notFound : storageUnavailable(), requestId);
}

async function answer(request: Request, requestId: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const response = toErrorResponse(
      new AppError("method_not_allowed", undefined, "This address does not accept that method."),
      requestId,
    );
    response.headers.set("allow", "GET, HEAD");
    return response;
  }
  const key = keyOf(new URL(request.url).pathname);
  if (key === undefined) return toErrorResponse(notFound, requestId);
  try {
    return await mediaCached(request, () => fromStorage(key, requestId));
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

/** `requestId` is the router's `context.requestId` (ruling H39 (1)). */
export async function serveMedia(request: Request, requestId: string): Promise<Response> {
  const started = Date.now();
  const response = await answer(request, requestId);
  const out = new Response(request.method === "HEAD" ? null : response.body, response);
  out.headers.set("x-request-id", requestId);
  logRequest({
    requestId,
    route: "/media",
    status: out.status,
    started,
    ipHash: await ipHashOf(request),
  });
  return out;
}
