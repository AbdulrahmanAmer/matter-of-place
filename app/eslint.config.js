import commentsPlugin from "@eslint-community/eslint-plugin-eslint-comments";
import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import { defineConfig } from "eslint/config";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";
import { readFileSync } from "node:fs";

// The orchestrator's merge script sits outside app/ (ASSUMED H42 (2)). ESLint refuses a file above
// its base path, so `bun run lint` lints it in a second run from the repository root with this
// config, where the path below is relative to that root.
const MERGE_GATE = "workspace/05-plans/merge-gate.mjs";
// B14 keeps its tools beside the reports (workspace/audits) and its lint at the repository root; they share that second run.
const ROOT_SCRIPTS = [MERGE_GATE, "workspace/audits/tools/*.mjs", "scripts/audit/*.mjs"];
const prettierOptions = JSON.parse(readFileSync(new URL(".prettierrc", import.meta.url), "utf8"));

// Deno-loaded files (CS-01): the job runner imports them, so every relative, `@/server/` and
// `@/domain/` import or re-export carries its `.ts` or `.tsx` extension. A slash inside an esquery
// regex breaks its parser, so `[.]` and `@.` stand in for the literal `.` and `@/`.
const DENO_FILES = [
  "src/server/lib/{errors,log,log-events,runtime-env,sentry,media-store,events,jobs,crypto}.ts",
  "src/server/public/{state,mappers}.ts",
  "src/server/catalog/visibility.ts",
  "src/server/submissions/reconcile.ts",
  "src/server/{jobs,automation,omnikom,email,channels,newsletter,kpi,settings}/**",
  "src/server/assets/{reel-spec,spec,captions,voice,links}.ts",
  "src/server/subscribers/confirm-email.ts",
  "src/server/reports/build.ts",
  "src/domain/**",
  "src/templates/**",
];
const DENO_UNSUFFIXED = "[source.value=/^([.]|@.(server|domain))/]:not([source.value=/[.]tsx?$/])";
const DENO_MESSAGE = "Deno-loaded file: import with the .ts extension";
const DENO_SELECTORS = ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].map(
  (node) => ({ selector: `${node}${DENO_UNSUFFIXED}`, message: DENO_MESSAGE }),
);

const FETCH_SIGNAL = {
  selector: "CallExpression[callee.name='fetch'][arguments.length<2]",
  message: "R27, R32: pass an init object with a signal to every fetch",
};
const FILTER_STRING = {
  selector:
    "CallExpression[callee.property.name=/^(or|filter|textSearch)$/] > :matches(TemplateLiteral, BinaryExpression)",
  message: "R44: free text goes through an RPC parameter, never a built filter string",
};
const WALL_CLOCK = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: "R29: read time from ctx.now or a now argument, never new Date()",
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: "R29: read time from ctx.now or a now argument, never Date.now()",
  },
];
const LOCALE_FORMAT = [
  {
    selector: "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]",
    message: "R43: format through src/lib/format.ts or src/domain/market-time.ts",
  },
  {
    selector: "NewExpression[callee.object.name='Intl']",
    message: "R43: format through src/lib/format.ts or src/domain/market-time.ts",
  },
];
const HTML_SINK = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: "R44: raw HTML only in src/lib/seo.ts",
  },
  {
    selector: "AssignmentExpression[left.property.name='innerHTML']",
    message: "R44: raw HTML only in src/lib/seo.ts",
  },
];
const ADMIN_DIALOG = {
  selector: "JSXAttribute[name.name='role'][value.value='dialog']",
  message: "R41: use the shared Dialog on native <dialog>, never a hand-set role",
};

