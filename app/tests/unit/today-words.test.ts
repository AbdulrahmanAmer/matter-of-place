import { describe, expect, it } from "vitest";
import { actionWords, checkWords } from "../../src/admin/dashboard/today-words";

// W3 stage 4: the Today page says a failed check and a logged action in words, never as an id.
describe("today words", () => {
  it("says a failed check in words, and an unknown one readably", () => {
    expect([checkWords("retention_stalled"), checkWords("new_check")]).toEqual([
      "the nightly clean-up had not run",
      "new check",
    ]);
  });

  it("says a logged action in words, and an unknown one readably", () => {
    expect([actionWords("automation.schedules_put"), actionWords("stories.archive_all")]).toEqual([
      "Changed a schedule",
      "Stories: archive all",
    ]);
  });
});
