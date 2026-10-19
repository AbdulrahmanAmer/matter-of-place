import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderInRouter } from "../../../tests/fixtures/router";
import type { AccountPage } from "../../domain/account";
import { signOutAccountFn } from "../../lib/account.functions";
import { AccountPageView } from "./account-page";

// W6 item 8: the frame every page of the room shares. The server call is replaced, so no session is ever touched.

vi.mock("../../lib/account.functions", () => ({ signOutAccountFn: vi.fn() }));

type Data = { name: string; email: string; note: string };

const room: AccountPage<Data> = {
  state: "room",
  name: "Test Owner",
  email: "owner@example.test",
  note: "the page's own",
};

beforeEach(() => {
  vi.mocked(signOutAccountFn).mockReset().mockResolvedValue({ status: "signed-out" });
});

describe("AccountPageView", () => {
  it("names whose room it is, lists the pages of the room and shows the page's own", async () => {
    renderInRouter(<AccountPageView view={room}>{(data) => <p>{data.note}</p>}</AccountPageView>);
    expect(await screen.findByText("Signed in as Test Owner, owner@example.test.")).toBeTruthy();
    expect(screen.getByText("the page's own")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Your account" });
    expect(
      Array.from(nav.querySelectorAll("a")).map((link) => [
        link.textContent,
        link.getAttribute("href"),
      ]),
    ).toEqual([
      ["My properties", "/account/properties"],
      ["Invoices", "/account/invoices"],
      ["Credits", "/account/credits"],
      ["Reports", "/account/reports"],
    ]);
  });

  it("marks the page the visitor is on", async () => {
    renderInRouter(
      <AccountPageView view={room}>{(data) => <p>{data.note}</p>}</AccountPageView>,
      "/account/credits",
    );
    const current = await screen.findByRole("link", { name: "Credits" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Invoices" }).getAttribute("aria-current")).toBeNull();
  });

  it("sends a visitor without a session to the front page of the room, where the form is", async () => {
    const router = renderInRouter(
      <AccountPageView view={{ state: "signed-out" } as AccountPage<Data>}>
        {(data) => <p>{data.note}</p>}
      </AccountPageView>,
      "/account/credits",
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/account");
    });
    expect(screen.queryByText("the page's own")).toBeNull();
  });

  it("shows the calm page, and no data, for an address that holds no request", async () => {
    renderInRouter(
      <AccountPageView view={{ state: "unknown" } as AccountPage<Data>}>
        {(data) => <p>{data.note}</p>}
      </AccountPageView>,
    );
    expect(
      await screen.findByRole("heading", { name: "We could not find your account" }),
    ).toBeTruthy();
    expect(screen.queryByText("the page's own")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Your account" })).toBeNull();
  });

  it("signs out from the nav", async () => {
    renderInRouter(<AccountPageView view={room}>{(data) => <p>{data.note}</p>}</AccountPageView>);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => {
      expect(vi.mocked(signOutAccountFn)).toHaveBeenCalledTimes(1);
    });
  });
});
