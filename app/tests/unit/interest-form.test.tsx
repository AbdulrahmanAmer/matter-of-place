// The interest signup (G15): the markets it sends, the source it carries, and when it tracks.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InterestForm } from "../../src/components/forms/interest-form";
import { track } from "../../src/lib/analytics";
import { services, ServiceError } from "../../src/services";

vi.mock("../../src/lib/analytics", () => ({ track: vi.fn() }));

const receipt = { id: "r1", receivedAt: "2026-10-04T10:00:00Z" };
const california = { name: "California", slug: "california" } as const;

function fillAndSend(email = "reader@example.com") {
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /Tell me when it opens/ }));
}

beforeEach(() => {
  vi.mocked(track).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InterestForm", () => {
  it("sends the market of its prop, with the source interest:<market>, and shows no chooser", async () => {
    const subscribe = vi.spyOn(services.newsletter, "subscribe").mockResolvedValue(receipt);
    render(<InterestForm scope="market" market={california} />);
    expect(screen.queryByRole("group")).toBeNull();
    fillAndSend();
    await waitFor(() => {
      expect(subscribe).toHaveBeenCalledTimes(1);
    });
    expect(subscribe).toHaveBeenCalledWith({
      email: "reader@example.com",
      source: "interest:california",
      markets: ["california"],
      website: "",
    });
  });

  it("sends the set the chooser holds", async () => {
    const subscribe = vi.spyOn(services.newsletter, "subscribe").mockResolvedValue(receipt);
    render(<InterestForm scope="home" />);
    expect(screen.getByRole("group", { name: "Where are you looking?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "California" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Florida" }));
    fillAndSend();
    await waitFor(() => {
      expect(subscribe).toHaveBeenCalledTimes(1);
    });
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ source: "interest:home", markets: ["california", "florida"] }),
    );
  });

  it("disables the button while the chooser is empty and there is no market", () => {
    render(<InterestForm scope="properties" />);
    const button = screen.getByRole("button", { name: /Tell me when it opens/ });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "New York" }));
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("renders one input named website", () => {
    const { container } = render(<InterestForm scope="home" />);
    expect(container.querySelectorAll('input[name="website"]')).toHaveLength(1);
  });

  it("tracks interest_signup once with the markets after a receipt, and says so by market", async () => {
    vi.spyOn(services.newsletter, "subscribe").mockResolvedValue(receipt);
    render(<InterestForm scope="market" market={california} />);
    fillAndSend();
    expect(
      await screen.findByText(
        "Thank you. We will write when the first California property is published.",
      ),
    ).toBeTruthy();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("interest_signup", { markets: ["california"] });
  });

  it("tracks nothing after a failure, keeps the form and says so calmly", async () => {
    vi.spyOn(services.newsletter, "subscribe").mockRejectedValue(
      new ServiceError("server", "down", 429),
    );
    render(<InterestForm scope="market" market={california} />);
    fillAndSend();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("This did not go through. Please try once more.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Tell me when it opens/ })).toBeTruthy();
    expect(track).not.toHaveBeenCalled();
  });
});
