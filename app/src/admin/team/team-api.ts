import { z } from "zod";
import { meSchema } from "../../domain/admin-team";
import { getTurnstileToken } from "../../lib/turnstile";
import { AdminApiError, adminFetch } from "../ui/admin-fetch";

// The browser side of staff sign-in: who is signed in, and the request for a sign-in link.

/** The signed-in actor, or null when the request has no valid session or key (401). */
export async function fetchMe() {
  try {
    return await adminFetch("/api/admin/me", meSchema);
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) return null;
    throw error;
  }
}

/** Asks for a sign-in link; the answer is the same whether or not the address belongs to the team. */
export async function requestSignInLink(email: string): Promise<void> {
  const token = await getTurnstileToken("auth-send-link");
  await adminFetch("/api/admin/auth/send-link", z.unknown(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { "x-turnstile-token": token }),
    },
    body: JSON.stringify({ email }),
  });
}
