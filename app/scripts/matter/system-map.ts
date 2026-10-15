// `bun scripts/matter/system-map.ts [--out <dir>] [--no-live]`: Matter's system map (plan W6 item 3). The atlas says
// what exists; this says what each thing touches: every public page and admin screen, the server route it reaches,
// that route's service function, the database functions it calls, the tables they read and write, the jobs and events
// they make, and for each event the steps and emails of its flow and the colleagues who wake on it. It reads the
// checkout itself (route files, `src/server/**`, `supabase/sql/functions/**`) so it matches the code of the commit it
// was made from, and the live recipes and wake rules with the runner's service key. Whatever it cannot follow is
// listed under "Unmapped" with its file, never dropped. The runner writes it after each move to a new main
// (daemon.ts); default output: %USERPROFILE%\.mop-workforce\matter\system-map.md and system-map.json.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

export type Effects = {
  reads: string[];
  writes: string[];
  calls: string[];
  jobs: string[];
  events: string[];
};

export type RouteEntry = {
  method: string;
  path: string;
  action: string | null;
  file: string;
  /** `file#function`, or null when the handler could not be followed (then it is also under Unmapped). */
  service: string | null;
  effects: Effects;
};

export type PageEntry = { kind: "public" | "admin"; path: string; files: string[]; api: string[] };

export type EventEntry = {
  type: string;
  emittedBy: string[];
  steps: string[];
  emails: string[];
  wakes: string[];
};

export type Unmapped = { what: string; file: string; why: string };

/** What only the database knows: the flows (`automation_recipes`) and who wakes on what (`agents.wake_on`). */
export type Live = {
  recipes: { trigger: string; enabled: boolean; steps: unknown }[];
  agents: { slug: string; wake_on: string[] | null }[];
};

export type SystemMap = {
  generatedAt: string;
  commit: string;
  pages: PageEntry[];
  routes: RouteEntry[];
  events: EventEntry[];
  unmapped: Unmapped[];
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "ANY"] as const;
/** Files that hold many unrelated exports: a page that imports one name reaches only that name's body. */
const HUBS = ["src/lib/queries.ts", "src/services/index.ts"];

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
const empty = (): Effects => ({ reads: [], writes: [], calls: [], jobs: [], events: [] });

function readText(root: string, rel: string): string | null {
  try {
    return readFileSync(join(root, rel), "utf8");
  } catch {
    return null;
  }
}

function filesUnder(root: string, rel: string): string[] {
  const dir = join(root, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(root, `${rel}/${entry.name}`) : [`${rel}/${entry.name}`],
  );
}

/** Drops comments so a word in a comment is never taken for code (URLs inside strings keep their `//`). */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

type Binding = { from: string; name: string };

/** `import { a, b as c } from "./x"` and `import * as ns from "./x"`, type-only imports left out. */
function importsOf(text: string): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  for (const match of text.matchAll(/^import\s+(?!type\s)([\s\S]*?)\s+from\s+["']([^"']+)["']/gm)) {
    const clause = match[1] ?? "";
    const from = match[2] ?? "";
    const star = /\*\s+as\s+(\w+)/.exec(clause);
    if (star?.[1] !== undefined) bindings.set(star[1], { from, name: "*" });
    const braces = /\{([\s\S]*)\}/.exec(clause)?.[1] ?? "";
    for (const part of braces.split(",")) {
      const item = part.trim();
      if (item === "" || item.startsWith("type ")) continue;
      const [name, local] = item.split(/\s+as\s+/);
      if (name !== undefined) bindings.set((local ?? name).trim(), { from, name: name.trim() });
    }
  }
  return bindings;
}

/** The file a relative import names, as a path from the app root; null for packages and missing files. */
function resolveModule(root: string, fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = posix
    .normalize(posix.join(posix.dirname(fromFile), spec))
    .replace(/\.(tsx?|js)$/, "");
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(join(root, candidate))) return candidate;
  }
  return null;
}

/**
 * The text of one top-level declaration (`function name`, `const name`, exported or not), read as prettier formats
 * it: it ends at the first line at column 0 that closes a bracket and opens nothing.
 */
