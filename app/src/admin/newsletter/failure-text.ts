import { AdminApiError } from "../ui/admin-fetch";

/** What an editor reads when a request fails: the message, and the request id to quote when the server sent one. */
export function failureText(error: unknown, fallback = "That did not work. Try again."): string {
  if (!(error instanceof Error)) return fallback;
  return error instanceof AdminApiError && error.requestId !== undefined
    ? `${error.message} Request ${error.requestId}.`
    : error.message;
}
