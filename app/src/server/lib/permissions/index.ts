import { audit } from "./audit.ts";
import { automation } from "./automation.ts";
import { dashboard } from "./dashboard.ts";
import { inquiries } from "./inquiries.ts";
import { markets } from "./markets.ts";
import { media } from "./media.ts";
import { payments } from "./payments.ts";
import { people } from "./people.ts";
import { properties } from "./properties.ts";
import { settings } from "./settings.ts";
import { stories } from "./stories.ts";
import { submissions } from "./submissions.ts";
import { team } from "./team.ts";

// One import line per group file; a later slice adds its own (B8 jobs).
export const permissions = [
  ...submissions,
  ...properties,
  ...media,
  ...inquiries,
  ...stories,
  ...markets,
  ...team,
  ...settings,
  ...audit,
  ...automation,
  ...dashboard,
  ...payments,
  ...people,
] as const;
