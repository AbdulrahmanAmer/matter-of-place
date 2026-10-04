// The empty-state block: one view event per mount, one h2 and no h1, the words of its scope.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComingSoon } from "../../src/components/site/coming-soon";
import { track } from "../../src/lib/analytics";
import { t } from "../../src/lib/strings";

vi.mock("../../src/lib/analytics", () => ({ track: vi.fn() }));

const california = { name: "California", slug: "california" } as const;

beforeEach(() => {
  vi.mocked(track).mockClear();
});

describe("ComingSoon", () => {
  it("tracks coming_soon_view once across three re-renders", () => {
    const { rerender } = render(<ComingSoon scope="stories" />);
    rerender(<ComingSoon scope="stories" />);
    rerender(<ComingSoon scope="stories" />);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("coming_soon_view", { scope: "stories" });
  });

  it("renders one h2 and no h1", () => {
    render(<ComingSoon scope="home" />);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
  });

  it("shows the title of the stories scope", () => {
    render(<ComingSoon scope="stories" />);
    expect(screen.getByRole("heading", { name: t.comingSoon.stories.title })).toBeTruthy();
  });

  it("names the market in the title and preselects it", () => {
    render(<ComingSoon scope="market" market={california} />);
    expect(
      screen.getByRole("heading", { name: "No property is listed in California yet." }),
    ).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
  });
});
