// Role toolkits (operator, 2026-10-16: "all agents should be able to use their respective tooling, they are my agents,
// they run on this device and they should have access to what they need"; ruling H115, which replaces H101's blanket
// read-only mode). Each colleague's tools on the laptop, as data: the places it may read and write, the render scripts
// it may run, and whether it searches the web. The runner turns a toolkit into Claude Code permission rules for every
// run (`scripts/workforce/toolkit-args.ts`); the Office shows it in words. Never a blanket shell: a renderer is one
// named script with a local spec, nothing else.
import type { AgentTool } from "./workforce.ts";

/** The places a toolkit can name. The runner resolves each to a folder on the laptop. */
const places = {
  own_folder: "its own folder (the material it was woken for, and its drafts)",
  studio: "the studio (every piece of work, its brief and drafts)",
  knowledge: "the team's knowledge notes",
  drive_social: "Google Drive, Social Media (Carousels, Posts, Reels)",
} as const;
export type Place = keyof typeof places;

/** The render scripts a toolkit can name: each runs one local spec into a folder, with no network and no upload. */
export const renderers = {
  carousel: { script: "scripts/render-carousel.mjs", label: "renders a carousel" },
  post: { script: "scripts/render-cover.mjs", label: "renders a single post" },
  story: { script: "scripts/render-story.mjs", label: "renders a story" },
} as const;
type Renderer = keyof typeof renderers;

export interface Toolkit {
  read: readonly Place[];
  write: readonly Place[];
  render: readonly Renderer[];
}

const reader: Toolkit = {
  read: ["own_folder", "studio", "knowledge"],
  write: ["own_folder"],
  render: [],
};

/** Each colleague's toolkit by handle. A colleague not named here gets `baseToolkit`. */
const toolkits: Readonly<Record<string, Toolkit>> = {
  // Reviews requests: the facts and photographs of the request it was woken for, the editorial standard (site pages).
  editor: reader,
  // Answers inquiries: the inquiry's facts and the thread it belongs to.
  concierge: { read: ["own_folder", "knowledge"], write: ["own_folder"], render: [] },
  // Plans and drafts social posts: picks photographs, writes captions, renders the set, saves the finals to Drive.
  social: {
    read: ["own_folder", "studio", "knowledge"],
    write: ["own_folder", "studio", "drive_social"],
    render: ["carousel", "post", "story"],
  },
  // Builds Place Notes from published stories and properties (the runner delivers them).
  newsletter: reader,
  // Plans paid campaigns from interest by market and campaign data (the runner delivers them).
  campaigns: reader,
  // Reads the numbers (the runner delivers Search Console, GA4 and usage figures); web research stays as it is.
  analyst: { read: ["own_folder", "knowledge"], write: ["own_folder"], render: [] },
  // Coordinates the team.
  chief: reader,
};

const baseToolkit: Toolkit = { read: ["own_folder"], write: ["own_folder"], render: [] };

export function toolkitFor(slug: string): Toolkit {
  return toolkits[slug] ?? baseToolkit;
}

/**
 * A run about an outside message (an inquiry, a request, an email) keeps the triage of W8 0a: it reads its own folder
 * only, where the runner puts structured facts and photographs, never the person's own words, and writes and runs
 * nothing.
 */
export const outsideToolkit: Toolkit = { read: ["own_folder"], write: [], render: [] };

/** What a colleague may do, in the Office's words. */
export function toolkitWords(toolkit: Toolkit, tools: readonly AgentTool[]): string[] {
  const list = (items: readonly Place[]) => items.map((place) => places[place]).join("; ");
  return [
    `Reads ${list(toolkit.read)}.`,
    toolkit.write.length === 0 ? "Writes nothing." : `Writes ${list(toolkit.write)}.`,
    ...(toolkit.render.length === 0
      ? []
      : [
          `Runs ${toolkit.render.map((name) => renderers[name].label).join(", ")}, from a local spec.`,
        ]),
    ...(tools.includes("research") ? ["Searches the web."] : []),
    "No other command, no keys, nothing sent outside the company without a person's approval.",
  ];
}
