import { describe, expect, it } from "vitest";
import { checkLayout } from "../../scripts/check-layout.mjs";

describe("checkLayout", () => {
  it("passes files that sit in their row of the folder map", () => {
    const paths = [
      "app/src/server/jobs/steps/send-email.ts",
      "app/src/admin/properties/PublishBar.tsx",
      "app/src/assets/gallery/x.jpg",
      "app/.env.example",
      "app/backup-recipient.pem",
      "app/docs/runbooks/delivery.md",
      "app/src/components/layout/README.md",
    ];
    expect(checkLayout(paths)).toEqual([]);
  });

  it.each([
    ["app/src/server/widgets/service.ts", "outside the folder map"],
    ["app/src/helpers/x.ts", "outside the folder map"],
    ["app/notes.md", "outside the folder map"],
    ["app/.github/workflows/ci.yml", "outside the folder map"],
    ["app/debug.log", "banned: log"],
    ["app/src/components/site/shot.png", "banned: screenshot or render"],
    ["launch/film/frames/0001.png", "banned: screenshot or render"],
    ["app/.env", "banned: secret"],
    ["creds/backup-recipient.key", "banned: secret"],
    ["app/key.pem", "banned: secret"],
    ["workspace/scratch/x.md", "banned: scratch"],
  ])("refuses %s", (path, reason) => {
    expect(checkLayout([path])).toEqual([{ path, reason }]);
  });
});
