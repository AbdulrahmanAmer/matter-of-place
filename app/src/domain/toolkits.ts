// Role toolkits (operator, 2026-10-16: "all agents should be able to use their respective tooling, they are my agents,
// they run on this device and they should have access to what they need"; ruling H115, which replaces H101's blanket
// read-only mode). Each colleague's tools on the laptop, as data: the places it may read and write, the render scripts
// it may run, and whether it searches the web. The runner turns a toolkit into Claude Code permission rules for every
// run (`scripts/workforce/toolkit-args.ts`); the Office shows it in words. Never a shell: a renderer is one named
// script with a local spec, which the runner runs on the colleague's request.
import type { AgentTool } from "./workforce.ts";

/** The places a toolkit can read or write. The runner resolves each to a folder on the laptop. */
const places = {
  own_folder: "its own folder (the material it was woken for, and its drafts)",
  knowledge: "the team's knowledge notes",
  drive_social: "Google Drive, Social Media (Carousels, Posts, Reels)",
} as const;
export type Place = keyof typeof places;

/**
 * The places a run may write: never one the runner later reads as a prompt, runs code from or loads config from
 * (review of 2026-10-19). The knowledge notes go into every colleague's prompt; the studio is not a place at all.
 */
type WritePlace = Extract<Place, "own_folder" | "drive_social">;

/**
 * Where the runner takes the photographs of a piece a person's line names, into the run's own folder
 * (`scripts/workforce/placement.ts`). The studio is never a place a colleague reads or writes (review of 2026-10-19):
 * the reel engine runs and loads what its folders hold, and a request's folder keeps the links its submitter typed.
 */
const pieceSources = {
  studio: "the studio",
  drive_social: "Google Drive, Social Media",
} as const;
type PieceSource = keyof typeof pieceSources;

/**
 * The render scripts a toolkit can name: each runs one local spec into a folder, with no network and no upload. A
 * colleague never runs them: it names one in its answer and the runner renders it after the run, through the wrapper's
 * checks (`renderPlan` in `scripts/workforce/render-run.mjs`).
 */
export const renderers = {
  carousel: { script: "scripts/render-carousel.mjs", label: "a carousel" },
  post: { script: "scripts/render-cover.mjs", label: "a single post" },
  story: { script: "scripts/render-story.mjs", label: "a story" },
} as const;
export type Renderer = keyof typeof renderers;

export interface Toolkit {
  read: readonly Place[];
  write: readonly WritePlace[];
  render: readonly Renderer[];
  /** Where the runner takes a named piece's photographs from, on a run a person started. */
  pieces: readonly PieceSource[];
}

const reader: Toolkit = {
  read: ["own_folder", "knowledge"],
  write: ["own_folder"],
  render: [],
  pieces: ["studio"],
};

/** Each colleague's toolkit by handle. A colleague not named here gets `baseToolkit`. */
const toolkits: Readonly<Record<string, Toolkit>> = {
  // Reviews requests: the facts and photographs of the request it was woken for, the editorial standard (site pages).
  editor: reader,
  // Answers inquiries: the inquiry's facts and the thread it belongs to.
  concierge: { read: ["own_folder", "knowledge"], write: ["own_folder"], render: [], pieces: [] },
  // Plans and drafts social posts: picks photographs, writes captions, has the set rendered, saves finals to Drive.
  social: {
    read: ["own_folder", "knowledge"],
    write: ["own_folder", "drive_social"],
    render: ["carousel", "post", "story"],
    pieces: ["studio", "drive_social"],
  },
  // Builds Place Notes from published stories and properties (the runner delivers them).
  newsletter: reader,
  // Plans paid campaigns from interest by market and campaign data (the runner delivers them).
  campaigns: reader,
  // Reads the numbers (the runner delivers Search Console, GA4 and usage figures); web research stays as it is.
  analyst: { read: ["own_folder", "knowledge"], write: ["own_folder"], render: [], pieces: [] },
  // Coordinates the team.
  chief: reader,
};

const baseToolkit: Toolkit = {
  read: ["own_folder"],
  write: ["own_folder"],
  render: [],
  pieces: [],
};

export function toolkitFor(slug: string): Toolkit {
  // an own key only: a handle such as `constructor` or `__proto__` is no way to another toolkit
  return Object.hasOwn(toolkits, slug) ? (toolkits[slug] ?? baseToolkit) : baseToolkit;
}

/**
 * A run about an outside message (an inquiry, a request, an email) keeps the triage of W8 0a: it reads only a folder of
 * its own, made empty for that run (`desks/<slug>/outside/<run id>`), never the work folder where other runs leave
 * drafts, and writes and runs nothing. The runner puts nothing there yet: placing the facts and photographs is NOT DONE.
 */
export const outsideToolkit: Toolkit = { read: ["own_folder"], write: [], render: [], pieces: [] };

/**
 * A run no person started (an event, a schedule, a colleague's mention) may read a line that carried outside words, so
 * it gets its toolkit's reads only: it writes and renders nothing, and no photographs are placed for it (review of
 * 2026-10-16, H113's history rule).
 */
export function readOnly(toolkit: Toolkit): Toolkit {
  return { read: toolkit.read, write: [], render: [], pieces: [] };
}

/** "a, b and c" */
export function series(items: readonly string[]): string {
  return items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

/** What a colleague may do on a run a person started, in the Office's words (the colleague's card). */
export function toolkitWords(toolkit: Toolkit, tools: readonly string[]): string[] {
  const list = (items: readonly Place[]) => items.map((place) => places[place]).join("; ");
  return [
    `Reads ${list(toolkit.read)}.`,
    ...(toolkit.pieces.length === 0
      ? []
      : [
          `Gets the photographs of a piece a person names, from ${series(toolkit.pieces.map((source) => pieceSources[source]))}, in its own folder.`,
        ]),
    toolkit.write.length === 0 ? "Writes nothing." : `Writes ${list(toolkit.write)}.`,
    ...(toolkit.render.length === 0
      ? []
      : [
          `Has the runner render ${series(toolkit.render.map((name) => renderers[name].label))}, from a spec in its folder.`,
        ]),
    ...(tools.includes("research" satisfies AgentTool) ? ["Searches the web."] : []),
    ...(toolkit.write.length === 0 && toolkit.render.length === 0
      ? []
      : ["Writes and renders only on work a person started; otherwise it only reads."]),
    // no shell for anyone (GOTCHAS P-4511): deny rules on the real CLI never stopped a redirect from a read-only command
    "No command, no keys, nothing sent outside the company without a person's approval.",
  ];
}
