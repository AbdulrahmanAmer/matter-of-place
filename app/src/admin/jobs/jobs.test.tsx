import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import { AdminMeContext, type AdminMe } from "../ui/admin-me";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { ToastProvider } from "../ui/Toast";
import type { Job } from "./jobs-queries";
import { JobsPage } from "./JobsPage";
import { JobsTable } from "./JobsTable";

const PROPERTY = "3f2a9c1d-0000-4000-8000-000000000001";
const OTHER_PROPERTY = "9b8e7d6c-0000-4000-8000-000000000002";
const DEAD = "00000000-0000-4000-8000-0000000000a1";
const SYSTEM = "00000000-0000-4000-8000-0000000000a2";
const CAPTIONS = "00000000-0000-4000-8000-0000000000a3";
const WAITING = "00000000-0000-4000-8000-0000000000a4";

const job = (id: string, over: Partial<Job> = {}): Job => ({
  id,
  type: "send_email",
  status: "done",
  attempts: 1,
  max_attempts: 5,
  run_after: "2026-10-05T14:00:00Z",
  run_local: false,
  payload: { params: {}, data: {} },
  result: null,
  error: null,
  idempotency_key: `send_email:${id}:1`,
  created_at: "2026-10-05T14:00:00Z",
  finished_at: "2026-10-05T14:00:03Z",
  ...over,
});

const dead = job(DEAD, {
  status: "dead",
  attempts: 5,
  error: "provider_down",
  finished_at: "2026-10-05T14:09:00Z",
  payload: { params: {}, data: { property_id: PROPERTY } },
});
const system = job(SYSTEM, { type: "health" });
const captions = job(CAPTIONS, {
  type: "write_captions",
  status: "queued",
  run_local: true,
  finished_at: null,
});
const waiting = job(WAITING, {
  type: "post_x",
  status: "waiting_approval",
  finished_at: null,
  payload: { params: {}, data: { asset_id: OTHER_PROPERTY } },
});

const operatorActions = [
  "jobs.list",
  "jobs.get",
  "jobs.retry",
  "jobs.cancel",
  "jobs.approve",
  "jobs.retry_bulk",
];
const readerActions = ["jobs.list", "jobs.get"];

const signedIn: AdminMe = {
  actor: { id: "u1" },
  kind: "human",
  roles: ["media_ops"],
  scopes: [],
  actions: [],
  environment: "production",
};

function providers(actions: string[], children: ReactNode) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AdminMeContext value={{ ...signedIn, actions }}>
        <ToastProvider>{children}</ToastProvider>
      </AdminMeContext>
    </QueryClientProvider>
  );
}

const page = (items: Job[], next_cursor: string | null = null) => ({ items, next_cursor });

const LIST = "/api/admin/jobs";
const DEAD_LIST = `${LIST}?dead_only=true&limit=5`;

// jsdom has no showModal or close on <dialog>; these toggle `open` as the browser's do (as in dialogs.test.tsx).
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JobsTable", () => {
  const filters = { values: {}, onChange: () => undefined };
  const mount = (rows: Job[]) =>
    render(providers(operatorActions, <JobsTable rows={rows} filters={filters} />));

  it("names the property of a job whose payload data has property_id and links to its jobs", () => {
    mount([dead]);
    const link = screen.getByRole("link", { name: "property 3f2a9c1d" });
    expect(link.getAttribute("href")).toBe(`/admin/jobs?entity=${PROPERTY}`);
  });

  it("shows system for a job whose payload data is empty", () => {
    mount([system]);
    expect(within(screen.getByRole("table")).getByText("system")).toBeTruthy();
    expect(screen.queryAllByRole("link")).toEqual([]);
  });

  it("takes the first entity key in jobEntityKeys order when a payload names two", () => {
    mount([
      job(SYSTEM, {
        payload: { params: {}, data: { asset_id: OTHER_PROPERTY, submission_id: DEAD } },
      }),
    ]);
    expect(screen.getByRole("link", { name: "submission 00000000" }).getAttribute("href")).toBe(
      `/admin/jobs?entity=${DEAD}`,
    );
  });

  it("reads a queued job for the laptop runner as waiting for the caption runner", () => {
    mount([captions, job(SYSTEM, { status: "queued", finished_at: null })]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[2]?.textContent)).toEqual([
      "waiting for the caption runner",
      "Queued",
    ]);
  });

  it("marks a dead job red and shows its attempts, error and times", () => {
    mount([dead]);
    const row = within(screen.getByRole("row", { name: /send email/ }));
    expect(row.getByText("Dead").getAttribute("data-tone")).toBe("danger");
    expect(row.getByText("5 of 5")).toBeTruthy();
    expect(row.getByText("provider_down")).toBeTruthy();
  });
});

