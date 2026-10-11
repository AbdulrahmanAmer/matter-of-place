// What the committing drills (H1-32, H1-34) find and remove after a run, kept apart from the drill scripts so a test can
// call it (a drill script runs its `main()` on import). Every function works on the `rows` of `probe-db.ts`'s `ProbeDb`
// and only reads or removes what the drill itself made: a row is claimed by the drill's own start time, job id or
// address, never by "the newest one" (a real event or message would otherwise be deleted).
import { ids, type ProbeDb, type ProbeRows } from "./probe-db.ts";

type Reader = Pick<ProbeDb, "rows">;

/**
 * The rows a test send leaves on the database: its `email_messages` rows, the `send_email` jobs that sent them (found by
 * the message or by the address in the job's own payload, so a job whose message was never written is found too) and the
 * events of those jobs. Only rows created at or after `start` count.
 */
export async function emailDrillRows(
  db: Reader,
  address: string,
  start: string,
): Promise<ProbeRows> {
  const messages = await ids(
    db,
    "select id::text as id from public.email_messages where to_email = $1 and created_at >= $2::timestamptz",
    [address, start],
  );
  const jobs = await ids(
    db,
    `select j.id::text as id
     from public.jobs j
     where j.type = 'send_email'
       and j.created_at >= $2::timestamptz
       and (j.payload #>> '{data,actor_email}' = $1
         or j.id in (select m.job_id from public.email_messages m where m.id::text = any($3::text[])))`,
    [address, start, messages],
  );
  const events = await ids(
    db,
    "select id::text as id from public.job_events where job_id::text = any($1::text[])",
    [jobs],
  );
  return { email_messages: messages, job_events: events, jobs };
}

/**
 * The one `health.failed` event the health job `jobId` wrote for `check`: written inside that job's own run window (from
 * its creation to its end, or now while it has none) and listing the check. No event answers `undefined`. Two events in
 * the window throw, because the drill would delete one of them and cannot tell its own from a real alert.
 */
export async function healthEventOf(
  db: Reader,
  jobId: string,
  check: string,
): Promise<string | undefined> {
  const found = await ids(
    db,
    `select e.id::text as id
     from public.events e
     join public.jobs j on j.id = $1::uuid
     where e.type = 'health.failed'
       and e.at >= j.created_at
       and e.at <= coalesce(j.finished_at, now())
       and e.payload @> jsonb_build_object('failed', jsonb_build_array(jsonb_build_object('check', $2::text)))
     order by e.at`,
    [jobId, check],
  );
  if (found.length > 1) {
    throw new Error(
      `health drill: ${String(found.length)} health.failed events for ${check} fall in the job's run window, so none is claimed`,
    );
  }
  return found[0];
}

/**
 * Takes the drill's agent away: deletes the throwaway key (a revoked row would stay for ever on the database that
 * becomes production) and disables the `media_ops` role of the agent's user, which the next run enables again.
 */
export async function retireDrillAgent(db: Reader, keyId: string, email: string): Promise<void> {
  await db.rows("delete from public.agent_keys where id = $1::uuid", [keyId]);
  await db.rows(
    `update public.user_roles set disabled_at = now()
     where role = 'media_ops' and disabled_at is null
       and user_id in (select id from auth.users where lower(email) = $1)`,
    [email],
  );
}

export interface FailDrillRun {
  /** The database clock when the run began; only rows created at or after it are the run's. */
  start: string;
  /** The address of the bounce test (part 4). */
  address: string;
  /** The email of the drill's agent user. */
  agentEmail: string;
  /** The dead selftest job part 1 retried, when the run got that far. */
  jobId: string | undefined;
  /** The key the run made for its agent, when it got that far. */
  keyId: string | undefined;
}

/**
 * Everything the fail drill (H1-32) committed, removed in one pass: the agent's key and role, the bounce test's message
 * and `send_email` job (written only when the job runner secret exists), the retried dead job with its events, and the
 * agent's rate limits. Called whatever part ended the run, so a run that stopped early removes what it had made.
 */
export async function removeFailDrillRows(
  db: Pick<ProbeDb, "rows" | "cleanup">,
  run: FailDrillRun,
): Promise<void> {
  if (run.keyId !== undefined) await retireDrillAgent(db, run.keyId, run.agentEmail);
  const email = await emailDrillRows(db, run.address, run.start);
  const retried = run.jobId === undefined ? [] : [run.jobId];
  await db.cleanup({
    email_messages: email.email_messages ?? [],
    job_events: [
      ...(email.job_events ?? []),
      ...(await ids(
        db,
        "select id::text as id from public.job_events where job_id::text = any($1::text[])",
        [retried],
      )),
    ],
    jobs: [...(email.jobs ?? []), ...retried],
    rate_limits:
      run.keyId === undefined
        ? []
        : await ids(db, "select id::text as id from public.rate_limits where bucket = $1", [
            `agent:${run.keyId}`,
          ]),
  });
}
