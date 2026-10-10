import { describe, expect, it } from "vitest";
import {
  emailDrillRows,
  healthEventOf,
  removeFailDrillRows,
  retireDrillAgent,
} from "../../scripts/harden/drill-rows";
import type { ProbeRows } from "../../scripts/harden/probe-db";

// H1 follow-ups (g7 steps 4 and 10): what the fail and health drills claim and remove after a run. The SQL itself is
// proved against the database in tests/db/harden-drill-rows.db.test.ts; here a recording stand-in for `ProbeDb.rows`
// shows which statements run, with which parameters, and what the helpers do with the answers.

interface Call {
  text: string;
  params: unknown[];
}

function recorder(answer: (call: Call) => Record<string, string | null>[]) {
  const calls: Call[] = [];
  return {
    calls,
    db: {
      rows: (text: string, params: unknown[] = []) => {
        const call = { text, params };
        calls.push(call);
        return Promise.resolve(answer(call));
      },
    },
  };
}

const START = "2026-10-11T10:00:00.000Z";
const ADDRESS = "bounced@resend.dev";

describe("healthEventOf", () => {
  it("asks for the events inside the job's own run window and passes the job id and the check", async () => {
    const { db, calls } = recorder(() => [{ id: "event-1" }]);
    expect(await healthEventOf(db, "job-1", "dead_jobs_24h")).toBe("event-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toEqual(["job-1", "dead_jobs_24h"]);
    expect(calls[0]?.text).toContain("e.at >= j.created_at");
    expect(calls[0]?.text).toContain("jsonb_build_object('check', $2::text)");
  });

  it("answers undefined when no event falls in the window", async () => {
    const { db } = recorder(() => []);
    expect(await healthEventOf(db, "job-1", "dead_jobs_24h")).toBeUndefined();
  });

  it("throws, and claims no event, when two events fall in the window", async () => {
    const { db } = recorder(() => [{ id: "event-1" }, { id: "event-2" }]);
    await expect(healthEventOf(db, "job-1", "dead_jobs_24h")).rejects.toThrow(
      /2 health\.failed events for dead_jobs_24h fall in the job's run window/,
    );
  });
});

describe("emailDrillRows", () => {
  it("returns the test message, the send_email job and the job's events, each found by what the run made", async () => {
    const { db, calls } = recorder(({ text }) => {
      if (text.includes("from public.email_messages where")) return [{ id: "message-1" }];
      if (text.includes("from public.jobs j")) return [{ id: "job-1" }];
      return [{ id: "job-event-1" }];
    });
    expect(await emailDrillRows(db, ADDRESS, START)).toEqual({
      email_messages: ["message-1"],
      jobs: ["job-1"],
      job_events: ["job-event-1"],
    });
    expect(calls.map((call) => call.params)).toEqual([
      [ADDRESS, START],
      [ADDRESS, START, ["message-1"]],
      [["job-1"]],
    ]);
  });

  it("finds a send_email job by the address in its payload, not only by a message", async () => {
    const { db, calls } = recorder(() => []);
    await emailDrillRows(db, ADDRESS, START);
    const jobQuery = calls.find((call) => call.text.includes("from public.jobs j"));
    expect(jobQuery?.text).toContain("j.type = 'send_email'");
    expect(jobQuery?.text).toContain("j.payload #>> '{data,actor_email}' = $1");
  });
});

describe("retireDrillAgent", () => {
  it("deletes the key row and disables the media_ops role of the agent's user, in that order", async () => {
    const { db, calls } = recorder(() => []);
    await retireDrillAgent(db, "key-1", "fail-drill-agent@mop.invalid");
    expect(calls.map((call) => call.params)).toEqual([["key-1"], ["fail-drill-agent@mop.invalid"]]);
    expect(calls[0]?.text).toContain("delete from public.agent_keys");
    expect(calls[1]?.text).toContain("update public.user_roles set disabled_at = now()");
    expect(calls[1]?.text).toContain("role = 'media_ops'");
  });
});

describe("removeFailDrillRows", () => {
  const RUN = {
    start: START,
    address: ADDRESS,
    agentEmail: "fail-drill-agent@mop.invalid",
    jobId: "job-dead",
    keyId: "key-1",
  };

  function world() {
    const calls: Call[] = [];
    const cleaned: ProbeRows[] = [];
    const db = {
      rows: (text: string, params: unknown[] = []) => {
        calls.push({ text, params });
        const first = params[0];
        let found: Record<string, string | null>[] = [];
        if (text.includes("from public.email_messages where")) found = [{ id: "message-1" }];
        else if (text.includes("from public.jobs j")) found = [{ id: "send-1" }];
        else if (text.includes("from public.job_events") && Array.isArray(first)) {
          if (first.includes("send-1")) found = [{ id: "event-send" }];
          else if (first.includes("job-dead")) found = [{ id: "event-dead" }];
        } else if (text.includes("from public.rate_limits")) found = [{ id: "limit-1" }];
        return Promise.resolve(found);
      },
      cleanup: (rows: ProbeRows) => {
        cleaned.push(rows);
        return Promise.resolve();
      },
    };
    return { db, calls, cleaned };
  }

  it("removes the bounce test's message and job, the retried job and its events, and the agent's limits", async () => {
    const { db, cleaned } = world();
    await removeFailDrillRows(db, RUN);
    expect(cleaned).toEqual([
      {
        email_messages: ["message-1"],
        job_events: ["event-send", "event-dead"],
        jobs: ["send-1", "job-dead"],
        rate_limits: ["limit-1"],
      },
    ]);
  });

  it("deletes the agent's key and disables its role before it removes the rows", async () => {
    const { db, calls } = world();
    await removeFailDrillRows(db, RUN);
    expect(calls[0]?.text).toContain("delete from public.agent_keys");
    expect(calls[0]?.params).toEqual(["key-1"]);
    expect(calls[1]?.text).toContain("update public.user_roles");
    expect(calls[1]?.params).toEqual(["fail-drill-agent@mop.invalid"]);
  });

  it("removes only the email rows when the run stopped before it made a job or an agent", async () => {
    const { db, calls, cleaned } = world();
    await removeFailDrillRows(db, { ...RUN, jobId: undefined, keyId: undefined });
    expect(cleaned).toEqual([
      {
        email_messages: ["message-1"],
        job_events: ["event-send"],
        jobs: ["send-1"],
        rate_limits: [],
      },
    ]);
    expect(calls.some((call) => call.text.includes("delete from public.agent_keys"))).toBe(false);
  });
});
