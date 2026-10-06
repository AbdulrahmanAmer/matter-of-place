// `node scripts/wait-status.mjs <url> <status> [seconds=16]` (B17 step 6): sends HEAD once a second until the URL
// answers <status>, prints that answer's status, retry-after and cache-control, and exits 0; exits 1 when the time
// runs out, a stalled request included: each HEAD is aborted at the deadline, because the flag stays flipped on the
// shared database while this waits (P-1923). The default covers the 15 second memo of the public state. It sets the
// exit code and never calls `process.exit` after a fetch (P-1916).

/**
 * @param {string} url
 * @param {number} status
 * @param {number} limit seconds
 * @returns {Promise<number>}
 */
async function waitFor(url, status, limit) {
  const deadline = Date.now() + limit * 1000;
  let last = "no answer";
  for (;;) {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    }).catch(
      /** @param {unknown} error */ (error) => {
        last = error instanceof Error ? error.message : String(error);
        return undefined;
      },
    );
    if (response?.status === status) {
      console.log(String(response.status));
      console.log(`retry-after: ${response.headers.get("retry-after") ?? "(none)"}`);
      console.log(`cache-control: ${response.headers.get("cache-control") ?? "(none)"}`);
      return 0;
    }
    if (response !== undefined) last = String(response.status);
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.error(
    `${url} did not answer ${String(status)} within ${String(limit)} s (last: ${last})`,
  );
  return 1;
}

const [url, wanted, seconds = "16"] = process.argv.slice(2);
const status = Number(wanted);
const limit = Number(seconds);
if (url === undefined || !Number.isInteger(status) || !Number.isFinite(limit)) {
  console.error("usage: node scripts/wait-status.mjs <url> <status> [seconds=16]");
  process.exitCode = 2;
} else {
  process.exitCode = await waitFor(url, status, limit);
}
