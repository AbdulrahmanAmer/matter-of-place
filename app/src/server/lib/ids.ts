import { randomToken, sha256Hex } from "./crypto";

// No request id lives here: a handler takes it from `context.requestId`, which `src/start.ts` sets
// (H39 (1)). Every hash and random value comes from `crypto.ts`, the one Web Crypto module (CS-04).

export { sha256Hex };

/**
 * The visitor's address, the one source for the IP hash, the rate-limit keys and Turnstile's
 * `remoteip`. Cloudflare sets the header; without it (`wrangler dev`, tests) every call shares one bucket.
 */
export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "0.0.0.0";
}

export function hashKey(salt: string, value: string): Promise<string> {
  return sha256Hex(`${salt}:${value}`);
}

/** 32 random bytes, base64url. */
export function newToken(): string {
  return randomToken(32);
}
