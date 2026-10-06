// The Node and bun side of B3's `src/server/lib/media-store.ts` (ASSUMED H33 (2)): the Storage REST API of the one
// project, called with `fetch`, no SDK. Keys are content-hashed and never change their bytes (F24).

const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * @param {string} name
 * @returns {string}
 */
function required(name) {
  // One database (G-901, P-331): the two generic names resolve from the dev profile first; the shell's own values
  // count only behind CI's E2E_STACK=1, never on a laptop, where they can belong to another project.
  if (name === "SUPABASE_URL" || name === "SUPABASE_SERVICE_ROLE_KEY") {
    const ref = process.env["DEV_SUPABASE_PROJECT_REF"] ?? "";
    const devKey = process.env["DEV_SUPABASE_SERVICE_ROLE_KEY"] ?? "";
    if (ref !== "" && devKey !== "") {
      return name === "SUPABASE_URL" ? `https://${ref}.supabase.co` : devKey;
    }
    if (process.env["E2E_STACK"] !== "1") {
      throw new Error(`media-store: ${name} is read only from the dev profile; load it first`);
    }
  }
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`media-store: ${name} is not set`);
  return value;
}

/**
 * @param {string} bucket
 * @param {string} key
 * @returns {string}
 */
function objectUrl(bucket, key) {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${required("SUPABASE_URL")}/storage/v1/object/${bucket}/${path}`;
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<Response>}
 */
async function call(url, init) {
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error("storage_unavailable", { cause: error });
  }
  if (response.status >= 500) throw new Error("storage_unavailable");
  return response;
}

/**
 * @param {Response} response
 * @returns {Promise<boolean>} whether Storage answered that the key is already stored
 */
async function isDuplicate(response) {
  if (response.status === 409) return true;
  /** @type {unknown} */
  const body = await response.json().catch(() => null);
  return (
    typeof body === "object" && body !== null && "statusCode" in body && body.statusCode === "409"
  );
}

/**
 * Stores `body` under `key` unless the key exists. An answer of 409 Duplicate counts as done with no second call.
 * @param {string} bucket
 * @param {string} key
 * @param {Uint8Array} body
 * @param {string} contentType
 * @returns {Promise<void>}
 */
export async function putIfMissing(bucket, key, body, contentType) {
  /** @type {Record<string, string>} */
  const headers = {
    authorization: `Bearer ${required("SUPABASE_SERVICE_ROLE_KEY")}`,
    "x-upsert": "false",
    "content-type": contentType,
  };
  if (bucket === "media") headers["cache-control"] = IMMUTABLE;
  const response = await call(objectUrl(bucket, key), { method: "POST", headers, body });
  if (response.ok || (await isDuplicate(response))) return;
  throw new Error(`media-store: upload of ${bucket}/${key} answered ${String(response.status)}`);
}

/**
 * @param {string} bucket
 * @param {string} key
 * @returns {Promise<Uint8Array>} the bytes stored under the key
 */
export async function getObject(bucket, key) {
  const response = await call(objectUrl(bucket, key), {
    headers: { authorization: `Bearer ${required("SUPABASE_SERVICE_ROLE_KEY")}` },
  });
  if (!response.ok) {
    throw new Error(`media-store: read of ${bucket}/${key} answered ${String(response.status)}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