// Flat config replaces a rule's options per block, so a file in several scopes needs one block
// that holds the union. Each block below is the intersection of one subset of the scopes (an
// inner array of `files` is an AND), and the subsets run from small to large so the block that
// names every scope a file belongs to is the last one that matches it.
const SYNTAX_SCOPES = [
  { files: DENO_FILES, ignores: [], selectors: DENO_SELECTORS },
  { files: ["src/server/**"], ignores: [], selectors: [FETCH_SIGNAL, FILTER_STRING] },
  {
    files: [
      "src/server/jobs/steps/**",
      "src/server/automation/plan.ts",
      "src/server/automation/cron.ts",
      "src/domain/**",
    ],
    ignores: [],
    selectors: WALL_CLOCK,
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/format.ts", "src/domain/market-time.ts", "src/server/**"],
    selectors: LOCALE_FORMAT,
  },
  { files: ["src/**/*.{ts,tsx}"], ignores: ["src/lib/seo.ts"], selectors: HTML_SINK },
  {
    files: ["src/admin/**/*.tsx"],
    ignores: ["src/admin/ui/Dialog.tsx"],
    selectors: [ADMIN_DIALOG],
  },
];

function syntaxBlocks() {
  const subsets = Array.from({ length: 2 ** SYNTAX_SCOPES.length - 1 }, (_, i) =>
    SYNTAX_SCOPES.filter((_scope, bit) => ((i + 1) >> bit) & 1),
  );
  return subsets
    .sort((a, b) => a.length - b.length)
    .map((scopes) => ({
      files: scopes.reduce(
        (patterns, scope) => patterns.flatMap((all) => scope.files.map((file) => [...all, file])),
        [[]],
      ),
      ignores: scopes.flatMap((scope) => scope.ignores),
      rules: {
        "no-restricted-syntax": ["error", ...scopes.flatMap((scope) => scope.selectors)],
      },
    }));
}

const ADAPTER_FILES = [
  "src/server/lib/{db,sentry,turnstile,media-store}.ts",
  "src/server/email/resend-client.ts",
  "src/server/channels/{meta,meta-token,meta-metrics,x,linkedin,youtube,oauth-tokens,resend}.ts",
  "src/server/omnikom/client.ts",
  "src/server/jobs/dispatch.ts",
  "src/server/jobs/system/health/providers.ts",
];

const typeAwareRules = {
  "@typescript-eslint/only-throw-error": [
    "error",
    {
      allow: [
        { from: "package", package: "@tanstack/router-core", name: ["Redirect", "NotFoundError"] },
      ],
    },
  ],
  "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
  "@typescript-eslint/switch-exhaustiveness-check": [
    "error",
    { requireDefaultForNonUnion: true, considerDefaultExhaustiveForUnions: false },
  ],
  "@typescript-eslint/consistent-type-imports": "error",
  "@typescript-eslint/no-unsafe-type-assertion": "error",
  "@typescript-eslint/ban-ts-comment": [
    "error",
    { "ts-expect-error": "allow-with-description", minimumDescriptionLength: 10 },
  ],
  "@typescript-eslint/no-unused-vars": "off",
  "no-console": "error",
};

export default defineConfig(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      ".tanstack",
      "playwright-report",
      "test-results",
      "src/routeTree.gen.ts",
      "src/db/types.ts",
      "supabase/.temp",
    ],
  },
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
    plugins: { "@eslint-community/eslint-comments": commentsPlugin },
    rules: { "@eslint-community/eslint-comments/require-description": "error" },
  },
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["scripts/**"],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      ecmaVersion: 2020,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...typeAwareRules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }],
    },
  },
  {
    files: ["scripts/**/*.{ts,mjs}", ...ROOT_SCRIPTS],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: false,
        project: ["./tsconfig.scripts.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: typeAwareRules,
  },
  {
    files: [
      "src/components/**",
      "src/routes/**/*.tsx",
      "src/admin/**",
      "src/hooks/**",
      "src/lib/**",
    ],
    languageOptions: { globals: globals.browser },
  },
  { ...jsxA11y.flatConfigs.recommended, files: ["src/**/*.tsx"] },
  {
    files: ["tests/**", "src/**/*.test.*"],
    plugins: { vitest },
    rules: {
      "vitest/expect-expect": "error",
      "vitest/no-disabled-tests": "error",
      "vitest/no-focused-tests": "error",
      "vitest/no-conditional-expect": "error",
      "vitest/valid-expect": "error",
      "vitest/no-identical-title": "error",
    },
  },
  {
    files: ["src/server/lib/log.ts", "scripts/**"],
    rules: { "no-console": "off" },
  },
  {
    files: ["src/server/**"],
    ignores: ["src/server/lib/{env,runtime-env}.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "R14: read the environment in env.ts only" },
        { object: "Deno", property: "env", message: "R14: read the environment in env.ts only" },
      ],
    },
  },
  {
    files: ["src/server/**"],
    ignores: ADAPTER_FILES,
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "R32: call fetch only from the provider's adapter file" },
      ],
    },
  },
  ...syntaxBlocks(),
  eslintPluginPrettier,
  // Prettier looks for its config beside the file, and no folder above this one holds one.
  { files: ROOT_SCRIPTS, rules: { "prettier/prettier": ["error", prettierOptions] } },
);
