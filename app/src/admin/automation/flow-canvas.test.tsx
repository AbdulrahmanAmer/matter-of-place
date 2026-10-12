import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Step, StepSpecView } from "./automation-queries";
import { FlowCanvas } from "./FlowCanvas";
import { gateOf } from "./flow-gate";

// Operator, 2026-10-12: a recipe drawn as nodes. The drawing is a chain in the runner's order; "+" inserts a step at
// its place, a drop moves a step, and a gate names the conditions on the line into a step.

const spec = (type: string, label: string): StepSpecView => ({
  type,
  label,
  description: "",
  implemented: true,
  heavy: false,
  local: false,
  fields: [],
});
const specs = [spec("purge_cache", "Purge cache"), spec("post_meta", "Post to Meta")];
const step = (id: string, type: string, extra: Partial<Step> = {}): Step => ({
  id,
  step_type: type,
  params: {},
  enabled: true,
  requires_approval: false,
  conditions: {},
  ...extra,
});

function canvas(steps: Step[]) {
  const onInsert = vi.fn<(index: number, chosen: StepSpecView) => void>();
  const onMoveTo = vi.fn<(from: number, to: number) => void>();
  const onSelect = vi.fn();
  render(
    <FlowCanvas
      event="property.published"
      steps={steps}
      specs={specs}
      canEdit
      selected={null}
      onSelect={onSelect}
      onInsert={onInsert}
      onMoveTo={onMoveTo}
    />,
  );
  return { onInsert, onMoveTo, onSelect };
}

describe("FlowCanvas", () => {
  it("draws the event, each step in order and the end", () => {
    canvas([step("purge_cache", "purge_cache"), step("post_meta", "post_meta")]);
    const flow = screen.getByRole("group", { name: "The recipe as a flow" });
    const names = within(flow)
      .getAllByRole("button", { pressed: false })
      .map((button) => button.textContent);
    expect(names).toEqual(["1Purge cache", "2Post to Meta"]);
    expect(within(flow).getByText("property.published")).toBeTruthy();
  });

  it("inserts the chosen step at the place of the + pressed", () => {
    const { onInsert } = canvas([step("purge_cache", "purge_cache")]);
    fireEvent.click(screen.getByRole("button", { name: "Insert a step at 2" }));
    fireEvent.click(
      within(screen.getByRole("list", { name: "Steps you can add" })).getByRole("button", {
        name: "Post to Meta",
      }),
    );
    expect(onInsert.mock.calls.map(([index, chosen]) => [index, chosen.type])).toEqual([
      [1, "post_meta"],
    ]);
  });

  it("moves a dragged step to the place it is dropped on", () => {
    const { onMoveTo } = canvas([
      step("a", "purge_cache"),
      step("b", "post_meta"),
      step("c", "purge_cache"),
    ]);
    const nodes = screen.getAllByRole("button", { pressed: false }).flatMap((button) => {
      const node = button.closest("li");
      return node === null ? [] : [node];
    });
    const [first, , third] = nodes;
    if (first === undefined || third === undefined) throw new Error("nodes missing");
    fireEvent.dragStart(third, { dataTransfer: { effectAllowed: "" } });
    fireEvent.dragOver(first);
    fireEvent.drop(first);
    expect(onMoveTo.mock.calls).toEqual([[2, 0]]);
  });

  it("names the conditions on the line into a step, and nothing for a step that always runs", () => {
    expect([gateOf({ tiers: ["Feature"], markets: ["new-york", "florida"] }), gateOf({})]).toEqual([
      "Only Feature, New York, Florida",
      null,
    ]);
  });
});
