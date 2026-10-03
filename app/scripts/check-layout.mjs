import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string} glob `*` is one path segment part, `**` crosses folders, `{a,b}` alternates.
 * @returns {RegExp}
 */
function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === "*" && glob.charAt(i + 1) === "*") {
      const slash = glob.charAt(i + 2) === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") {
      out += "[^/]*";
    } else if (c === "{") {
      out += "(?:";
    } else if (c === "}") {
      out += ")";
    } else if (c === ",") {
      out += "|";
    } else {
      out += c.replace(/[.+^$()|\\?[\]]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

const MARKET_AREAS = "{brand,filters,forms,layout,property,search,site}";
const ADMIN_FEATURES =
  "{assets,audit,automation,channels,dashboard,inquiries,invoices,jobs,markets,media,newsletter,people,properties,reports,requests,settings,stories,team,ui}";
const SERVER_DOMAINS =
  "{assets,audit,automation,catalog,channels,client-errors,concierge,dashboard,email,events,hooks,inquiries,jobs,kpi,markets,media,newsletter,nitro,omnikom,payments,people,previews,properties,public,reports,search,seo,settings,stories,subjects,submissions,subscribers,team}";
const UNIT_AREAS =
  "{assets,audit,automation,channels,email,jobs,kpi,lib,newsletter,omnikom,payments,reel,reports,scripts,security}";

/**
 * The folder map of STANDARDS section 1.3, paths relative to `app/`. A folder is added here only
 * in the commit that adds its row to STANDARDS section 1. A `README.md` is allowed in the folder
 * of every pattern that contains a slash.
 * @type {{ name: string, patterns: string[] }[]}
 */
export const APP_ROWS = [
  {
    name: "app root",
    patterns: [
      "{package.json,bun.lock,bunfig.toml,tsconfig.json,tsconfig.scripts.json,vite.config.ts,vitest.config.ts,playwright.config.ts,eslint.config.js,knip.json,.jscpd.json,lighthouserc.json,lighthouserc.local.json,budget.json,wrangler.toml,backup-recipient.pem,.env.example,.gitignore,.prettierignore,.prettierrc,AGENTS.md,CLAUDE.md,README.md,roadmap.md}",
    ],
  },
  {
    name: "src files",
    patterns: ["src/{router.tsx,start.ts,env.d.ts,styles.css,routeTree.gen.ts}"],
  },
  {
    name: "src/routes",
    patterns: [
      "src/routes/*.{ts,tsx}",
      "src/routes/admin/*.tsx",
      "src/routes/api/{public,admin,hooks}/*.ts",
      "src/routes/api/consent.ts",
    ],
  },
  {
    name: "src/components",
    patterns: [
      `src/components/${MARKET_AREAS}/*.{ts,tsx}`,
      "src/components/forms/submit/*.{ts,tsx}",
    ],
  },
  {
    name: "src/admin",
    patterns: [
      `src/admin/${ADMIN_FEATURES}/*.{ts,tsx}`,
      "src/admin/{nav.ts,query.ts,query.test.ts,README.md}",
    ],
  },
  {
    name: "src/server",
    patterns: [
      `src/server/${SERVER_DOMAINS}/**/*.ts`,
      "src/server/lib/**/*.ts",
      "src/server/{scheduled.ts,README.md}",
    ],
  },
  { name: "src/domain", patterns: ["src/domain/*.ts"] },
  { name: "src/services", patterns: ["src/services/**/*.ts"] },
  { name: "src/lib", patterns: ["src/lib/*.ts"] },
  { name: "src/hooks", patterns: ["src/hooks/*.ts"] },
  { name: "src/config", patterns: ["src/config/*.ts"] },
  { name: "src/data", patterns: ["src/data/*.ts"] },
  { name: "src/db", patterns: ["src/db/*.ts"] },
  { name: "src/styles", patterns: ["src/styles/**/*.css"] },
  {
    name: "src/templates",
    patterns: ["src/templates/{email,social}/**", "src/templates/theme.gen.ts"],
  },
  { name: "src/assets", patterns: ["src/assets/**"] },
  {
    name: "supabase",
    patterns: [
      "supabase/migrations/*.sql",
      "supabase/sql/functions/*.sql",
      "supabase/functions/job-runner/{index.ts,deno.json,deno.lock}",
      "supabase/functions/README.md",
      "supabase/templates/*.html",
      "supabase/{config.toml,seed.sql,seed.prod.sql}",
    ],
  },
  {
    name: "tests",
    patterns: [
      "tests/unit/*.test.{ts,tsx}",
      `tests/unit/${UNIT_AREAS}/**/*.test.{ts,tsx}`,
      "tests/unit/**/fixtures/**",
      "tests/db/*.ts",
      "tests/api/*.ts",
      "tests/e2e/**",
      "tests/deno/*.ts",
      "tests/fixtures/**",
      "tests/setup/*.ts",
      "tests/mutations/*.json",
      "tests/{README.md,WATCHED-FAIL.md}",
    ],
  },
  {
    name: "scripts",
    patterns: [
      "scripts/*.{ts,mjs,sh,ps1}",
      "scripts/lib/*.{ts,mjs}",
      "scripts/{audit,harden,launch}/**/*.{ts,mjs}",
      "scripts/**/fixtures/**",
      "scripts/omnikom-mock.wrangler.toml",
    ],
  },
  {
    name: "docs",
    patterns: [
      "docs/runbooks/*.md",
      "docs/{README,HOW-TO-ADD,coming-soon,omnikom-webhook,security}.md",
      "docs/verify-example.mjs",
      "docs/{architecture,brief,database,decisions,deploy}/*",
    ],
  },
  {
    name: "public",
    patterns: [
      "public/{_headers,robots.txt,sw.js,offline.html}",
      "public/{favicon,apple-touch-icon}*",
      "public/*.txt",
      "public/fonts/{*.woff2,LICENSES.md}",
      "public/media/**",
      "public/og/static/*.png",
    ],
  },
];

const MEDIA = /\.(png|jpe?g|webp|gif|heic|mp4|mov|wav|mp3)$/i;
const MEDIA_HOMES = [
  "app/src/assets/",
  "app/public/",
  "app/tests/fixtures/",
  "workspace/03-diagrams/img/",
  "workspace/08-visual-pass/pairs/",
  "workspace/08-creative/options/",
  "brand/",
  "launch/",
];

/**
 * STANDARDS 1.2, paths relative to the repository root.
 * @type {{ kind: string, test: (path: string) => boolean }[]}
 */
export const BANNED = [
  {
    kind: "build output",
    test: (p) =>
      /(^|\/)(node_modules|\.output|dist|\.vinxi|\.nitro|\.tanstack|\.wrangler)\//.test(p) ||
      /\.tsbuildinfo$/.test(p) ||
      /(^|\/)supabase\/(\.temp|\.branches)\//.test(p),
  },
  { kind: "log", test: (p) => /\.log$/.test(p) || /(^|\/)npm-debug\.log/.test(p) },
  {
    kind: "test output",
    test: (p) =>
      /(^|\/)(test-results|playwright-report|coverage|\.lighthouseci|out|\.tmp)\//.test(p),
  },
  {
    kind: "screenshot or render",
    test: (p) =>
      MEDIA.test(p) && (/(^|\/)frames\//.test(p) || !MEDIA_HOMES.some((h) => p.startsWith(h))),
  },
  {
    kind: "scratch",
    test: (p) =>
      /(^|\/)scratch\//.test(p) ||
      /\.(tmp|bak|orig|rej)$/.test(p) ||
      p.startsWith("launch/.site-main/"),
  },
  {
    kind: "secret",
    test: (p) =>
      (/(^|\/)\.env(\.[^/]*)?$/.test(p) && p !== "app/.env.example") ||
      /(^|\/)\.dev\.vars$/.test(p) ||
      /(^|\/)creds\//.test(p) ||
      /\.(key|p12|pfx)$/.test(p) ||
      /secrets[^/]*\.txt$/.test(p) ||
      (/\.pem$/.test(p) && p !== "app/backup-recipient.pem"),
  },
  { kind: "database dump", test: (p) => /\.(dump|p7m)$/.test(p) || /\.sql\.gz$/.test(p) },
  {
    kind: "os or editor file",
    test: (p) =>
      /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/.test(p) ||
      /(^|\/)\.idea\//.test(p) ||
      (/(^|\/)\.vscode\//.test(p) && !p.endsWith(".vscode/extensions.json")),
  },
];

const ROW_PATTERNS = APP_ROWS.flatMap((row) => row.patterns).map(globToRegExp);
const README_FOLDERS = APP_ROWS.flatMap((row) => row.patterns)
  .filter((glob) => glob.includes("/"))
  .map((glob) => globToRegExp(`${glob.slice(0, glob.lastIndexOf("/"))}/README.md`));

/**
 * @param {string} appPath path relative to `app/`
 * @returns {boolean}
 */
function inFolderMap(appPath) {
  return (
    ROW_PATTERNS.some((re) => re.test(appPath)) || README_FOLDERS.some((re) => re.test(appPath))
  );
}

/**
 * @param {string[]} paths repository-relative paths, forward slashes
 * @returns {{ path: string, reason: string }[]}
 */
export function checkLayout(paths) {
  /** @type {{ path: string, reason: string }[]} */
  const failures = [];
  for (const path of paths) {
    const banned = BANNED.find((rule) => rule.test(path));
    if (banned) {
      failures.push({ path, reason: `banned: ${banned.kind}` });
    } else if (path.startsWith("app/") && !inFolderMap(path.slice("app/".length))) {
      failures.push({ path, reason: "outside the folder map" });
    }
  }
  return failures;
}

/** @returns {string[]} */
function listFiles() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const raw = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--full-name"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return raw.split("\0").filter((path) => path !== "" && existsSync(resolve(root, path)));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = listFiles();
  const failures = checkLayout(files);
  for (const { path, reason } of failures) {
    process.stdout.write(`layout: ${path}: ${reason}\n`);
  }
  if (failures.length > 0) {
    process.exit(1);
  }
  process.stdout.write(`layout: OK (${String(files.length)} files)\n`);
}
