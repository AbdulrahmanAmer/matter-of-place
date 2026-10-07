// Place Notes test tool. Step 5 holds one mode; step 8 adds the sends against `mop-dev`.
//   bun run scripts/newsletter-test-send.ts --dry   draws a fixed sample issue into .tmp/issue.html
// `--dry` opens no database and needs no key: it renders a sample issue with a stub site context.
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { SiteContext } from "../src/server/email/context.ts";
import { renderIssueHtml, type RenderIssue } from "../src/server/newsletter/render.ts";

const OUT_DIR = ".tmp";
const OUT_FILE = `${OUT_DIR}/issue.html`;

const site: SiteContext = {
  siteUrl: "https://matterofplace.com",
  entity: "Sample legal entity",
  address: "Sample postal address",
  contact: { email: null },
};

// A property block joins the sample when B9's `NewsletterBlock.tsx` is on main (B9 steps 7 to 11).
const sample: RenderIssue = {
  number: 4,
  subject: "Place Notes No. 4: A house on the water",
  preheader: "Two stories from the fortnight.",
  blocks: [
    {
      id: "b1",
      type: "intro",
      text: "Two stories from the last two weeks.\nThe next issue follows in a fortnight.",
    },
    {
      id: "b2",
      type: "story",
      story_id: "0b6a5c1e-3f4d-4b8a-9c2e-5d7f1a2b3c4d",
      slug: "a-house-on-the-water",
      title: "A house on the water",
      deck: "How a shoreline home keeps its original plan.",
      text: "This one begins at the dock.",
    },
    {
      id: "b3",
      type: "story",
      story_id: "7c1d9e2f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
      slug: "the-quiet-street",
      title: "The quiet street",
      deck: "",
    },
  ],
};

const { values } = parseArgs({ options: { dry: { type: "boolean" } } });
if (values.dry !== true) {
  console.error("usage: bun run scripts/newsletter-test-send.ts --dry");
  process.exit(64);
}
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, await renderIssueHtml(sample, site));
console.log(`wrote ${OUT_FILE}`);