describe("JobsPage", () => {
  const retryRoute = `POST /api/admin/jobs/${DEAD}/retry`;
  const writes = (requested: string[]) => requested.filter((line) => line.startsWith("POST"));
  const tableReads = (requested: string[]) => requested.filter((line) => line === `GET ${LIST}`);

  function open(actions: string[], at: string, answers: Record<string, unknown>) {
    const requested = serve(answers);
    mountRoutes(
      () => providers(actions, <Outlet />),
      at,
      (root) => [pageRoute(root, "/admin/jobs/", () => <JobsPage />)],
    );
    return requested;
  }

  it("pins the dead jobs in red above the table", async () => {
    open(operatorActions, "/admin/jobs/", {
      [`GET ${LIST}`]: page([dead, system]),
      [`GET ${DEAD_LIST}`]: page([dead]),
    });
    const banner = await screen.findByRole("region", { name: "Dead jobs" });
    expect(banner.getAttribute("data-tone")).toBe("danger");
    expect(within(banner).getByText("provider_down")).toBeTruthy();
    expect(within(banner).getByText("Dead").getAttribute("data-tone")).toBe("danger");
  });

  it("draws no banner when no job is dead", async () => {
    open(operatorActions, "/admin/jobs/", {
      [`GET ${LIST}`]: page([system]),
      [`GET ${DEAD_LIST}`]: page([]),
    });
    await screen.findByRole("table", { name: "Jobs" });
    expect(screen.queryByRole("region", { name: "Dead jobs" })).toBeNull();
  });

  it("reads the list again after Retry, and posts once to the retry route", async () => {
    const requested = open(operatorActions, "/admin/jobs/", {
      [`GET ${LIST}`]: page([dead]),
      [`GET ${DEAD_LIST}`]: page([dead]),
      [retryRoute]: { id: DEAD, status: "queued" },
    });
    const banner = await screen.findByRole("region", { name: "Dead jobs" });
    expect(tableReads(requested)).toHaveLength(1);
    fireEvent.click(within(banner).getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(tableReads(requested)).toHaveLength(2);
    });
    expect(writes(requested)).toEqual([retryRoute]);
  });

  it("gives a reader the jobs and no action", async () => {
    open(readerActions, "/admin/jobs/", {
      [`GET ${LIST}`]: page([dead]),
      [`GET ${DEAD_LIST}`]: page([dead]),
    });
    const banner = await screen.findByRole("region", { name: "Dead jobs" });
    expect(within(banner).queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry all matching" })).toBeNull();
  });

  it("offers Retry all matching only for a type, and posts one retry-bulk with that type", async () => {
    const requested = open(operatorActions, "/admin/jobs/?type=send_email", {
      [`GET ${LIST}?type=send_email`]: page([dead]),
      [`GET ${DEAD_LIST}&type=send_email`]: page([dead]),
      "POST /api/admin/jobs/retry-bulk": { count: 3 },
    });
    const banner = await screen.findByRole("region", { name: "Dead jobs" });
    fireEvent.click(within(banner).getByRole("button", { name: "Retry all matching" }));
    expect(writes(requested)).toEqual([]);
    const dialog = within(screen.getByRole("dialog", { name: "Retry all matching dead jobs" }));
    fireEvent.click(dialog.getByRole("button", { name: "Retry dead jobs" }));
    await waitFor(() => {
      expect(writes(requested)).toEqual(['POST /api/admin/jobs/retry-bulk {"type":"send_email"}']);
    });
    expect(await screen.findByText("3 dead jobs queued again.")).toBeTruthy();
  });

  it("tells the person to filter by a type when none is set", async () => {
    open(operatorActions, "/admin/jobs/", {
      [`GET ${LIST}`]: page([dead]),
      [`GET ${DEAD_LIST}`]: page([dead]),
    });
    const banner = await screen.findByRole("region", { name: "Dead jobs" });
    expect(within(banner).getByText(/Filter the table by a type/)).toBeTruthy();
    expect(within(banner).queryByRole("button", { name: "Retry all matching" })).toBeNull();
  });

  it("asks the list for the filters of the form", async () => {
    const requested = open(operatorActions, "/admin/jobs/", {
      [`GET ${LIST}`]: page([system]),
      [`GET ${DEAD_LIST}`]: page([]),
      [`GET ${LIST}?status=failed&q=timeout`]: page([]),
    });
    await screen.findByRole("table", { name: "Jobs" });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "failed" } });
    fireEvent.change(screen.getByLabelText("Error contains"), { target: { value: "timeout" } });
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(await screen.findByText("No jobs match")).toBeTruthy();
    expect(requested).toContain(`GET ${LIST}?status=failed&q=timeout`);
  });

  it("keeps the entity filter of the address and offers the whole list back", async () => {
    const requested = open(operatorActions, `/admin/jobs/?entity=${PROPERTY}`, {
      [`GET ${LIST}?entity=${PROPERTY}`]: page([dead]),
      [`GET ${DEAD_LIST}`]: page([]),
    });
    await screen.findByRole("link", { name: "property 3f2a9c1d" });
    expect(screen.getByRole("link", { name: "Show every job" }).getAttribute("href")).toBe(
      "/admin/jobs",
    );
    expect(requested).toContain(`GET ${LIST}?entity=${PROPERTY}`);
  });

  it("walks to the next page with the cursor of the first", async () => {
    const cursor = "2026-10-05T14:00:00+00:00~00000000-0000-4000-8000-0000000000a1";
    const nextQuery = new URLSearchParams({ cursor }).toString();
    const requested = open(operatorActions, "/admin/jobs/", {
      [`GET ${LIST}`]: page([dead], cursor),
      [`GET ${DEAD_LIST}`]: page([]),
      [`GET ${LIST}?${nextQuery}`]: page([system]),
    });
    await screen.findByRole("table", { name: "Jobs" });
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    expect(await screen.findByText("system")).toBeTruthy();
    expect(requested).toContain(`GET ${LIST}?${nextQuery}`);
  });

  describe("the open job", () => {
    const detail = (over: Partial<Job> = {}) => ({
      ...job(DEAD, over),
      events: [
        {
          id: 1,
          at: "2026-10-05T14:00:00Z",
          kind: "created",
          from_status: null,
          to_status: "queued",
          attempt: 0,
          message: null,
        },
        {
          id: 2,
          at: "2026-10-05T14:09:00Z",
          kind: "dead",
          from_status: "running",
          to_status: "dead",
          attempt: 5,
          message: "provider_down",
        },
      ],
    });

    it("opens from a row, shows the payload and the history, and closes", async () => {
      open(operatorActions, "/admin/jobs/", {
        [`GET ${LIST}`]: page([dead]),
        [`GET ${DEAD_LIST}`]: page([]),
        [`GET ${LIST}/${DEAD}`]: detail({ status: "dead", payload: dead.payload }),
      });
      await screen.findByRole("link", { name: "property 3f2a9c1d" });
      fireEvent.click(screen.getByRole("row", { name: /send email/ }));
      const drawer = within(await screen.findByRole("dialog", { name: "send email" }));
      expect(await drawer.findByText(/"property_id": "3f2a9c1d/)).toBeTruthy();
      expect(drawer.getByText("created")).toBeTruthy();
      expect(drawer.getByText("dead, running to dead: provider_down")).toBeTruthy();
      fireEvent.click(drawer.getByRole("button", { name: "Close" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "send email" })).toBeNull();
      });
    });

    it("opens from the job in the address", async () => {
      open(operatorActions, `/admin/jobs/?job=${DEAD}`, {
        [`GET ${LIST}`]: page([dead]),
        [`GET ${DEAD_LIST}`]: page([]),
        [`GET ${LIST}/${DEAD}`]: detail({ status: "dead" }),
      });
      expect(await screen.findByRole("dialog", { name: "send email" })).toBeTruthy();
    });

    it("asks before it cancels a queued job, then posts once to its cancel route", async () => {
      const cancelRoute = `POST /api/admin/jobs/${DEAD}/cancel`;
      const requested = open(operatorActions, `/admin/jobs/?job=${DEAD}`, {
        [`GET ${LIST}`]: page([]),
        [`GET ${DEAD_LIST}`]: page([]),
        [`GET ${LIST}/${DEAD}`]: detail({ status: "queued" }),
        [cancelRoute]: { id: DEAD, status: "cancelled" },
      });
      const drawer = within(await screen.findByRole("dialog", { name: "send email" }));
      fireEvent.click(await drawer.findByRole("button", { name: "Cancel job" }));
      expect(writes(requested)).toEqual([]);
      const confirm = within(screen.getByRole("dialog", { name: "Cancel this job" }));
      fireEvent.click(confirm.getByRole("button", { name: "Cancel job" }));
      await waitFor(() => {
        expect(writes(requested)).toEqual([cancelRoute]);
      });
    });

    it("offers Approve, not Retry, for a job waiting for approval and posts once to its approve route", async () => {
      const approveRoute = `POST /api/admin/jobs/${WAITING}/approve`;
      const requested = open(operatorActions, `/admin/jobs/?job=${WAITING}`, {
        [`GET ${LIST}`]: page([waiting]),
        [`GET ${DEAD_LIST}`]: page([]),
        [`GET ${LIST}/${WAITING}`]: { ...detail({ status: "waiting_approval" }), id: WAITING },
        [approveRoute]: { id: WAITING, status: "queued" },
      });
      const drawer = within(await screen.findByRole("dialog", { name: "send email" }));
      fireEvent.click(await drawer.findByRole("button", { name: "Approve" }));
      expect(drawer.queryByRole("button", { name: "Retry" })).toBeNull();
      fireEvent.click(
        within(screen.getByRole("dialog", { name: "Approve this job" })).getByRole("button", {
          name: "Approve",
        }),
      );
      await waitFor(() => {
        expect(writes(requested)).toEqual([approveRoute]);
      });
    });
  });
});
