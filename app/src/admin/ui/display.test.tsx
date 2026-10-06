import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiffView } from "./DiffView";
import { Field } from "./Field";
import { JobWatcher } from "./JobWatcher";
import { LocalTime } from "./LocalTime";
import { StatusPill } from "./StatusPill";
import { Tabs } from "./Tabs";
import { Timeline } from "./Timeline";
import { ToastProvider } from "./Toast";
import { useToast } from "./use-toast";

afterEach(() => {
  vi.useRealTimers();
});

describe("LocalTime", () => {
  const winter = "2026-01-15T20:00:00Z";

  it("shows PT for california and ET for florida", () => {
    render(
      <>
        <LocalTime value={winter} marketSlug="california" />
        <LocalTime value={winter} marketSlug="florida" />
      </>,
    );
    const [california, florida] = screen.getAllByText(/[PE]T$/);
    expect(california?.textContent).toBe("Jan 15, 2026, 12:00 PM PT");
    expect(florida?.textContent).toBe("Jan 15, 2026, 3:00 PM ET");
  });

  it("falls back to ET with no market, and keeps the instant in dateTime", () => {
    render(<LocalTime value={winter} />);
    const time = screen.getByText(/ET$/);
    expect(time.getAttribute("datetime")).toBe(winter);
  });
});

describe("StatusPill", () => {
  it("names the state in words and carries its tone", () => {
    render(<StatusPill label="Declined" tone="danger" />);
    expect(screen.getByText("Declined").getAttribute("data-tone")).toBe("danger");
  });
});

describe("Timeline", () => {
  it("shows each entry with its actor and zone, and an agent pill only for an agent", () => {
    render(
      <Timeline
        marketSlug="california"
        entries={[
          {
            id: "1",
            at: "2026-01-15T20:00:00Z",
            text: "Accepted",
            actorName: "Ana",
            actorKind: "human",
          },
          {
            id: "2",
            at: "2026-01-15T21:00:00Z",
            text: "Published",
            actorName: "Key 4",
            actorKind: "agent",
          },
        ]}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByText("Agent")).toHaveLength(1);
    expect(screen.getByText("Jan 15, 2026, 1:00 PM PT")).not.toBeNull();
  });
});

describe("DiffView", () => {
  it("lists only the keys that changed, with redacted values as they arrive", () => {
    render(
      <DiffView
        before={{ id: "1", price: 100, email: { pii: "changed" }, note: "same" }}
        after={{ id: "1", price: 120, email: { pii: "changed" }, note: "same", state: "live" }}
      />,
    );
    expect(screen.getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
      "price",
      "state",
    ]);
    expect(screen.getByText("empty")).not.toBeNull();
  });

  it("says so when nothing changed", () => {
    render(<DiffView before={{ a: 1 }} after={{ a: 1 }} />);
    expect(screen.getByText("No changes.")).not.toBeNull();
  });
});

describe("JobWatcher", () => {
  it("shows queued, running, done and failed jobs by their state", () => {
    render(
      <JobWatcher
        jobs={[
          { id: "1", type: "send_email", status: "queued" },
          { id: "2", type: "render_variants", status: "running" },
          { id: "3", type: "purge_cache", status: "done" },
          { id: "4", type: "post_meta", status: "failed" },
          { id: "5", type: "post_x", status: "waiting_approval" },
        ]}
      />,
    );
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "send emailQueued",
      "render variantsRunning",
      "purge cacheDone",
      "post metaFailed",
      "post xwaiting approval",
    ]);
  });

  it("draws nothing when no job was started", () => {
    render(<JobWatcher jobs={[]} />);
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("Field", () => {
  it("ties the label, the hint and the error to its control", () => {
    render(
      <Field label="Reason" hint="3 to 500 characters" error="Too short">
        {(control) => <input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText("Reason");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const notes = document.getElementById(input.getAttribute("aria-describedby") ?? "");
    expect(notes?.textContent).toBe("3 to 500 charactersToo short");
    expect(screen.getByRole("alert").textContent).toBe("Too short");
  });
});

function TabsHarness() {
  const [active, setActive] = useState("narrative");
  const tabs = [
    { id: "narrative", label: "Narrative" },
    { id: "facts", label: "Facts" },
    { id: "sequence", label: "Sequence" },
  ];
  return (
    <Tabs label="Dossier" tabs={tabs} active={active} onChange={setActive}>
      <p>Panel {active}</p>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("moves with the arrow keys, wraps at the ends and names its panel", () => {
    render(<TabsHarness />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Narrative" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Facts" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Facts" }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Facts" }), { key: "End" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "Sequence" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Narrative" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("tabpanel", { name: "Narrative" }).textContent).toBe("Panel narrative");
  });
});

function ToastButton() {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        toast({ message: "Saved" });
      }}
    >
      Save
    </button>
  );
}

describe("Toast", () => {
  it("shows a message, takes it away on Dismiss and by itself after six seconds", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastButton />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Saved").closest("[data-print='hide']")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Saved")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText("Saved")).toBeNull();
  });
});
