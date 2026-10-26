import { describe, expect, it } from "vitest";
import { requestStatusLines, requestTimeline, timelineLabels } from "../../src/domain/account";
import { submissionStates, type SubmissionState } from "../../src/domain/contracts";

// W6 item 8: a request as a timeline, from the day we received it to the live page, in the client's words.

const dates = {
  received_at: "2026-10-01T10:00:00+00:00",
  reviewed_at: "2026-10-02T10:00:00+00:00",
  accepted_at: "2026-10-03T10:00:00+00:00",
  published_at: "2026-10-09T10:00:00+00:00",
};

const read = (workflow_state: SubmissionState) =>
  requestTimeline({ ...dates, workflow_state }).map((step) => `${step.label}: ${step.status}`);

describe("requestTimeline", () => {
  it("marks the steps passed, the one a request is at, and those still to come", () => {
    expect(read("Under Review")).toEqual([
      "Received: done",
      "Under review: current",
      "Accepted: upcoming",
      "Invoice: upcoming",
      "Live on the site: upcoming",
      "Complete: upcoming",
    ]);
    expect(read("Invoice Issued")).toEqual([
      "Received: done",
      "Under review: done",
      "Accepted: done",
      "Invoice: current",
      "Live on the site: upcoming",
      "Complete: upcoming",
    ]);
    expect(read("Published")).toEqual([
      "Received: done",
      "Under review: done",
      "Accepted: done",
      "Invoice: done",
      "Live on the site: current",
      "Complete: upcoming",
    ]);
  });

  it("waiting for photographs is the accepted step, and a distribution that runs is the live step", () => {
    expect(read("Awaiting Assets")).toEqual(read("Accepted"));
    expect(read("Distribution Active")).toEqual(read("Published"));
  });

  it("a completed request has nothing in progress", () => {
    expect(read("Completed")).toEqual(timelineLabels.map((label) => `${label}: done`));
  });

  it("a declined request shows the steps it passed and then says it was not taken on", () => {
    expect(read("Declined")).toEqual([
      "Received: done",
      "Under review: done",
      "Not taken on: ended",
    ]);
  });

  it("a withdrawn request stops where it was received", () => {
    expect(read("Withdrawn")).toEqual(["Received: done", "Withdrawn: ended"]);
  });

  it("carries the day a step was reached where the record holds it, and none for a step to come", () => {
    const steps = requestTimeline({ ...dates, workflow_state: "Published" });
    expect(steps.map((step) => step.at)).toEqual([
      dates.received_at,
      dates.reviewed_at,
      dates.accepted_at,
      null,
      dates.published_at,
      null,
    ]);
    const early = requestTimeline({ ...dates, workflow_state: "Submitted" });
    expect(early.map((step) => step.at)).toEqual([dates.received_at, null, null, null, null, null]);
  });

  it("has one current step for a request in progress and none for a finished one, in every state", () => {
    for (const state of submissionStates) {
      const current = requestTimeline({ ...dates, workflow_state: state }).filter(
        (step) => step.status === "current",
      );
      const finished = ["Completed", "Declined", "Withdrawn"].includes(state);
      expect({ state, current: current.length }).toEqual({ state, current: finished ? 0 : 1 });
    }
  });

  it("has a sentence for every state a request can be in", () => {
    expect(Object.keys(requestStatusLines).sort()).toEqual([...submissionStates].sort());
  });
});
