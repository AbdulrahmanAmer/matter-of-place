import { z } from "zod";
import { loadSiteContext, resolveAdminRecipients } from "../../email/context.ts";
import { loadBlocks, readIssue, renderIssue } from "../../newsletter/issue.ts";
import { sendEach } from "../steps/send-email.ts";
import type { StepContext, StepResult, SystemJobDefinition } from "../types.ts";
import { NonRetryableError } from "../types.ts";

// System job `newsletter_preview` (B11 invariant 11). `newsletter_approve_issue` enqueues it 24 hours before the send
// for the admin recipients; screen 13's send test enqueues it with `data.test` for the one person who asked. Both
// render the issue exactly as the broadcast will and go out through B5's `sendOne`, one message row per address.

const input = z.union([
  z.object({ issue_id: z.string().uuid(), test: z.literal(true), to: z.string().email() }),
  z.object({ issue_id: z.string().uuid(), approval_count: z.number().int() }),
]);

async function run(ctx: StepContext, data: Record<string, unknown>): Promise<StepResult> {
  const parsed = input.safeParse(data);
  if (!parsed.success) throw new NonRetryableError("issue_id_missing");
  const job = parsed.data;
  const issue = await readIssue(ctx.db, job.issue_id);
  const test = "test" in job;
  if (!test && (issue?.status !== "approved" || issue.approval_count !== job.approval_count)) {
    return { status: "done", result: { skipped: "stale" } };
  }
  if (issue === null) throw new NonRetryableError("issue_missing");
  const recipients = test ? [job.to] : await resolveAdminRecipients(ctx.db);
  if (recipients.length === 0) throw new NonRetryableError("no_recipients");
  const email = await renderIssue(
    (await loadBlocks(ctx.db, issue)).render,
    await loadSiteContext(ctx.db),
  );
  return sendEach(ctx, recipients, {
    templateKey: "newsletter_preview",
    kind: test ? "test" : "bulk",
    rendered: { ...email, subject: `${test ? "[Test]" : "Preview:"} ${email.subject}` },
  });
}

export const newsletterPreview: SystemJobDefinition = {
  type: "newsletter_preview",
  sideEffect: "idempotency_key",
  maxAttempts: 12,
  run: (ctx, _params, data) => run(ctx, data),
};
