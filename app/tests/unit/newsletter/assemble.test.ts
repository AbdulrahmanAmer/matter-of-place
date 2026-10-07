import { describe, expect, it } from "vitest";
import {
  assemble,
  collectCandidates,
  mergeDraft,
  readIssues,
  type Candidate,
} from "../../../src/server/newsletter/assemble";
import {
  assetRow,
  issueRow,
  newsletterDb,
  propertyBlock,
  propertyRow,
  storyBlock,
  storyRow,
  uuid,
  type Row,
} from "../../fixtures/newsletter-world";

// Place Notes assembly (B11 Contract 1, invariant 7): what goes into the next issue, and that a human's edit and an
// issue already approved are never overwritten. `newsletter_save_draft` answers like the SQL function of step 4.

const JOB = "7a1d0c2e-0000-4000-8000-000000000001";
function world(tables: Record<string, Row[]>) {
  return newsletterDb(tables, {
    newsletter_save_draft: () => ({ id: uuid(900), number: 1 }),
  });
}

const saveArgs = (calls: ReturnType<typeof world>) =>
  calls.rpcCalls("newsletter_save_draft").map((call) => call.args[0]);

describe("assemble", () => {
  it("returns a null issue and saves nothing with no candidate and no open draft", async () => {
    const w = world({});
    expect(await assemble(w.db, JOB)).toEqual({ issue_id: null });
    expect(w.rpcCalls("newsletter_save_draft")).toEqual([]);
  });

  it("returns the open draft and keeps its add-mode block when no candidate is new", async () => {
    const block = propertyBlock(1);
    const w = world({
      newsletter_issues: [issueRow({ blocks: [block] })],
      assets: [assetRow(1, 1)],
      properties: [propertyRow(1)],
    });
    expect(await assemble(w.db, JOB)).toEqual({ issue_id: uuid(900), number: 1 });
    expect(saveArgs(w)).toEqual([
      {
        p_blocks: [block],
        p_subject: "Place Notes No. 1: Oak Hill",
        p_preheader: "A quiet street.",
        p_actor: null,
        p_actor_kind: null,
        p_request_id: JOB,
      },
    ]);
  });

  it("saves nothing when the draft already holds the candidates and its subject and preheader are built", async () => {
    const w = world({
      newsletter_issues: [
        issueRow({
          blocks: [propertyBlock(1)],
          subject: "Place Notes No. 1: Oak Hill",
          preheader: "A quiet street.",
        }),
      ],
      assets: [assetRow(1, 1)],
      properties: [propertyRow(1)],
    });
    expect(await assemble(w.db, JOB)).toEqual({ issue_id: uuid(900), number: 1 });
    expect(w.rpcCalls("newsletter_save_draft")).toEqual([]);
  });

  it("keeps a subject a human edited and appends the new candidate", async () => {
    const w = world({
      newsletter_issues: [issueRow({ blocks: [propertyBlock(1)], subject: "Our own subject" })],
      assets: [assetRow(2, 1)],
      properties: [propertyRow(2)],
    });
    await assemble(w.db, JOB);
    const [args] = saveArgs(w);
    expect(args).toMatchObject({ p_subject: "Our own subject", p_preheader: "A quiet street." });
    expect(args).toHaveProperty("p_blocks", [
      propertyBlock(1),
      {
        id: `property:${uuid(2)}`,
        type: "property",
        property_id: uuid(2),
        asset_id: uuid(21),
        title: "Property 2 revision 1",
        deck: "A quiet street.",
      },
    ]);
  });

  it("numbers a new draft after the last issue and writes a system row", async () => {
    const w = newsletterDb(
      {
        newsletter_issues: [
          issueRow({
            id: uuid(901),
            number: 4,
            status: "sent",
            sent_at: "2026-09-01T00:00:00.000Z",
          }),
        ],
        assets: [assetRow(1, 1)],
        properties: [propertyRow(1)],
      },
      { newsletter_save_draft: () => ({ id: uuid(902), number: 5 }) },
    );
    expect(await assemble(w.db, JOB)).toEqual({ issue_id: uuid(902), number: 5 });
    expect(saveArgs(w)[0]).toMatchObject({
      p_subject: "Place Notes No. 5: Property 1 revision 1",
      p_actor: null,
      p_actor_kind: null,
    });
  });

  it("throws when the save fails, so the runner backs off", async () => {
    const w = newsletterDb(
      { assets: [assetRow(1, 1)], properties: [propertyRow(1)] },
      { newsletter_save_draft: () => new Error("down") },
    );
    await expect(assemble(w.db, JOB)).rejects.toThrow("newsletter_save_draft_failed");
  });
});

