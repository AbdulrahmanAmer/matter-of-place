import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminProviders } from "../ui/test-providers";
import { AskMatter } from "./AskMatter";

// Gap audit item 31: a change to a flow in plain words goes to Matter, who proposes it for approval.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AskMatter", () => {
  it("sends the change in words to Matter's thread, naming the flow and its event", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) => {
      if (path === "/api/admin/workforce/messages" && typeof init.body === "string") {
        sent.push(JSON.parse(init.body));
      }
      return Promise.resolve(Response.json({ id: "m1", woke: ["matter"] }));
    });
    render(
      <AdminProviders actions={["workforce.post_message"]}>
        <AskMatter recipe={{ name: "Request accepted", trigger: "submission.accepted" }} />
      </AdminProviders>,
    );
    fireEvent.change(screen.getByLabelText("The change, in your words"), {
      target: { value: "Also post a note to the team." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask Matter" }));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(sent).toEqual([
      {
        thread: "matter",
        body: '@matter Please change the flow "Request accepted" (event submission.accepted): Also post a note to the team. Propose it as an action for my approval.',
      },
    ]);
  });

  it("is not shown to a person who may not write to the team", () => {
    render(
      <AdminProviders actions={[]}>
        <AskMatter recipe={{ name: "Request accepted", trigger: "submission.accepted" }} />
      </AdminProviders>,
    );
    expect(screen.queryByRole("button", { name: "Ask Matter" })).toBeNull();
  });
});
