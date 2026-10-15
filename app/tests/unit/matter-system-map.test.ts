import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { renderMap, systemMap, type Live } from "../../scripts/matter/system-map.ts";
import { mapDue } from "../../scripts/workforce/follow.ts";

// W6 item 3: Matter's system map follows each page and route to its service, its database functions, their tables,
// the events they write, the flow of each event and the colleagues who wake on it; what it cannot follow is listed.

function put(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "system-map-"));
  put(
    root,
    "src/routes/api/admin/submissions.$id.accept.ts",
    `import { createFileRoute } from "@tanstack/react-router";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { accept } from "../../../server/submissions/service";

export const Route = createFileRoute("/api/admin/submissions/$id/accept")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "submissions.accept",
        handler: (ctx, input) => accept(ctx.actor, ctx.db, input),
      }),
    },
  },
});
`,
  );
  put(
    root,
    "src/routes/api/admin/broken.ts",
    `import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/broken")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "broken.get",
        handler: (ctx) => localOnly(ctx),
      }),
    },
  },
});
`,
  );
  put(root, "src/server/lib/admin-route.ts", "export function defineAdminRoute() {}\n");
  put(
    root,
    "src/server/submissions/service.ts",
    `// accept reads jobs through a local helper; decline's table is not accept's.
export async function accept(actor, db, input) {
  const { data } = await db.rpc("accept_submission", { p_submission_id: input.id });
  return afterDecision(db, data);
}

async function afterDecision(db, data) {
  await db.from("jobs").select("id").eq("id", data.job_id);
  await db.rpc("missing_function", {});
  return data;
}

export async function decline(actor, db, input) {
  await db.from("declines").insert({ id: input.id });
}
`,
  );
  put(
    root,
    "supabase/sql/functions/accept_submission.sql",
    `create or replace function public.accept_submission(p_submission_id uuid)
returns jsonb language plpgsql as $$
begin
  -- a comment naming public.not_a_table is not code
  update public.submissions s set status = 'accepted' where s.id = p_submission_id;
  perform 1 from public.payments p where p.submission_id = p_submission_id;
  perform public.write_audit('submissions.accept', p_submission_id);
  return public.emit_event(
    'submission.accepted', 'submission', p_submission_id, '{}'::jsonb, null
  );
end;
$$;
`,
  );
  put(
    root,
    "supabase/sql/functions/write_audit.sql",
    `create or replace function public.write_audit(p_action text, p_id uuid)
returns void language sql as $$
  insert into public.audit_log (action, subject_id) values (p_action, p_id);
$$;
`,
  );
  put(
    root,
    "supabase/sql/functions/create_inquiry.sql",
    `create or replace function public.create_inquiry(p jsonb)
returns uuid language plpgsql as $$
begin
  insert into public.inquiries (body) values (p);
  return public.emit_event('inquiry.received', 'inquiry', null, p, null);
end;
$$;
`,
  );
  put(
    root,
    "src/domain/events.ts",
    `export const eventTypes = ["submission.accepted", "inquiry.received", "digest.due"] as const;\n`,
  );
  put(
    root,
    "src/server/public/routes.ts",
    `import * as inquiries from "../inquiries/service";

export const routes = [
  {
    path: "/api/public/inquiries",
    method: "POST",
    turnstile: true,
    status: 201,
    service: inquiries.create,
  },
];
`,
  );
  put(
    root,
    "src/server/inquiries/service.ts",
    `export async function create(db, input) {
  const { data } = await db.rpc("create_inquiry", { p: input });
  return data;
}
`,
  );
  put(
    root,
    "src/routes/api/public/inquiries.ts",
    `import { createFileRoute } from "@tanstack/react-router";
import { handlePublic } from "../../../server/public/pipeline";

export const Route = createFileRoute("/api/public/inquiries")({
  server: { handlers: { ANY: ({ request, context }) => handlePublic(request, context.requestId) } },
});
`,
  );
  put(
    root,
    "src/services/http/index.ts",
    `export function createHttpServices(baseUrl) {
  const api = createApiClient(baseUrl);

  const inquiries: InquiryService = {
    send: async (input) => {
      return api.post("/inquiries", input, receiptSchema);
    },
  };

  return { inquiries };
}
`,
  );
  put(
    root,
    "src/routes/_site.contact.tsx",
    `import { createFileRoute } from "@tanstack/react-router";
import { ContactForm } from "../components/contact-form";

export const Route = createFileRoute("/_site/contact")({ component: () => <ContactForm /> });
`,
  );
  put(
    root,
    "src/components/contact-form.tsx",
    `import { services } from "../services";

export function ContactForm() {
  return <form onSubmit={() => services.inquiries.send({})} />;
}
`,
  );
  put(
    root,
    "src/routes/admin/requests.index.tsx",
    `import { createFileRoute } from "@tanstack/react-router";
import { RequestsPage } from "../../admin/requests/RequestsPage";

export const Route = createFileRoute("/admin/requests/")({ component: RequestsPage });
`,
  );
  put(
    root,
    "src/admin/requests/RequestsPage.tsx",
    `import { acceptRequest } from "./requests-api";

export function RequestsPage() {
  return <button onClick={() => acceptRequest("1")}>Accept</button>;
}
`,
  );
  put(
    root,
    "src/admin/requests/requests-api.ts",
    "export const acceptRequest = (id: string) => adminFetch(`/api/admin/submissions/${id}/accept`);\n",
  );
  return root;
}

