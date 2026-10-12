// `bun scripts/matter/atlas.ts [--out <file>]`: writes Matter's atlas, the map of everything it can reach (plan W2,
// step 1). Matter has no session; every run starts from this file, regenerated from the code itself, so it can
// never describe a screen, action or route that does not exist. It is short on purpose (Jay, 2026-10-12: an index
// plus the one section a run needs, stamped with its age): one line per item, grouped, with the paths to read for
// detail. Default output: %USERPROFILE%\.mop-workforce\matter\atlas.md.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { navEntries } from "../../src/admin/nav.ts";
import { eventTypes } from "../../src/domain/events.ts";
import { wakeLabels } from "../../src/domain/workforce.ts";
import { stepSpecs, stepTypes } from "../../src/server/automation/step-specs.ts";
import { permissions } from "../../src/server/lib/permissions/index.ts";

const app = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** The admin API: one line per route file, its path as TanStack builds it from the file name. */
function apiRoutes(): string[] {
  const dir = join(app, "src/routes/api/admin");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map(
      (name) =>
        `/api/admin/${name
          .replace(/\.ts$/, "")
          .replace(/\.index$/, "")
          .replace(/\[\.\]/g, "~dot~")
          .replace(/\./g, "/")
          .replace(/~dot~/g, ".")}`,
    )
    .sort();
}

/** The methods a route file answers, read from its `handlers` block. */
function methodsOf(path: string): string {
  const file = join(
    app,
    "src/routes/api/admin",
    `${path.replace("/api/admin/", "").replace(/\//g, ".")}.ts`,
  );
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    try {
      text = readFileSync(file.replace(/\.ts$/, ".index.ts"), "utf8");
    } catch {
      return "";
    }
  }
  return [...text.matchAll(/^\s+(GET|POST|PUT|PATCH|DELETE): defineAdminRoute/gm)]
    .map((match) => match[1])
    .join(",");
}

/** Skills by folder name: the project's own and the operator's global ones on this laptop. */
function skills(): string[] {
  const roots = [join(app, "../.claude/skills"), join(homedir(), ".claude/skills")];
  const names = new Set<string>();
  for (const root of roots) {
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory()) names.add(entry.name);
      }
    } catch {
      // A missing folder holds no skills.
    }
  }
  return [...names].sort();
}

function packageScripts(): string[] {
  const json: unknown = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  const scripts =
    typeof json === "object" && json !== null && "scripts" in json ? json.scripts : undefined;
  return typeof scripts === "object" && scripts !== null ? Object.keys(scripts).sort() : [];
}

export function atlas(now: Date = new Date()): string {
  const screens = navEntries
    .filter((entry) => entry.hidden !== true && entry.group !== undefined)
    .map(
      (entry) => `- ${entry.group ?? ""} / ${entry.label}: https://matterofplace.com${entry.path}`,
    );
  const actionsByGroup = new Map<string, string[]>();
  for (const entry of permissions) {
    const flags = [
      "humanOnly" in entry ? "person only" : "",
      "recentAuth" in entry ? "recent sign-in" : "",
    ].filter((flag) => flag !== "");
    const list = actionsByGroup.get(entry.group) ?? [];
    list.push(`${entry.action}${flags.length === 0 ? "" : ` (${flags.join(", ")})`}`);
    actionsByGroup.set(entry.group, list);
  }
  const routes = apiRoutes().map((path) => {
    const methods = methodsOf(path);
    return `- ${methods === "" ? "" : `${methods} `}${path}`;
  });
  const steps = stepTypes.map((type) => `- ${type}: ${stepSpecs[type].label}`);
  const events = eventTypes.map((type) => `- ${type}: ${wakeLabels[type]}`);
  return [
    `# Matter's atlas`,
    ``,
    `Generated ${now.toISOString()} from the code on main (scripts/matter/atlas.ts). If this is more than a day old,`,
    `say so before relying on it.`,
    ``,
    `## Index`,
    `1 Admin screens · 2 Admin actions (the permission matrix) · 3 Admin API · 4 Events that wake employees ·`,
    `5 Automation steps · 6 Commands · 7 Skills · 8 Where to read more`,
    ``,
    `## 1 Admin screens`,
    ...screens,
    ``,
    `## 2 Admin actions (group: action; "person only" means an agent key is refused)`,
    ...[...actionsByGroup.entries()].map(([group, actions]) => `- ${group}: ${actions.join(", ")}`),
    ``,
    `## 3 Admin API (base https://matterofplace.com; send the agent key as \`Authorization: Bearer\`)`,
    ...routes,
    ``,
    `## 4 Events that wake employees`,
    ...events,
    ``,
    `## 5 Automation steps (recipes are edited on /admin/automation/recipes)`,
    ...steps,
    ``,
    `## 6 Commands (run inside app/ with bun run <name>)`,
    `- ${packageScripts().join(", ")}`,
    ``,
    `## 7 Skills on this laptop`,
    `- ${skills().join(", ")}`,
    ``,
    `## 8 Where to read more`,
    `- Project rules: CLAUDE.md, GOTCHAS.md, PROJECT-STATE.md, .claude/POSITION.md`,
    `- Plans: workspace/05-plans/*.md (W1 the office, W2 Matter); rulings: workspace/05-plans/ASSUMED.md`,
    `- Architecture: app/docs/; the stack: workspace/02-tech-stack/tech-stack.md`,
    ``,
  ].join("\n");
}

if (import.meta.main) {
  const flag = process.argv.indexOf("--out");
  const out =
    flag === -1
      ? join(homedir(), ".mop-workforce", "matter", "atlas.md")
      : (process.argv[flag + 1] ?? "atlas.md");
  mkdirSync(dirname(out), { recursive: true });
  const text = atlas();
  writeFileSync(out, text);
  console.log(`atlas: ${out} (${String(text.length)} characters)`);
}
