import type { ZodError, ZodIssue } from "zod";
import { errorCodes, type ErrorCode } from "./error-codes.ts";

const SERVER_MESSAGE = "Something went wrong. Please try again in a moment.";
const VALIDATION_MESSAGE = "Some of the details need another look.";

/** The only error server code throws on purpose (R09). The status defaults to the code's own. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly issues: ZodIssue[] | undefined;

  constructor(
    code: ErrorCode,
    status: number = errorCodes[code],
    message: string,
    issues?: ZodIssue[],
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.issues = issues;
  }
}

/** A schema refusal: 422 `validation` with the Zod issues. */
export function fromZod(error: ZodError): AppError {
  return new AppError("validation", undefined, VALIDATION_MESSAGE, error.issues);
}

/**
 * The R09 body for any thrown value, never stored (invariant 16). Anything that is not an
 * `AppError` is a 500 `server` with calm copy: its own message never leaves the Worker.
 */
export function toErrorResponse(error: unknown, requestId: string): Response {
  const known =
    error instanceof AppError ? error : new AppError("server", undefined, SERVER_MESSAGE);
  const body = {
    error: {
      code: known.code,
      message: known.message,
      ...(known.issues === undefined ? {} : { issues: known.issues }),
      requestId,
    },
  };
  return Response.json(body, {
    status: known.status,
    headers: { "cache-control": "no-store", "x-request-id": requestId },
  });
}
