import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminProviders } from "../ui/test-providers";
import { MediaGrid } from "./MediaGrid";
import { VariantStatus } from "./VariantStatus";

// Screen 9 (B7 step 8) in jsdom, with `fetch` stubbed (P-2128).

const PROPERTY = "00000000-0000-4000-8000-0000000000b1";
const MEDIA = "00000000-0000-4000-8000-0000000000a1";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VariantStatus", () => {
  it("offers Retry on a failed render to an actor who may retry a job", () => {
    const onRetry = vi.fn();
    render(
      <AdminProviders actions={["jobs.retry"]}>
        <VariantStatus state="failed" propertyId={PROPERTY} onRetry={onRetry} />
      </AdminProviders>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect({
      retried: onRetry.mock.calls.length,
      note: screen.queryByText(/media ops can retry it/),
    }).toEqual({ retried: 1, note: null });
  });

  it("shows a visual editor no button, and the note with Jobs filtered to the property", () => {
    render(
      <AdminProviders actions={["media.attach", "media.alt"]}>
        <VariantStatus state="failed" propertyId={PROPERTY} onRetry={vi.fn()} />
      </AdminProviders>,
    );
    expect({
      buttons: screen.queryAllByRole("button").length,
      note: screen.getByText(/Render failed, media ops can retry it in/).textContent,
      link: screen.getByRole("link", { name: "Jobs" }).getAttribute("href"),
    }).toEqual({
      buttons: 0,
      note: "Render failed, media ops can retry it in Jobs.",
      link: `/admin/jobs?entity=${PROPERTY}`,
    });
  });
});

describe("MediaGrid", () => {
  it("stages a picked JPEG, puts it on the signed URL and attaches it; a text file is named and left out", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) => {
      requested.push(`${init.method ?? "GET"} ${path.split("?")[0] ?? ""}`);
      if (path.startsWith("/api/admin/media/upload-url")) {
        return Promise.resolve(
          Response.json({
            media_id: MEDIA,
            path: `staging/${PROPERTY}/${MEDIA}.jpg`,
            url: "https://storage.test/upload",
          }),
        );
      }
      if (path === "/api/admin/media/attach") {
        return Promise.resolve(
          Response.json({ media_id: MEDIA, sort_order: 0, render_job_id: null }),
        );
      }
      if (path === "https://storage.test/upload") return Promise.resolve(new Response("{}"));
      return Promise.resolve(Response.json({ items: [] }));
    });
    render(
      <AdminProviders actions={["media.attach"]}>
        <MediaGrid propertyId={PROPERTY} />
      </AdminProviders>,
    );
    const input = await screen.findByLabelText("Add photographs");
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array([0xff, 0xd8, 0xff])], "hall.jpg", { type: "image/jpeg" }),
          new File(["text"], "notes.txt", { type: "text/plain" }),
        ],
      },
    });
    await waitFor(() => {
      expect(requested).toContain("POST /api/admin/media/attach");
    });
    expect({
      writes: requested.filter((line) => !line.startsWith("GET")),
      refused: screen.getByRole("alert").textContent,
    }).toEqual({
      writes: [
        "POST /api/admin/media/upload-url",
        "PUT https://storage.test/upload",
        "POST /api/admin/media/attach",
      ],
      refused: "Not added: notes.txt.",
    });
  });
});
