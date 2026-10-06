import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";
import { Drawer } from "./Drawer";

// jsdom has no showModal or close on <dialog>; these stand in for the browser's, which only toggle `open`.
// The focus trap and the focus return under test are the component's own and do not depend on them.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open details
      </button>
      <Drawer
        open={open}
        title="Inquiry"
        onClose={() => {
          setOpen(false);
        }}
      >
        <button type="button">Assign</button>
        <button type="button">Forward</button>
      </Drawer>
    </>
  );
}

const key = (name: string, init: KeyboardEventInit = {}) => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: name, ...init });
};

describe("Drawer", () => {
  it("moves focus in, keeps Tab inside and gives focus back on close", () => {
    render(<DrawerHarness />);
    const opener = screen.getByRole("button", { name: "Open details" });
    opener.focus();
    fireEvent.click(opener);
    const [close, assign, forward] = [
      screen.getByRole("button", { name: "Close" }),
      screen.getByRole("button", { name: "Assign" }),
      screen.getByRole("button", { name: "Forward" }),
    ];
    expect(document.activeElement).toBe(close);
    forward.focus();
    key("Tab");
    expect(document.activeElement).toBe(close);
    key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(forward);
    assign.focus();
    expect(fireEvent.keyDown(assign, { key: "Tab" })).toBe(true);
    fireEvent.click(close);
    expect(document.activeElement).toBe(opener);
  });

  it("closes on Escape and on the backdrop, not on a click inside", () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Inquiry" onClose={onClose}>
        <p>Details</p>
      </Drawer>,
    );
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();
    const escape = new Event("cancel", { cancelable: true });
    dialog?.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Details"));
    expect(onClose).toHaveBeenCalledTimes(1);
    if (dialog !== null) fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("draws nothing inside while closed", () => {
    render(
      <Drawer open={false} title="Inquiry" onClose={vi.fn()}>
        <p>Details</p>
      </Drawer>,
    );
    expect(screen.queryByText("Details")).toBeNull();
  });
});

describe("ConfirmDialog", () => {
  it("sends the action once on Confirm and leaves it unsent on Cancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Decline this request"
        confirmLabel="Decline"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        The submitter is emailed.
      </ConfirmDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("turns Confirm off while the action is pending", () => {
    render(
      <ConfirmDialog
        open
        pending
        title="Publish"
        confirmLabel="Publish"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
  });

  it("is a native dialog with a name, never a hand-set role", () => {
    render(
      <ConfirmDialog
        open
        title="Publish"
        confirmLabel="Publish"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = document.querySelector("dialog");
    expect(dialog?.getAttribute("aria-label")).toBe("Publish");
    expect(dialog?.hasAttribute("role")).toBe(false);
  });
});
