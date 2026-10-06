import { screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mountRoutes, pageRoute } from "./test-router";
import { useUrlFilters } from "./use-url-filters";

function Page() {
  const filters = useUrlFilters(["state", "market"]);
  return (
    <div>
      <p data-testid="state">{filters.values.state ?? "-"}</p>
      <p data-testid="cursor">{filters.cursor ?? "-"}</p>
      <button
        type="button"
        onClick={() => {
          filters.setFilters({ state: "Accepted", market: "" });
        }}
      >
        Accepted
      </button>
      <button
        type="button"
        onClick={() => {
          filters.goNext("c2");
        }}
      >
        Next
      </button>
      <button type="button" disabled={!filters.hasPrevious} onClick={filters.goPrevious}>
        Previous
      </button>
    </div>
  );
}

async function mount(at: string) {
  const router = mountRoutes(
    () => <Page />,
    at,
    (root) => [pageRoute(root, "/admin/requests")],
  );
  await screen.findByRole("button", { name: "Accepted" });
  return router;
}

const text = (id: string) => screen.getByTestId(id).textContent;
const url = (router: Awaited<ReturnType<typeof mount>>) => router.state.location.href;

describe("useUrlFilters", () => {
  it("reads the filters and the cursor from the address", async () => {
    await mount("/admin/requests?state=Declined&cursor=c1&other=x");
    expect([text("state"), text("cursor")]).toEqual(["Declined", "c1"]);
  });

  it("replaces every filter, drops empty ones and returns to the first page", async () => {
    const router = await mount("/admin/requests?state=Declined&market=florida&cursor=c1");
    fireEvent.click(screen.getByRole("button", { name: "Accepted" }));
    await screen.findByText("Accepted", { selector: "p" });
    expect(url(router)).toBe("/admin/requests?state=Accepted");
    expect(text("cursor")).toBe("-");
  });

  it("walks forward by cursor and back through the cursors it came by", async () => {
    const router = await mount("/admin/requests?state=Declined");
    expect(screen.getByRole("button", { name: "Previous" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("c2");
    expect(url(router)).toBe("/admin/requests?state=Declined&cursor=c2");
    expect(screen.getByRole("button", { name: "Previous" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("-", { selector: "[data-testid='cursor']" });
    expect(url(router)).toBe("/admin/requests?state=Declined");
  });
});
