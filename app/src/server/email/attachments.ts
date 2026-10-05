import { NonRetryableError, type JsonObject, type StepContext } from "../jobs/types.ts";

// Files a `send_email` step attaches, by the step's `attach` parameter. Resend takes at most 40 MB per email after
// Base64 encoding (https://resend.com/docs/api-reference/emails/send-email, read 2026-10-05).

/** One attachment as Resend's `attachments` field takes it: the content Base64 encoded. */
export interface EmailAttachment {
  filename: string;
  content: string;
}

type AttachmentResolver = (ctx: StepContext, data: JsonObject) => Promise<EmailAttachment>;

export const attachmentResolvers: Record<"invoice_pdf", AttachmentResolver> = {
  // STUB(B6 step 5): invoicePdfAttachment replaces this entry
  invoice_pdf: () => Promise.reject(new NonRetryableError("attachment_unavailable")),
};
