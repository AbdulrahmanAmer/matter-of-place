import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { accountConfirmInput, accountLinkInput } from "../domain/account";
import type * as AccountService from "../server/account/service";
import type { Db } from "../server/lib/db";
import type { env } from "../server/lib/env";

// W6 item 7, ruling H119 (4): the client room's calls to the Worker. Each is a POST, which the edge never stores, and
// each answer is `private, no-store` and carries the session cookies the call wrote (a sign-in, a refresh, a sign-out).
// The server modules load inside the handlers, as `archive.functions.ts` does.

interface AccountDeps {
  request: Request;
  account: typeof AccountService;
  db: Db;
  environment: typeof env;
}

async function withAccount<T>(work: (deps: AccountDeps) => Promise<T>): Promise<T> {
  const [account, { getDb }, workerEnv, { takeIssuedCookies }] = await Promise.all([
    import("../server/account/service"),
    import("../server/lib/db"),
    import("../server/lib/env"),
    import("../server/lib/session"),
  ]);
  const request = getRequest();
  try {
    return await work({ request, account, db: getDb(), environment: workerEnv.env });
  } finally {
    setResponseHeader("cache-control", "private, no-store");
    const cookies = takeIssuedCookies(request);
    if (cookies.length > 0) setResponseHeader("set-cookie", cookies);
  }
}

/** The room, the "not found" state, or the sign-in form. */
export const readAccountFn = createServerFn({ method: "POST" }).handler(() =>
  withAccount(({ account, db, request }) => account.readAccount(db, request)),
);

/** Queues a sign-in link for a client's address; always answers `sent`, before any lookup. */
export const sendAccountLinkFn = createServerFn({ method: "POST" })
  .validator(accountLinkInput)
  .handler(({ data }) =>
    withAccount(({ account, db, request, environment }) =>
      account.sendAccountLink(db, request, environment, data),
    ),
  );

/** Spends the link's token hash and signs the person in. */
export const confirmAccountLinkFn = createServerFn({ method: "POST" })
  .validator(accountConfirmInput)
  .handler(({ data }) =>
    withAccount(({ account, db, request }) => account.verifyAccountLink(db, request, data)),
  );

/** Signs the person out. */
export const signOutAccountFn = createServerFn({ method: "POST" }).handler(() =>
  withAccount(({ account, request }) => account.signOutAccount(request)),
);
