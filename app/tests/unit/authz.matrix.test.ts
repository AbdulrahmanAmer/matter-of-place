import { describe, expect, it } from "vitest";
import {
  authorize,
  can,
  ForbiddenError,
  matrix,
  type ActionId,
  type AppRole,
  type Principal,
} from "../../src/server/lib/authz";

// The permissions matrix of B7 typed by hand (invariant 2): a matrix edit is a visible diff in two files. A slice that
// adds a group file adds its rows here in the same commit. After `|`: H humanOnly, R recentAuth, S scopeFree.
const FIXTURE = `
submissions.list                   CE ME VE MO CO AD
submissions.get                    CE ME VE MO CO AD
submissions.timeline               CE ME VE MO CO AD
submissions.start_review           CE ME
submissions.decline                CE ME
submissions.accept                 CE ME
submissions.request_assets         CE ME
submissions.assets_received        CE ME
submissions.email_preview          CE ME
submissions.decline_reasons        CE ME
submissions.note                   CE ME VE MO
properties.list                    CE ME VE MO CO AD
properties.get                     CE ME VE MO CO AD
properties.timeline                CE ME VE MO CO AD
properties.representatives         CE ME VE MO CO AD
properties.create_from_submission  CE ME VE
properties.update                  CE ME VE
properties.representative_put      CE ME VE
properties.preview_token           CE ME VE
properties.agent_preview           CE ME VE
properties.revoke_previews         CE ME VE
properties.publish                 CE ME
properties.unpublish               CE ME
properties.rank                    CE ME
media.list                         CE ME VE MO CO AD
media.variants_status              CE ME VE MO CO AD
media.upload_url                   CE ME VE
media.attach                       CE ME VE
media.reorder                      CE ME VE
media.alt                          CE ME VE
media.replace                      CE ME VE
media.delete                       CE ME VE
inquiries.list                     CE ME VE MO CO AD
inquiries.get                      CE ME VE MO CO AD
inquiries.assignees                CE ME VE MO CO AD
inquiries.assign                   CE ME
inquiries.forward                  CE ME
inquiries.close                    CE ME
stories.list                       CE ME VE MO CO AD
stories.get                        CE ME VE MO CO AD
stories.write                      CE ME VE
stories.publish                    CE ME
stories.unpublish                  CE ME
markets.list                       CE ME VE MO CO AD
markets.get                        CE ME VE MO CO AD
markets.edit                       CE ME
markets.coming_soon                CE ME
team.users_list                    AD | H R
team.invite                        AD | H R
team.role_grant                    AD | H R
team.role_revoke                   AD | H R
team.user_disable                  AD | H R
team.agent_create                  AD | H R
team.agent_key_create              AD | H R
team.agent_key_revoke              AD | H R
team.revoke_all_keys               AD | H R
team.limits_put                    AD | H R
settings.get                       AD | H R
settings.site_put                  AD | H R
settings.invoice_put               AD | H R
settings.coming_soon_put           AD | H R
settings.notifications_put         AD | H R
settings.redirects_get             AD | H R
settings.redirects_put             AD | H R
audit.list                         CE AD
audit.subject_requests             CE AD
audit.subject_export               AD | H R
audit.subject_delete               AD | H R
audit.subject_opt_out              AD | H R
audit.subject_status               AD | H R
automation.get                     CE ME VE MO CO AD
automation.recipes_put             CE MO AD
automation.templates_put           CE MO AD
automation.channels_put            CE MO AD
automation.schedules_put           CE MO AD
automation.dry_run                 CE MO AD
automation.reasons_put             CE ME AD
automation.revisions_restore       CE AD
automation.flags_put               AD | H
automation.templates_preview       CE ME MO AD
automation.templates_send_test     CE MO AD
dashboard.get                      CE ME VE MO CO AD
me                                 CE ME VE MO CO AD | S
`;

const ROLE: Record<string, AppRole> = {
  CE: "chief_editor",
  ME: "managing_editor",
  VE: "visual_editor",
  MO: "media_ops",
  CO: "commercial",
  AD: "admin",
};

