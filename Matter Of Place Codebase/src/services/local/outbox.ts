import type { Receipt } from "../../domain/contracts";
import type { InquiryService, NewsletterService, SubmissionService } from "../types";

/**
 * In-memory outbox used while no API is configured. Records live for the
 * page session only; nothing is persisted or transmitted. The shape of each
 * record equals the request body the `http` adapters send.
 */
type OutboxKind = "inquiry" | "submission" | "subscriber";

type OutboxRecord = {
  id: string;
  kind: OutboxKind;
  receivedAt: string;
  payload: unknown;
};

const records: OutboxRecord[] = [];

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const accept = async (kind: OutboxKind, payload: unknown): Promise<Receipt> => {
  const record: OutboxRecord = { id: newId(), kind, receivedAt: new Date().toISOString(), payload };
  records.push(record);
  return { id: record.id, receivedAt: record.receivedAt };
};

export const localInquiries: InquiryService = {
  send: (input) => accept("inquiry", input),
};

export const localSubmissions: SubmissionService = {
  // Files never leave the device in local mode; their metadata is already in `input.media`.
  send: (input) => accept("submission", input),
};

export const localNewsletter: NewsletterService = {
  subscribe: (input) => accept("subscriber", input),
};

/** Read-only view for tests and debugging. */
export const readOutbox = (): readonly OutboxRecord[] => records;
