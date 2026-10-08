import { z } from "zod";

// How a Graph error is handled (B10 invariants 3a and 3b, R34). `retry_at` and `retryable` retry inside the posting
// window through `planRetry`; `non_retryable` fails the post at once; `token_dead` fails it and alerts an admin.

type GraphErrorClass = "retry_at" | "retryable" | "non_retryable" | "token_dead";

/**
 * Codes and subcodes from Meta's error tables: 4, 17, 32 and 613 are rate limits, 9 with 2207042 is the daily
 * publishing limit, 9007 with 2207027 is a container not finished yet, 1 and 2 are Graph's own temporary failures,
 * 190 is a token Meta no longer accepts. A row with a subcode matches only that subcode.
 */
const GRAPH_ERROR_TABLE: readonly {
  code: number;
  subcode?: number;
  class: GraphErrorClass;
}[] = [
  { code: 190, class: "token_dead" },
  { code: 4, class: "retry_at" },
  { code: 17, class: "retry_at" },
  { code: 32, class: "retry_at" },
  { code: 613, class: "retry_at" },
  { code: 9, subcode: 2207042, class: "retry_at" },
  { code: 9007, subcode: 2207027, class: "retryable" },
  { code: 1, class: "retryable" },
  { code: 2, class: "retryable" },
];

const graphErrorSchema = z
  .object({
    error: z
      .object({
        message: z.string().optional(),
        code: z.number(),
        error_subcode: z.number().optional(),
        is_transient: z.boolean().optional(),
      })
      .passthrough(),
  })
  .passthrough();

interface ClassifiedError {
  class: GraphErrorClass;
  code: number | null;
  subcode: number | null;
  message: string;
}

/** The class of a Graph answer that was not 2xx, from its body when it is a Graph error, else from the status. */
export function classifyGraphError(status: number, body: unknown): ClassifiedError {
  const parsed = graphErrorSchema.safeParse(body);
  if (!parsed.success) {
    return {
      class: status === 429 ? "retry_at" : status >= 500 ? "retryable" : "non_retryable",
      code: null,
      subcode: null,
      message: `Graph answered ${String(status)}.`,
    };
  }
  const { code, error_subcode: subcode, message, is_transient: transient } = parsed.data.error;
  const row = GRAPH_ERROR_TABLE.find(
    (entry) => entry.code === code && (entry.subcode === undefined || entry.subcode === subcode),
  );
  return {
    class: row?.class ?? (transient === true || status >= 500 ? "retryable" : "non_retryable"),
    code,
    subcode: subcode ?? null,
    message: message ?? `Graph error ${String(code)}.`,
  };
}