function declarationOf(text: string, name: string): string | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    new RegExp(
      `^(export\\s+)?(async\\s+)?(function\\s*\\*?\\s*${name}\\b|const\\s+${name}\\b)`,
    ).test(line),
  );
  if (start === -1) return null;
  const first = lines[start] ?? "";
  if (/[;}]\s*$/.test(first) && !/[{([]\s*$/.test(first)) return first;
  for (let at = start + 1; at < lines.length; at += 1) {
    const line = lines[at] ?? "";
    if (/^[})\]]/.test(line) && !/([{([]|=>)\s*$/.test(line)) {
      return lines.slice(start, at + 1).join("\n");
    }
  }
  return lines.slice(start).join("\n");
}

/** The tables, database functions, jobs and events one service function reaches, local helpers included. */
function serviceEffects(text: string, body: string, seen: Set<string> = new Set()): Effects {
  const effects = empty();
  for (const match of body.matchAll(/\.rpc\(\s*["'`](\w+)["'`]/g)) {
    if (match[1] !== undefined) effects.calls.push(match[1]);
  }
  for (const match of body.matchAll(/\.from\(\s*["'](\w+)["']\s*\)/g)) {
    const at = match.index;
    const table = match[1];
    if (table === undefined || /storage\s*$/.test(body.slice(Math.max(0, at - 40), at))) continue;
    const rest = body.slice(at, body.indexOf(";", at) === -1 ? undefined : body.indexOf(";", at));
    (/\.(insert|update|upsert|delete)\(/.test(rest) ? effects.writes : effects.reads).push(table);
  }
  for (const match of body.matchAll(/enqueueJob\([^{]*\{\s*type:\s*["'](\w+)["']/g)) {
    if (match[1] !== undefined) effects.jobs.push(match[1]);
  }
  for (const match of body.matchAll(
    /["']emit_event["'][\s\S]{0,200}?p_type:\s*["']([\w.]+)["']/g,
  )) {
    if (match[1] !== undefined) effects.events.push(match[1]);
  }
  for (const match of body.matchAll(/\b(\w+)\(/g)) {
    const name = match[1];
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    const helper = declarationOf(text, name);
    if (helper !== null && helper !== body) merge(effects, serviceEffects(text, helper, seen));
  }
  return effects;
}

function merge(into: Effects, from: Effects): void {
  into.reads.push(...from.reads);
  into.writes.push(...from.writes);
  into.calls.push(...from.calls);
  into.jobs.push(...from.jobs);
  into.events.push(...from.events);
}

function tidy(effects: Effects): Effects {
  const writes = sorted(effects.writes);
  return {
    reads: sorted(effects.reads).filter((table) => !writes.includes(table)),
    writes,
    calls: sorted(effects.calls),
    jobs: sorted(effects.jobs),
    events: sorted(effects.events),
  };
}

type SqlFunction = { file: string; body: string };

/** Every `create or replace function public.<name>` under `supabase/sql/functions`, by name. */
function sqlFunctions(root: string): Map<string, SqlFunction> {
  const found = new Map<string, SqlFunction>();
  for (const file of filesUnder(root, "supabase/sql/functions").filter((f) => f.endsWith(".sql"))) {
    const text = (readText(root, file) ?? "").replace(/--.*$/gm, "");
    const starts = [...text.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)/gi)];
    starts.forEach((match, index) => {
      const name = match[1];
      if (name === undefined) return;
      const next = starts[index + 1]?.index;
      found.set(name, { file, body: text.slice(match.index, next) });
    });
  }
  return found;
}

/** What a database function does, the functions it calls included (each once). */
function sqlEffects(
  name: string,
  functions: Map<string, SqlFunction>,
  seen: Set<string> = new Set([name]),
): Effects {
  const effects = empty();
  const body = functions.get(name)?.body;
  if (body === undefined) return effects;
  const all = (pattern: RegExp) =>
    [...body.matchAll(pattern)].map((match) => (match[1] ?? "").toLowerCase());
  effects.writes.push(
    ...all(/insert\s+into\s+public\.(\w+)/gi),
    ...all(/\bupdate\s+public\.(\w+)/gi),
    ...all(/delete\s+from\s+public\.(\w+)/gi),
  );
  effects.reads.push(...all(/(?<!delete\s{1,4})\b(?:from|join)\s+public\.(\w+)\b(?!\s*\()/gi));
  effects.events.push(...all(/emit_event\(\s*'([\w.]+)'/gi));
  effects.jobs.push(...all(/enqueue_job\(\s*'(\w+)'/gi));
  for (const called of all(/public\.(\w+)\s*\(/gi)) {
    if (seen.has(called) || !functions.has(called)) continue;
    seen.add(called);
    effects.calls.push(called);
    merge(effects, sqlEffects(called, functions, seen));
  }
  return effects;
}

/** The address TanStack serves a route file at, from its `create(Lazy)FileRoute("...")`, without a closing slash. */
function routePathOf(text: string): string | null {
  const path = /create(?:Lazy)?FileRoute\(\s*["']([^"']+)["']/.exec(text)?.[1];
  return path === undefined ? null : path.length > 1 ? path.replace(/\/$/, "") : path;
}

/** `file#function` for an identifier a route file uses, through its imports; null when it is not imported. */
function serviceOf(
  root: string,
  file: string,
  imports: Map<string, Binding>,
  id: string,
): string | null {
  const [head, member] = id.split(".");
  const binding = head === undefined ? undefined : imports.get(head);
  if (binding === undefined) return null;
  const target = resolveModule(root, file, binding.from);
  if (target === null) return null;
  const name = binding.name === "*" ? member : binding.name;
  return name === undefined ? null : `${target}#${name}`;
}

function effectsOfService(
  root: string,
  service: string,
  functions: Map<string, SqlFunction>,
  hops = 0,
): Effects | null {
  const [file, name] = service.split("#");
  const text = file === undefined ? null : readText(root, file);
  if (text === null || file === undefined || name === undefined) return null;
  const body = declarationOf(code(text), name);
  if (body === null) {
    // `export { name } from "./other"`: the service lives one file further.
    for (const match of code(text).matchAll(/export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
      const names = (match[1] ?? "").split(",").map((part) => part.trim().split(/\s+as\s+/));
      const found = names.find((pair) => (pair[1] ?? pair[0]) === name);
      const target = resolveModule(root, file, match[2] ?? "");
      if (found?.[0] !== undefined && target !== null && hops < 3) {
        return effectsOfService(root, `${target}#${found[0]}`, functions, hops + 1);
      }
    }
    return null;
  }
  const effects = serviceEffects(code(text), body);
  for (const call of [...effects.calls]) merge(effects, sqlEffects(call, functions));
  return tidy(effects);
}

/** Admin and other API route files: each method's action and the service function its handler calls. */
function apiRoutes(
  root: string,
  functions: Map<string, SqlFunction>,
  unmapped: Unmapped[],
): RouteEntry[] {
  const entries: RouteEntry[] = [];
  for (const file of filesUnder(root, "src/routes/api").filter((f) => /\.tsx?$/.test(f))) {
    const text = code(readText(root, file) ?? "");
    const path = routePathOf(text);
    if (path === null) {
      unmapped.push({ what: file, file, why: "no createFileRoute path" });
      continue;
    }
    if (text.includes("handlePublic(")) continue; // the public route table below names its service.
    const imports = importsOf(text);
    const blocks = text.split(new RegExp(`\\b(${METHODS.join("|")}):\\s`));
    if (blocks.length < 3) unmapped.push({ what: path, file, why: "no method handler found" });
    for (let at = 1; at < blocks.length; at += 2) {
      const method = blocks[at] ?? "";
      const block = blocks[at + 1] ?? "";
      const action = /action:\s*["']([\w.]+)["']/.exec(block)?.[1] ?? null;
      // The handler is a function named outright (`handler: saveStory`) or the first call in its body that is
      // imported from `src/server` (`new Response(..., await getPdf(...))` reaches `getPdf`).
      const body = block.slice(Math.max(0, block.indexOf("handler:")));
      const named = /^handler:\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*[,}\n]/.exec(
        body,
      )?.[1];
      const candidates = [
        ...(named === undefined ? [] : [named]),
        ...[...body.matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/g)].map(
          (m) => m[1] ?? "",
        ),
      ];
      const handler = candidates.find((id) =>
        serviceOf(root, file, imports, id)?.startsWith("src/server/"),
      );
      const service = handler === undefined ? null : serviceOf(root, file, imports, handler);
      const effects = service === null ? null : effectsOfService(root, service, functions);
      if (service === null || effects === null) {
        unmapped.push({
          what: `${method} ${path}`,
          file,
          why:
            service === null
              ? `handler ${handler ?? "(none)"} is not an imported function`
              : `${service} not found`,
        });
      }
      entries.push({ method, path, action, file, service, effects: effects ?? empty() });
    }
  }
  return entries;
}

/** The public route table (`src/server/public/routes.ts`): each path, its method and its service. */
function publicRoutes(
  root: string,
  functions: Map<string, SqlFunction>,
  unmapped: Unmapped[],
): RouteEntry[] {
  const file = "src/server/public/routes.ts";
  const text = code(readText(root, file) ?? "");
  const table = text.slice(Math.max(0, text.indexOf("export const routes")));
  const imports = importsOf(text);
  const rows: { method: string; path: string; id: string }[] = [];
  for (const match of table.matchAll(/catalogRead\(\s*["']([^"']+)["'],\s*([\w.]+)/g)) {
    rows.push({ method: "GET", path: match[1] ?? "", id: match[2] ?? "" });
  }
  for (const match of table.matchAll(
    /path:\s*["']([^"']+)["'],\s*method:\s*["'](\w+)["'][\s\S]*?service:\s*([\w.]+)/g,
  )) {
    rows.push({ method: match[2] ?? "", path: match[1] ?? "", id: match[3] ?? "" });
  }
  return rows.map(({ method, path, id }) => {
    const service = serviceOf(root, file, imports, id);
    const effects = service === null ? null : effectsOfService(root, service, functions);
    if (service === null || effects === null) {
      unmapped.push({ what: `${method} ${path}`, file, why: `service ${id} not followed` });
    }
    return { method, path, action: null, file, service, effects: effects ?? empty() };
  });
}

/** `/properties/${encodeURIComponent(slug)}?x` becomes `/properties/:slug`: one shape for both sides. */
function shape(path: string): string {
  return path
    .replace(/\?.*$/, "")
    .replace(/\$\{[^}]*\}(?=\/|$)/g, ":param")
    .replace(/\$\{[^}]*\}/g, "")
    .replace(/\/(\$|:)\w*/g, "/:param")
    .replace(/\/$/, "");
}

/** `services.<group>.<method>` to the public API path its HTTP client calls (`src/services/http/index.ts`). */
function publicClient(root: string): Map<string, string> {
  const text = code(readText(root, "src/services/http/index.ts") ?? "");
  const paths = new Map<string, string>();
  for (const group of text.matchAll(/const\s+(\w+)\s*:\s*\w+\s*=\s*\{([\s\S]*?)\n\s{2}\};/g)) {
    const segments = (group[2] ?? "").split(/\n\s{4}(?=(?:async\s+)?\w+\s*[:(])/);
    for (const segment of segments) {
      const method = /^(?:async\s+)?(\w+)/.exec(segment.trim())?.[1];
      const call = /api\.\w+\(\s*[`"']([^`"']+)[`"']/.exec(segment)?.[1];
      if (method !== undefined && call !== undefined) {
        paths.set(`${group[1] ?? ""}.${method}`, `/api/public${call}`);
      }
    }
  }
  return paths;
}

/** The files a page reaches through its relative imports: whole files, or one export of a hub file. */
function reach(root: string, start: string[], depth = 3): string[] {
  const texts: string[] = [];
  const seen = new Set<string>();
  let layer = start.map((file) => ({ file, name: null as string | null }));
  for (let level = 0; level <= depth && layer.length > 0; level += 1) {
    const next: typeof layer = [];
    for (const { file, name } of layer) {
      const key = `${file}#${name ?? "*"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const whole = code(readText(root, file) ?? "");
      const text = name === null ? whole : (declarationOf(whole, name) ?? "");
      texts.push(text);
      for (const match of whole.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
        const target = resolveModule(root, file, match[1] ?? "");
        if (target !== null && text.includes(match[1] ?? ""))
          next.push({ file: target, name: null });
      }
      for (const [local, binding] of importsOf(whole)) {
        const target = resolveModule(root, file, binding.from);
        if (target === null || target.startsWith("src/server/") || !text.includes(local)) continue;
        if (target.startsWith("src/admin/ui/") || target.startsWith("src/domain/")) continue;
        next.push({
          file: target,
          name: HUBS.includes(target) && binding.name !== "*" ? binding.name : null,
        });
      }
    }
    layer = next;
  }
  return texts;
}

function pages(root: string, routes: RouteEntry[]): PageEntry[] {
  const client = publicClient(root);
  const byPath = new Map<string, PageEntry>();
  const routeFiles = filesUnder(root, "src/routes").filter(
    (file) => /\.tsx$/.test(file) && !file.startsWith("src/routes/api/"),
  );
  for (const file of routeFiles) {
    const name = file.replace("src/routes/", "");
    const kind = name.startsWith("admin") ? "admin" : name.startsWith("_site") ? "public" : null;
    const raw = routePathOf(readText(root, file) ?? "");
    if (kind === null || raw === null) continue;
    const path = raw.replace(/^\/_site/, "") || "/";
    const page = byPath.get(path) ?? { kind, path, files: [], api: [] };
    page.files.push(file);
    const texts = reach(root, [file]);
    const api = new Set(page.api);
    if (kind === "public") {
      for (const text of texts) {
        for (const match of text.matchAll(/services\.(\w+)\.(\w+)/g)) {
          const call = client.get(`${match[1] ?? ""}.${match[2] ?? ""}`);
          const route =
            call === undefined
              ? undefined
              : routes.find((entry) => shape(entry.path) === shape(call));
          if (route !== undefined) api.add(`${route.method} ${route.path}`);
        }
      }
    } else {
      const areas = new Set<string>();
      for (const text of texts) {
        for (const match of text.matchAll(/["'`](\/api\/admin\/[\w/.-]*)/g)) {
          areas.add((match[1] ?? "").replace(/\/$/, ""));
        }
      }
      for (const route of routes) {
        if ([...areas].some((area) => route.path === area || route.path.startsWith(`${area}/`))) {
          api.add(`${route.method} ${route.path}`);
        }
      }
    }
    page.api = sorted(api);
    byPath.set(path, page);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

const stepList = (steps: unknown): { step_type: string; template?: string; enabled: boolean }[] =>
  Array.isArray(steps)
    ? steps.flatMap((step: unknown) => {
        if (typeof step !== "object" || step === null || !("step_type" in step)) return [];
        const type = String(step.step_type);
        const params = "params" in step && typeof step.params === "object" ? step.params : null;
        const template =
          params !== null && "template" in params ? String(params.template) : undefined;
        const enabled = !("enabled" in step) || step.enabled !== false;
        return [{ step_type: type, ...(template === undefined ? {} : { template }), enabled }];
      })
    : [];

function events(
  root: string,
  routes: RouteEntry[],
  functions: Map<string, SqlFunction>,
  live: Live | null,
): EventEntry[] {
  const domain = readText(root, "src/domain/events.ts") ?? "";
  const declared = [
    ...(/eventTypes\s*=\s*\[([\s\S]*?)\]/.exec(domain)?.[1] ?? "").matchAll(/["']([\w.]+)["']/g),
  ].map((match) => match[1] ?? "");
  const emitters = new Map<string, Set<string>>();
  const note = (type: string, by: string) =>
    emitters.set(type, (emitters.get(type) ?? new Set()).add(by));
  for (const [name] of functions) {
    for (const type of sqlEffects(name, functions, new Set([name])).events) {
      if (
        new RegExp(`emit_event\\(\\s*'${type.replace(/\./g, "\\.")}'`, "i").test(
          functions.get(name)?.body ?? "",
        )
      ) {
        note(type, name);
      }
    }
  }
  for (const route of routes) {
    for (const type of route.effects.events) {
      if (
        route.service !== null &&
        !route.effects.calls.some((call) => emitters.get(type)?.has(call))
      ) {
        note(type, route.service);
      }
    }
  }
  return sorted([...declared, ...emitters.keys()]).map((type) => {
    const recipe = live?.recipes.find((row) => row.trigger === type);
    const steps = recipe === undefined ? [] : stepList(recipe.steps);
    return {
      type,
      emittedBy: sorted(emitters.get(type) ?? []),
      steps:
        recipe === undefined
          ? []
          : steps.map(
              (step) => `${step.step_type}${step.enabled && recipe.enabled ? "" : " (off)"}`,
            ),
      emails: sorted(steps.flatMap((step) => (step.template === undefined ? [] : [step.template]))),
      wakes: sorted(
        (live?.agents ?? [])
          .filter((agent) => (agent.wake_on ?? []).includes(type))
          .map((agent) => agent.slug),
      ),
    };
  });
}

export function systemMap(
  root: string,
  live: Live | null,
  now: Date = new Date(),
  commit = "",
): SystemMap {
  const unmapped: Unmapped[] = [];
  const functions = sqlFunctions(root);
  const routes = [
    ...apiRoutes(root, functions, unmapped),
    ...publicRoutes(root, functions, unmapped),
  ];
  for (const route of routes) {
    for (const call of route.effects.calls) {
      if (!functions.has(call)) {
        unmapped.push({
          what: `${route.method} ${route.path} calls ${call}`,
          file: route.file,
          why: "no SQL file creates this function",
        });
      }
    }
  }
  if (live === null) {
    unmapped.push({
      what: "flows and wake rules",
      file: "automation_recipes, agents.wake_on",
      why: "no database connection: run with the runner's .env",
    });
  }
  return {
    generatedAt: now.toISOString(),
    commit,
    pages: pages(root, routes),
    routes: routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
    events: events(root, routes, functions, live),
    unmapped,
  };
}

const list = (label: string, values: string[]) =>
  values.length === 0 ? [] : [`${label} ${values.join(", ")}`];

export function renderMap(map: SystemMap): string {
  const writers = new Map<string, Set<string>>();
  for (const route of map.routes) {
    for (const table of route.effects.writes) {
      writers.set(table, (writers.get(table) ?? new Set()).add(`${route.method} ${route.path}`));
    }
  }
  return [
    `# Matter's system map`,
    ``,
    `Generated ${map.generatedAt} from commit ${map.commit === "" ? "(unknown)" : map.commit} by`,
    `scripts/matter/system-map.ts. Search it for a page, a route, a function or a table; read the code only for detail.`,
    ``,
    `## Index`,
    `1 Public pages · 2 Admin screens · 3 Server routes (service, database functions, tables, jobs, events) ·`,
    `4 Events (who emits them, their flow's steps and emails, who wakes) · 5 Tables and the routes that write them ·`,
    `6 Unmapped`,
    ``,
    `## 1 Public pages`,
    ...map.pages
      .filter((page) => page.kind === "public")
      .map(
        (page) =>
          `- ${page.path} (${page.files.join(", ")}): ${page.api.join(", ") || "no API call"}`,
      ),
    ``,
    `## 2 Admin screens`,
    ...map.pages
      .filter((page) => page.kind === "admin")
      .map(
        (page) =>
          `- ${page.path} (${page.files.join(", ")}): ${page.api.join(", ") || "no API call"}`,
      ),
    ``,
    `## 3 Server routes`,
    ...map.routes.map((route) =>
      [
        `- ${route.method} ${route.path}${route.action === null ? "" : ` [${route.action}]`}:`,
        route.service ?? "(not followed)",
        ...list("· functions", route.effects.calls),
        ...list("· writes", route.effects.writes),
        ...list("· reads", route.effects.reads),
        ...list("· jobs", route.effects.jobs),
        ...list("· events", route.effects.events),
      ].join(" "),
    ),
    ``,
    `## 4 Events`,
    ...map.events.map((event) =>
      [
        `- ${event.type}:`,
        `emitted by ${event.emittedBy.join(", ") || "nothing in the code"}`,
        ...list("· flow", event.steps),
        ...list("· emails", event.emails),
        `· wakes ${event.wakes.join(", ") || "no colleague"}`,
      ].join(" "),
    ),
    ``,
    `## 5 Tables and the routes that write them`,
    ...[...writers.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([table, by]) => `- ${table}: ${sorted(by).join(", ")}`),
    ``,
    `## 6 Unmapped (${String(map.unmapped.length)})`,
    ...(map.unmapped.length === 0
      ? ["- nothing"]
      : map.unmapped.map((item) => `- ${item.what} (${item.file}): ${item.why}`)),
    ``,
  ].join("\n");
}

async function liveData(): Promise<Live | null> {
  try {
    const { serviceDb } = await import("../workforce/env.ts");
    const db = serviceDb();
    const [recipes, agents] = await Promise.all([
      db.from("automation_recipes").select("trigger, enabled, steps"),
      db.from("agents").select("slug, wake_on"),
    ]);
    if (recipes.error !== null || agents.error !== null) return null;
    return { recipes: recipes.data, agents: agents.data };
  } catch {
    return null;
  }
}

if (import.meta.main) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const flag = process.argv.indexOf("--out");
  const out =
    flag === -1 ? join(homedir(), ".mop-workforce", "matter") : (process.argv[flag + 1] ?? ".");
  const live = process.argv.includes("--no-live") ? null : await liveData();
  const commit = spawnSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  }).stdout.trim();
  const map = systemMap(root, live, new Date(), commit);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "system-map.md"), renderMap(map));
  writeFileSync(join(out, "system-map.json"), JSON.stringify(map, null, 1));
  console.log(
    `system map: ${String(map.pages.length)} pages, ${String(map.routes.length)} routes, ${String(map.events.length)} events, ${String(map.unmapped.length)} unmapped (${join(out, "system-map.md")})`,
  );
}