const live: Live = {
  recipes: [
    {
      trigger: "submission.accepted",
      enabled: true,
      steps: [
        { step_type: "send_email", params: { template: "acceptance" } },
        { step_type: "notify_admin", enabled: false, params: {} },
      ],
    },
  ],
  agents: [
    { slug: "concierge", wake_on: ["submission.accepted", "inquiry.received"] },
    { slug: "social", wake_on: null },
  ],
};

describe("Matter's system map (W6 item 3)", () => {
  it("follows a route to its service, its database functions, their tables, the event and who wakes on it", () => {
    const map = systemMap(fixture(), live);
    const accept = map.routes.find((route) => route.path === "/api/admin/submissions/$id/accept");
    expect(accept).toMatchObject({
      method: "POST",
      action: "submissions.accept",
      service: "src/server/submissions/service.ts#accept",
      effects: {
        calls: ["accept_submission", "missing_function", "write_audit"],
        writes: ["audit_log", "submissions"],
        reads: ["jobs", "payments"],
        events: ["submission.accepted"],
      },
    });
    expect(map.events.find((event) => event.type === "submission.accepted")).toEqual({
      type: "submission.accepted",
      emittedBy: ["accept_submission"],
      steps: ["send_email", "notify_admin (off)"],
      emails: ["acceptance"],
      wakes: ["concierge"],
    });
    expect(map.events.find((event) => event.type === "digest.due")).toMatchObject({
      emittedBy: [],
      wakes: [],
    });
  });

  it("follows the public route table and the pages to the routes they call", () => {
    const map = systemMap(fixture(), live);
    expect(map.routes.find((route) => route.path === "/api/public/inquiries")).toMatchObject({
      service: "src/server/inquiries/service.ts#create",
      effects: { writes: ["inquiries"], events: ["inquiry.received"] },
    });
    expect(map.pages).toEqual([
      {
        kind: "admin",
        path: "/admin/requests",
        files: ["src/routes/admin/requests.index.tsx"],
        api: ["POST /api/admin/submissions/$id/accept"],
      },
      {
        kind: "public",
        path: "/contact",
        files: ["src/routes/_site.contact.tsx"],
        api: ["POST /api/public/inquiries"],
      },
    ]);
  });

  it("lists what it cannot follow under Unmapped with its file, and never drops it", () => {
    const map = systemMap(fixture(), null);
    expect(map.unmapped).toEqual([
      {
        what: "GET /api/admin/broken",
        file: "src/routes/api/admin/broken.ts",
        why: "handler (none) is not an imported function",
      },
      {
        what: "POST /api/admin/submissions/$id/accept calls missing_function",
        file: "src/routes/api/admin/submissions.$id.accept.ts",
        why: "no SQL file creates this function",
      },
      {
        what: "flows and wake rules",
        file: "automation_recipes, agents.wake_on",
        why: "no database connection: run with the runner's .env",
      },
    ]);
    expect(map.routes.map((route) => route.path)).toContain("/api/admin/broken");
    const text = renderMap(map);
    expect(text).toContain("## 6 Unmapped (3)");
    expect(text).toContain("- submissions: POST /api/admin/submissions/$id/accept");
  });

  // Reads the whole app tree (about 2 s alone, more under a full run's load, P-3450).
  it("maps every route file and every page of the app itself", { timeout: 30_000 }, () => {
    const app = join(import.meta.dirname, "../..");
    const map = systemMap(app, null);
    const files = (dir: string): string[] =>
      readdirSync(join(app, dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
      );
    const mapped = new Set([
      ...map.routes.map((route) => route.file),
      ...map.pages.flatMap((page) => page.files),
      ...map.unmapped.map((item) => item.file),
    ]);
    const publicPaths = new Set(map.routes.map((route) => route.path));
    const missing = files("src/routes")
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => {
        const name = relative("src/routes", file).replaceAll("\\", "/");
        if (name === "__root.tsx" || !(name.startsWith("api/") || name.startsWith("admin") || name.startsWith("_site"))) {
          return false;
        }
        if (mapped.has(file)) return false;
        // A public API file only calls handlePublic: its path is in the route table instead.
        const path = `/${name.replace(/\.ts$/, "").replace(/\./g, "/").replace(/\$(\w+)/g, ":$1")}`;
        return !publicPaths.has(path);
      });
    expect(missing).toEqual([]);
  });
});

describe("When the runner writes the map", () => {
  it("writes it after the runner moves to a new main, or when it is missing, and only in the runner", () => {
    expect(mapDue("moved", true)).toBe(true);
    expect(mapDue("moved and installed", true)).toBe(true);
    expect(mapDue("unchanged", true)).toBe(false);
    expect(mapDue("unchanged", false)).toBe(true);
    expect(mapDue("not the runner", false)).toBe(false);
    expect(mapDue("moved, install failed", true)).toBe(false);
  });
});
