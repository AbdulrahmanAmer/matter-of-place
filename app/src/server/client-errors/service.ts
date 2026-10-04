import type { ClientError } from "../../domain/contracts";
import type { Db } from "../lib/db";
import { sentryOptions } from "../lib/env";
import { logLine } from "../lib/log";
import { captureException } from "../lib/sentry";
import type { PublicCtx } from "../public/routes";

/**
 * `POST /client-error` (FE-09): what the browser caught goes to Sentry after the answer, tagged `side: browser`;
 * nothing is written to the database. The release is the Worker's own (the same deploy served the page) unless
 * the body names one. `captureException` cuts and scrubs what it is given, on top of the schema's own limits.
 */
export function report(_db: Db, input: ClientError, ctx: PublicCtx): Promise<undefined> {
  const failure = new Error(input.message);
  if (input.stack !== undefined) failure.stack = input.stack;
  const requestId = input.requestId ?? ctx.requestId;
  ctx.wait(
    captureException(failure, {
      requestId,
      route: input.route,
      side: "browser",
      ...sentryOptions(),
      ...(input.release === undefined || input.release === "" ? {} : { release: input.release }),
    }).catch(() => {
      logLine("warn", "client_error_report_failed", { requestId });
    }),
  );
  return Promise.resolve(undefined);
}
