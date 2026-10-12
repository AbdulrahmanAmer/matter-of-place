import { describe, expect, it } from "vitest";
import { emailTemplateKeys } from "../../src/domain/email";
import { emailWords } from "../../src/admin/automation/email-words";
import { jobName, jobNames } from "../../src/admin/jobs/job-words";
import { stepTypes } from "../../src/server/automation/step-specs";
import { listSystemJobs } from "../../src/server/jobs/system/index";

// Admin pass (2026-10-12): every job and every email the admin shows has a plain name, so a new step, system job or
// template can never reach the operator as `meta_token_refresh` or `inquiry_ack`.

describe("the plain names of the admin", () => {
  it("names every step and every system job the runner knows", () => {
    const types = [...stepTypes, ...listSystemJobs().map((job) => job.type)];
    expect(types.filter((type) => !(type in jobNames))).toEqual([]);
    expect([jobName("reconcile"), jobName("a_new_job")]).toEqual(["Upload check", "a new job"]);
  });

  it("names every email template, with who receives it", () => {
    expect(
      emailTemplateKeys.filter(
        (key) => emailWords[key].name.trim() === "" || emailWords[key].to.trim() === "",
      ),
    ).toEqual([]);
    expect(Object.keys(emailWords).sort()).toEqual([...emailTemplateKeys].sort());
  });
});
