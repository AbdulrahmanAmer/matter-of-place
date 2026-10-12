import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { standInForDialogs } from "../ui/test-dialog";
import { NewPropertyDialog } from "./NewPropertyDialog";

// Operator, 2026-10-12: a property entered by hand. The dialog checks its own fields and hands the parsed input on.

beforeAll(standInForDialogs);

function dialog() {
  const onCreate = vi.fn();
  render(
    <NewPropertyDialog open pending={false} refusal={null} onClose={vi.fn()} onCreate={onCreate} />,
  );
  const type = (label: string, value: string) => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  };
  const submit = () => {
    fireEvent.click(screen.getByRole("button", { name: "Create the draft" }));
  };
  return { onCreate, type, submit };
}

describe("NewPropertyDialog", () => {
  it("names each empty required field and creates nothing", () => {
    const { onCreate, submit } = dialog();
    submit();
    expect({
      title: screen.queryByText("Give the property a title.") !== null,
      city: screen.queryByText("Name the city.") !== null,
      address: screen.queryByText("Give the address.") !== null,
      calls: onCreate.mock.calls.length,
    }).toEqual({ title: true, city: true, address: true, calls: 0 });
  });

  it("hands on the trimmed facts, the market and the price in dollars without its commas", () => {
    const { onCreate, type, submit } = dialog();
    type("Title", "  The Glass Pavilion ");
    type("Market", "new-york");
    type("City", "East Hampton");
    type("Address", "12 Dune Road");
    type("Type", "Estate");
    type("Price", "$12,500,000");
    submit();
    expect(onCreate.mock.calls).toEqual([
      [
        {
          title: "The Glass Pavilion",
          market_slug: "new-york",
          city: "East Hampton",
          address: "12 Dune Road",
          type: "Estate",
          price: 12_500_000,
        },
      ],
    ]);
  });

  it("leaves the price null when it is not given", () => {
    const { onCreate, type, submit } = dialog();
    type("Title", "Casa Marea");
    type("City", "Miami Beach");
    type("Address", "1 Ocean Drive");
    submit();
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({ price: null, market_slug: "california" });
  });
});
