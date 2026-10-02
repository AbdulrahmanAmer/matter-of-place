import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "supabase", "scripts"];
const EXTENSIONS = /\.(ts|tsx|mjs|js|sql)$/;
const MARKER = /\/\/ STUB\(([A-Za-z0-9-]+)(?: step [0-9a-z]+)?\): (.+)$/;
const DEFAULT_PLAN = "../workspace/05-plans/PLAN.md";

interface Marker {
  file: string;
  line: number;
  slice: string;
  text: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function findMarkers(): Marker[] {
  return ROOTS.flatMap(walk)
    .filter((file) => EXTENSIONS.test(file))
    .flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((text, index) => {
          const match = MARKER.exec(text);
          return match?.[1] === undefined || match[2] === undefined
            ? []
            : [
                {
                  file: file.replaceAll("\\", "/"),
                  line: index + 1,
                  slice: match[1],
                  text: match[2],
                },
              ];
        }),
    );
}

function closedSlices(planPath: string): Set<string> {
  const lines = readFileSync(planPath, "utf8").split("\n");
  const header = lines.map((line) => /^\|\s*Slice\s*\|\s*Status\s*\|/.test(line)).lastIndexOf(true);
  if (header < 0) throw new Error(`no | Slice | Status | table in ${planPath}`);
  const closed = new Set<string>();
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) break;
    const [, slice, status] = line.split("|").map((cell) => cell.trim());
    if (slice !== undefined && status?.toLowerCase() === "closed") closed.add(slice);
  }
  return closed;
}

const args = process.argv.slice(2);
const planFlag = args.indexOf("--plan");
const planPath = (planFlag >= 0 ? args[planFlag + 1] : undefined) ?? DEFAULT_PLAN;
const markers = findMarkers();

if (args.includes("--count-non-v1")) {
  process.stdout.write(`${String(markers.filter((m) => m.slice !== "post-v1").length)}\n`);
} else {
  const closed = closedSlices(planPath);
  let failed = 0;
  for (const m of markers) {
    const isClosed = closed.has(m.slice);
    if (isClosed) failed += 1;
    process.stdout.write(
      `${m.file}:${String(m.line)} STUB(${m.slice})${isClosed ? " slice is closed" : ""}: ${m.text}\n`,
    );
  }
  process.stdout.write(
    `stubs: ${String(markers.length)} markers, ${String(failed)} on closed slices\n`,
  );
  if (failed > 0) process.exit(1);
}
