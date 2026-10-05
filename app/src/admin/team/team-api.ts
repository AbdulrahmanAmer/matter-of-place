import { meSchema } from "../../domain/admin-team";
import { getTurnstileToken } from "../../lib/turnstile";

// The browser side of staff sign-in: who is signed in, and the request for a sign-in link.

/** The signed-in actor, or null when the request has no valid session or key (401). */
export async function fetchMe() {
  // STUB(B7 step 3): adminFetch of src/admin/ui/admin-fetch.ts
  const response = await fetch("/api/admin/me", { credentials: "same-origin" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`me answered ${String(response.status)}`);
  return meSchema.parse(await response.json());
}

/** Asks for a sign-in link; the answer is the same whether or not the address belongs to the team. */
export async function requestSignInLink(email: string): Promise<void> {
  const token = await getTurnstileToken("auth-send-link");
  // STUB(B7 step 3): adminFetch of src/admin/ui/admin-fetch.ts
  const response = await fetch("/api/admin/auth/send-link", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { "x-turnstile-token": token }),
    },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(`send-link answered ${String(response.status)}`);
}
