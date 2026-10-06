import { z } from "zod";
import { appRoles } from "./contracts.ts";

// Staff sign-in and `GET /api/admin/me` (invariants 2, 11 and 19).

/** `POST /api/admin/auth/send-link`. The Turnstile token travels in the `x-turnstile-token` header. */
export const sendLinkInput = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

/** The form the confirm page posts to `POST /api/admin/auth/verify`. */
export const verifyInput = z.object({
  token_hash: z.string().min(1).max(512),
  type: z.enum(["email", "invite"]),
  next: z.string().max(2048).optional(),
});

/** The body of `GET /api/admin/me`. */
export const meSchema = z.object({
  actor: z.object({ id: z.string() }),
  kind: z.enum(["human", "agent"]),
  roles: z.array(z.enum(appRoles)),
  scopes: z.array(z.string()),
  /** The registered actions this actor may perform, read by `<RoleGate>` and the nav. */
  actions: z.array(z.string()),
  environment: z.enum(["local", "preview", "production"]),
});