const describeEntry = (
  action: string,
  roles: readonly string[],
  flags: { humanOnly?: boolean; recentAuth?: boolean; scopeFree?: boolean },
) =>
  [
    action,
    [...roles].sort().join(" "),
    flags.humanOnly ? "H" : "-",
    flags.recentAuth ? "R" : "-",
    flags.scopeFree ? "S" : "-",
  ].join(" ");

const fixtureRows = FIXTURE.trim()
  .split("\n")
  .map((line) => {
    const [left = "", flags = ""] = line.split("|");
    const [action = "", ...codes] = left.trim().split(/\s+/);
    return describeEntry(
      action,
      codes.map((code) => ROLE[code] ?? code),
      {
        humanOnly: flags.includes("H"),
        recentAuth: flags.includes("R"),
        scopeFree: flags.includes("S"),
      },
    );
  })
  .sort();

const actor = (kind: Principal["kind"], roles: AppRole[], scopes: string[] = []): Principal => ({
  kind,
  roles,
  scopes,
});

const refusalOf = (who: Principal, action: ActionId): string => {
  try {
    authorize(who, action);
    return "allowed";
  } catch (error) {
    return error instanceof ForbiddenError ? error.code : "not a ForbiddenError";
  }
};

describe("the authorization matrix", () => {
  it("equals the hand-typed fixture, row for row", () => {
    const live = matrix.map((entry) => describeEntry(entry.action, entry.roles, entry)).sort();
    expect(live).toEqual(fixtureRows);
  });

  it("names each action once and files it under its group", () => {
    const actions = matrix.map((entry) => entry.action);
    expect(new Set(actions).size).toBe(actions.length);
    expect(
      matrix.filter(
        (entry) => entry.action !== "me" && !entry.action.startsWith(`${entry.group}.`),
      ),
    ).toEqual([]);
  });

  it("refuses an agent on every team and settings action, whatever its role and scope", () => {
    const agent = actor("agent", ["admin"], ["team", "settings"]);
    const guarded = matrix.filter((entry) => ["team", "settings"].includes(entry.group));
    expect(guarded).toHaveLength(17);
    expect(guarded.map((entry) => refusalOf(agent, entry.action))).toEqual(
      guarded.map(() => "human_only"),
    );
  });

  it("humanOnly refuses an agent admin on a data-subject deletion and lets a human admin through", () => {
    expect(refusalOf(actor("agent", ["admin"], ["audit"]), "audit.subject_delete")).toBe(
      "human_only",
    );
    expect(refusalOf(actor("human", ["admin"]), "audit.subject_delete")).toBe("allowed");
  });

  it("gives an agent scoped to submissions out_of_scope on a publish its managing_editor role allows", () => {
    const agent = actor("agent", ["managing_editor"], ["submissions"]);
    expect(refusalOf(agent, "properties.publish")).toBe("out_of_scope");
    expect(refusalOf(actor("human", ["managing_editor"]), "properties.publish")).toBe("allowed");
  });

  it("lets an agent scoped to submissions read me and refuses dashboard.get as out_of_scope", () => {
    const agent = actor("agent", ["managing_editor"], ["submissions"]);
    expect(refusalOf(agent, "me")).toBe("allowed");
    expect(refusalOf(agent, "dashboard.get")).toBe("out_of_scope");
    expect(refusalOf(agent, "submissions.decline")).toBe("allowed");
  });

  it("refuses a roleless actor everywhere, me included", () => {
    expect(matrix.map((entry) => refusalOf(actor("human", []), entry.action))).toEqual(
      matrix.map(() => "forbidden"),
    );
  });

  it("refuses commercial on every decision and inquiry write", () => {
    const commercial = actor("human", ["commercial"]);
    expect(refusalOf(commercial, "submissions.decline")).toBe("forbidden");
    expect(refusalOf(commercial, "inquiries.forward")).toBe("forbidden");
    expect(refusalOf(commercial, "inquiries.list")).toBe("allowed");
  });

  it("can() answers what authorize() allows", () => {
    const actors = [
      actor("human", ["commercial"]),
      actor("human", ["visual_editor", "media_ops"]),
      actor("agent", ["chief_editor"], ["submissions", "properties"]),
    ];
    for (const who of actors) {
      const answers = matrix.map((entry) => can(who, entry.action));
      expect(answers).toEqual(matrix.map((entry) => refusalOf(who, entry.action) === "allowed"));
    }
  });
});
