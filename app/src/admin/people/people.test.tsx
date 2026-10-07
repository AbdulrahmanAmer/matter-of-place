import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonDetail as Person, PersonListRow } from "../../domain/admin-people";
import type { SubmissionDetail } from "../../domain/admin-submissions";
import { SubmittedFields } from "../requests/SubmittedFields";
import { AdminApiError } from "../ui/admin-fetch";
import { PeopleTable } from "./PeopleTable";
import { PersonDetail } from "./PersonDetail";
import { PersonNotes } from "./PersonNotes";

const PERSON = "00000000-0000-4000-8000-0000000000e1";
const REQUEST = "00000000-0000-4000-8000-0000000000c1";

const row: PersonListRow = {
  id: PERSON,
  name: "Ana Fixture",
  kind: "agent",
  brokerage: "Fixture Brokerage",
  email: "ana@example.test",
  requests: 2,
  accepted: 1,
  published: 1,
  last_activity_at: "2026-10-06T16:00:00Z",
};

const noFilters = { values: {}, onChange: () => undefined };

const person: Person = {
  contact: {
    id: PERSON,
    kind: "agent",
    name: "Ana Fixture",
    email: "ana@example.test",
    phone: null,
    brokerage: "Fixture Brokerage",
    notes: null,
    updated_at: "2026-10-06T12:00:00.123456+00:00",
  },
  requests: [
    {
      id: REQUEST,
      address: "12 Fixture Lane",
      city: "Montecito",
      state: "California",
      workflow_state: "Accepted",
      received_at: "2026-10-01T12:00:00Z",
    },
  ],
  properties: [],
  payments: [],
  emails: [],
  inquiries: [],
};

const submission = (contactId: string | null): SubmissionDetail => ({
  id: REQUEST,
  received_at: "2026-10-01T12:00:00Z",
  workflow_state: "Submitted",
  accepted_at: null,
  decline_note: null,
  duplicate_of: null,
  address: "12 Fixture Lane",
  city: "Montecito",
  state: "California",
  zip: "93108",
  property_type: "Residence",
  price: null,
  currency: "USD",
  beds: null,
  baths: null,
  interior_sq_ft: null,
  year_built: null,
  year_renovated: null,
  architect: null,
  designer: null,
  package: "The Feature",
  media_budget: null,
  contact_id: contactId,
  submitter_kind: "agent",
  submitter_name: "Ana Fixture",
  submitter_email: "ana@example.test",
  submitter_phone: null,
  brokerage: "Fixture Brokerage",
  listed_with_agent: null,
  listing_agent_name: null,
  listing_agent_brokerage: null,
  listing_url: null,
  source_url: null,
  photography_url: null,
  video_url: null,
  story: "A house on a hill.",
  significance: "Built for the view.",
  property_id: null,
  payment_id: null,
  notes: [],
  media: [],
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PeopleTable", () => {
  it("shows the eight columns of a person", () => {
    render(<PeopleTable rows={[row]} filters={noFilters} />);
    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    const cells = screen.getAllByRole("cell").map((cell) => cell.textContent);
    expect({ headers, cells }).toEqual({
      headers: [
        "Name",
        "Kind",
        "Brokerage",
        "Email",
        "Requests",
        "Accepted",
        "Published",
        "Last activity",
      ],
      cells: [
        "Ana Fixture",
        "Real estate agent",
        "Fixture Brokerage",
        "ana@example.test",
        "2",
        "1",
        "1",
        "Oct 6, 2026 ET",
      ],
    });
  });

  it("says No one has submitted yet when there is no one and no filter", () => {
    render(<PeopleTable rows={[]} filters={noFilters} />);
    expect(screen.getByText("No one has submitted yet")).toBeTruthy();
  });
});

describe("PersonDetail", () => {
  it("draws the six sections of screen 27 and links a request to screen 4", () => {
    render(<PersonDetail person={person} notes={null} hasRoute={() => true} />);
    const sections = screen
      .getAllByRole("region")
      .map((region) => region.getAttribute("aria-label"));
    const requests = within(screen.getByRole("region", { name: "Requests" }));
    expect({
      sections,
      request: requests.getByRole("link").getAttribute("href"),
    }).toEqual({
      sections: [
        "Details",
        "Requests",
        "Properties",
        "Invoices and payments",
        "Emails",
        "Inquiries",
      ],
      request: `/admin/requests/${REQUEST}`,
    });
  });
});

describe("SubmittedFields", () => {
  it("shows Open person for a request with a contact and nothing without one", () => {
    const withContact = render(<SubmittedFields detail={submission(PERSON)} />);
    const href = screen.getByRole("link", { name: "Open person" }).getAttribute("href");
    withContact.unmount();
    render(<SubmittedFields detail={submission(null)} />);
    expect({ href, without: screen.queryByRole("link", { name: "Open person" }) }).toEqual({
      href: `/admin/people/${PERSON}`,
      without: null,
    });
  });
});

describe("PersonNotes", () => {
  const type = (text: string) => {
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: text } });
  };

  it("autosaves after a pause, each save with the version the one before returned", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn((_notes: string, expected: string) => Promise.resolve(`${expected}+1`));
    render(
      <PersonNotes
        notes={null}
        updatedAt="v1"
        canEdit
        onSave={onSave}
        onReload={() => Promise.resolve({ notes: null, updatedAt: "v1" })}
      />,
    );
    type("First");
    await act(() => vi.advanceTimersByTimeAsync(1500));
    type("First and second");
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(onSave.mock.calls).toEqual([
      ["First", "v1"],
      ["First and second", "v1+1"],
    ]);
  });

  it("stops on 409 stale, keeps the text, and saves only on Save after Reload", async () => {
    vi.useFakeTimers();
    const onSave = vi
      .fn<(notes: string, expected: string) => Promise<string>>()
      .mockRejectedValueOnce(new AdminApiError(409, "stale", "Reload, someone saved."))
      .mockResolvedValue("v3");
    render(
      <PersonNotes
        notes="Old"
        updatedAt="v1"
        canEdit
        onSave={onSave}
        onReload={() => Promise.resolve({ notes: "Theirs", updatedAt: "v2" })}
      />,
    );
    type("Mine");
    await act(() => vi.advanceTimersByTimeAsync(1500));
    const alert = screen.getByRole("alert").textContent;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reload" }));
      await vi.advanceTimersByTimeAsync(3000);
    });
    const afterReload = onSave.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect({
      alert,
      afterReload,
      text: screen.getByLabelText<HTMLTextAreaElement>("Notes").value,
      calls: onSave.mock.calls,
    }).toEqual({
      alert: "Someone else saved these notes. Your text is still here. Reload",
      afterReload: 1,
      text: "Mine",
      calls: [
        ["Mine", "v1"],
        ["Mine", "v2"],
      ],
    });
  });
});
