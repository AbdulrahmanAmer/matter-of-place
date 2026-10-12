import { z } from "zod";
import {
  approvalSchema,
  messageSchema,
  officeSchema,
  type HireInput,
} from "../../domain/workforce";
import { adminFetch } from "../ui/admin-fetch";

// W1: the Office screens' calls to `/api/admin/workforce/*`.

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const fetchOffice = () => adminFetch("/api/admin/workforce/office", officeSchema);

export const fetchMessages = (thread: string) =>
  adminFetch(
    `/api/admin/workforce/messages?thread=${encodeURIComponent(thread)}`,
    z.object({ items: z.array(messageSchema) }),
  );

export const postMessage = (thread: string, body: string) =>
  adminFetch(
    "/api/admin/workforce/messages",
    z.object({ id: z.string(), woke: z.array(z.string()) }),
    json({ thread, body }),
  );

export const postHire = (input: HireInput) =>
  adminFetch("/api/admin/workforce/agents", z.object({ id: z.string() }), json(input));

export const postAgentState = (slug: string, state: "idle" | "paused" | "off") =>
  adminFetch(
    `/api/admin/workforce/agents/${encodeURIComponent(slug)}`,
    z.object({ id: z.string() }),
    json({ state }),
  );

export const fetchApprovals = () =>
  adminFetch("/api/admin/workforce/approvals", z.object({ items: z.array(approvalSchema) }));

export const postDecision = (
  id: string,
  decision: "approved" | "rejected",
  contentHash: string,
  teach: { reason?: string; editedBody?: string } = {},
) =>
  adminFetch(
    `/api/admin/workforce/approvals/${encodeURIComponent(id)}`,
    z.object({ state: z.string() }),
    json({
      decision,
      content_hash: contentHash,
      ...(teach.reason === undefined ? {} : { reason: teach.reason }),
      ...(teach.editedBody === undefined ? {} : { edited_body: teach.editedBody }),
    }),
  );