describe("collectCandidates", () => {
  const collect = async (tables: Record<string, Row[]>, issues: Row[] = []) => {
    const w = world({ newsletter_issues: issues, ...tables });
    return collectCandidates(w.db, await readIssues(w.db));
  };

  it("skips an unpublished property and a taken-down one", async () => {
    const candidates = await collect({
      assets: [assetRow(1, 1), assetRow(2, 1), assetRow(3, 1)],
      properties: [
        propertyRow(1),
        propertyRow(2, { editorial_state: "review" }),
        propertyRow(3, { taken_down_at: "2026-10-04T00:00:00.000Z" }),
      ],
    });
    expect(candidates.map(({ block }) => block.id)).toEqual([`property:${uuid(1)}`]);
  });

  it("takes only the highest approved revision of a property", async () => {
    const candidates = await collect({
      assets: [assetRow(1, 1), assetRow(1, 3), assetRow(1, 2)],
      properties: [propertyRow(1)],
    });
    expect(candidates.map(({ block }) => block)).toMatchObject([
      { asset_id: uuid(13), title: "Property 1 revision 3" },
    ]);
  });

  it("leaves out a property that is not approved or not a newsletter block", async () => {
    const candidates = await collect({
      assets: [assetRow(1, 1, { status: "pending" }), assetRow(2, 1, { kind: "cover" })],
      properties: [propertyRow(1), propertyRow(2)],
    });
    expect(candidates).toEqual([]);
  });

  it("leaves out what an approved, sending or sent issue already holds, and not what a draft holds", async () => {
    const candidates = await collect(
      {
        assets: [1, 2, 3, 4].map((n) => assetRow(n, 1)),
        properties: [1, 2, 3, 4].map((n) => propertyRow(n)),
        stories: [storyRow(7), storyRow(8)],
      },
      [
        issueRow({
          id: uuid(901),
          number: 1,
          status: "approved",
          blocks: [propertyBlock(1), storyBlock(7)],
        }),
        issueRow({ id: uuid(902), number: 2, status: "sending", blocks: [propertyBlock(2)] }),
        issueRow({ id: uuid(903), number: 3, status: "draft", blocks: [propertyBlock(3)] }),
      ],
    );
    expect(candidates.map(({ block }) => block.id)).toEqual([
      `property:${uuid(3)}`,
      `property:${uuid(4)}`,
      `story:${uuid(8)}`,
    ]);
  });

  it("reads only what came after the last sent issue", async () => {
    const candidates = await collect(
      {
        assets: [
          assetRow(1, 1, { approved_at: "2026-09-01T00:00:00.000Z" }),
          assetRow(2, 1, { approved_at: "2026-10-03T00:00:00.000Z" }),
        ],
        properties: [propertyRow(1), propertyRow(2)],
        stories: [
          storyRow(7, { published_at: "2026-09-01T00:00:00.000Z" }),
          storyRow(8, { published_at: "2026-10-03T00:00:00.000Z" }),
        ],
      },
      [issueRow({ id: uuid(901), status: "sent", sent_at: "2026-09-15T00:00:00.000Z" })],
    );
    expect(candidates.map(({ block }) => block.id)).toEqual([
      `property:${uuid(2)}`,
      `story:${uuid(8)}`,
    ]);
  });

  it("leaves out an unpublished or archived story", async () => {
    const candidates = await collect({
      stories: [
        storyRow(7, { editorial_state: "draft" }),
        storyRow(8, { archived_at: "2026-10-03T00:00:00.000Z" }),
      ],
    });
    expect(candidates).toEqual([]);
  });
});

describe("mergeDraft", () => {
  const candidate = (block: Candidate["block"], campaign = false): Candidate => ({
    block,
    publishedAt: "2026-10-03T09:00:00.000Z",
    campaign,
  });
  const draft = { number: 2, blocks: [], subject: null, preheader: null };

  it("keeps the draft's blocks and their intro text in order, and appends only the new ones", () => {
    const intro = { id: "intro", type: "intro" as const, text: "Two homes this fortnight." };
    const held = { ...propertyBlock(1), text: "Our pick." };
    const merged = mergeDraft({ ...draft, blocks: [intro, held] }, [
      candidate(propertyBlock(1)),
      candidate(propertyBlock(2)),
    ]);
    expect(merged.added).toBe(1);
    expect(merged.blocks.map((block) => block.id)).toEqual([
      "intro",
      `property:${uuid(1)}`,
      `property:${uuid(2)}`,
    ]);
    expect(merged.blocks[1]).toMatchObject({ text: "Our pick." });
  });

  it("rebuilds the subject and preheader from the merged list when the draft holds the built ones", () => {
    const merged = mergeDraft(
      {
        ...draft,
        subject: "Place Notes No. 2",
        preheader: "",
      },
      [candidate(propertyBlock(1, "Oak Hill", "A quiet street."))],
    );
    expect(merged).toMatchObject({
      subject: "Place Notes No. 2: Oak Hill",
      preheader: "A quiet street.",
    });
  });

  it("puts a Campaign property before a newer plain one, and stories last", () => {
    const merged = mergeDraft(draft, [
      candidate(storyBlock(7)),
      { ...candidate(propertyBlock(1)), publishedAt: "2026-10-05T00:00:00.000Z" },
      candidate(propertyBlock(2), true),
    ]);
    expect(merged.blocks.map((block) => block.id)).toEqual([
      `property:${uuid(2)}`,
      `property:${uuid(1)}`,
      `story:${uuid(7)}`,
    ]);
  });
});
