// W9 item 1: the forms suggest the fix of a typo domain before anything is sent.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmailInput } from "../../src/components/forms/email-input";

describe("an email field", () => {
  it("offers the fix of a typo domain and takes it in one click", () => {
    render(
      <form>
        <EmailInput name="email" aria-label="Email address" />
      </form>,
    );
    const field = screen.getByLabelText<HTMLInputElement>("Email address");
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.change(field, { target: { value: "ann@gmial.com" } });
    expect(screen.getByRole("status").textContent).toBe("Did you mean ann@gmail.com?");
    fireEvent.click(screen.getByRole("button", { name: "Use ann@gmail.com" }));
    expect(field.value).toBe("ann@gmail.com");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says nothing for an address that looks right", () => {
    render(<EmailInput name="email" aria-label="Email address" />);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "ann@gmail.com" },
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
