import { describe, expect, it } from "vitest";
import {
  checkResetTarget,
  cronJobNames,
  findForeignMigrations,
  isLocalDbUrl,
} from "../../scripts/lib/reset-guard.mjs";

const REF = "hbokkmpgpqhrnemgsqra";
const OTHER = "abcdefghijklmnopqrst";

describe("checkResetTarget", () => {
  it("passes when the linked ref, DEV_SUPABASE_PROJECT_REF and the DEV_DB_URL user are equal", () => {
    expect(() => {
      checkResetTarget({ linkedRef: REF, envRef: REF, dbUrlUser: `postgres.${REF}` });
    }).not.toThrow();
  });

  it.each([
    { name: "linked ref differs", linkedRef: OTHER, envRef: REF, dbUrlUser: `postgres.${REF}` },
    { name: "env ref differs", linkedRef: REF, envRef: OTHER, dbUrlUser: `postgres.${REF}` },
    {
      name: "DEV_DB_URL user differs",
      linkedRef: REF,
      envRef: REF,
      dbUrlUser: `postgres.${OTHER}`,
    },
    { name: "nothing linked", linkedRef: undefined, envRef: REF, dbUrlUser: `postgres.${REF}` },
    { name: "env ref unset", linkedRef: REF, envRef: undefined, dbUrlUser: `postgres.${REF}` },
    { name: "DEV_DB_URL unset", linkedRef: REF, envRef: REF, dbUrlUser: undefined },
    { name: "all three unset", linkedRef: undefined, envRef: undefined, dbUrlUser: undefined },
    { name: "DEV_DB_URL user has no ref", linkedRef: REF, envRef: REF, dbUrlUser: "postgres" },
  ])("refuses: $name", ({ linkedRef, envRef, dbUrlUser }) => {
    expect(() => {
      checkResetTarget({ linkedRef, envRef, dbUrlUser });
    }).toThrow(/^refusing: ref mismatch/);
  });
});

describe("findForeignMigrations", () => {
  it("returns the applied versions that have no local file", () => {
    expect(
      findForeignMigrations(
        ["20261001090000", "20261001100000"],
        ["20261001090000_extensions_enums.sql"],
      ),
    ).toEqual(["20261001100000"]);
  });

  it("returns nothing when every applied version has a file", () => {
    expect(
      findForeignMigrations(
        ["20261001090000", "20261001090100"],
        [
          "20261001090000_extensions_enums.sql",
          "20261001090100_people_audit.sql",
          "20261001090200_role_helpers.sql",
        ],
      ),
    ).toEqual([]);
  });
});

describe("isLocalDbUrl", () => {
  it.each([
    { url: "postgresql://postgres:postgres@127.0.0.1:54322/postgres", local: true },
    {
      url: `postgresql://postgres.${REF}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
      local: false,
    },
    { url: "postgresql://postgres:postgres@localhost.evil.example:54322/postgres", local: false },
    { url: "postgresql://postgres:postgres@127.0.0.1.evil.example:54322/postgres", local: false },
    { url: "not a url", local: false },
  ])("isLocalDbUrl $url is $local", ({ url, local }) => {
    expect(isLocalDbUrl(url)).toBe(local);
  });
});

describe("cronJobNames", () => {
  it("finds every scheduled job name across the migration texts", () => {
    expect(
      cronJobNames([
        "select cron.schedule('analytics-partitions', '0 2 20 * *', '...');",
        "select cron.schedule( 'retention', '0 3 * * *', $$select 1$$);\nselect cron.schedule('analytics-partitions', '0 2 20 * *', '...');",
      ]),
    ).toEqual(["analytics-partitions", "retention"]);
  });
});
