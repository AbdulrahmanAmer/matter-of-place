import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Photos from "../../lib/account-photos";
import { sendAccountPhotos, UnsupportedPhotoError } from "../../lib/account-photos";
import { AccountPhotos } from "./account-photos";

// W6 item 8 (phase 2): the field that adds photographs to an open request. The send is replaced, so nothing is uploaded.

vi.mock("../../lib/account-photos", async (importOriginal) => {
  const original = await importOriginal<typeof Photos>();
  return { ...original, sendAccountPhotos: vi.fn() };
});

const SUBMISSION = "00000000-0000-4000-8000-0000000000c1";
const photo = (name: string) => new File(["bytes"], name, { type: "image/jpeg" });

function choose(files: File[]) {
  fireEvent.change(screen.getByLabelText("Add photographs"), { target: { files } });
}

beforeEach(() => {
  vi.mocked(sendAccountPhotos).mockReset().mockResolvedValue({ sent: 0, failed: 0 });
});

describe("AccountPhotos", () => {
  it("says how many photographs the request holds", () => {
    const { rerender } = render(
      <AccountPhotos submissionId={SUBMISSION} photos={0} onSent={vi.fn()} />,
    );
    expect(screen.getByText("No photographs on this request yet.")).toBeTruthy();
    rerender(<AccountPhotos submissionId={SUBMISSION} photos={1} onSent={vi.fn()} />);
    expect(screen.getByText("1 photograph on this request.")).toBeTruthy();
    rerender(<AccountPhotos submissionId={SUBMISSION} photos={12} onSent={vi.fn()} />);
    expect(screen.getByText("12 photographs on this request.")).toBeTruthy();
  });

  it("takes only the photograph kinds the submit form takes", () => {
    render(<AccountPhotos submissionId={SUBMISSION} photos={0} onSent={vi.fn()} />);
    expect(screen.getByLabelText("Add photographs").getAttribute("accept")).toBe(
      "image/jpeg,image/png,image/heic,image/webp",
    );
  });

  it("sends the chosen files to this request, then says they arrived and asks the page to read the new count", async () => {
    vi.mocked(sendAccountPhotos).mockResolvedValue({ sent: 2, failed: 0 });
    const onSent = vi.fn();
    render(<AccountPhotos submissionId={SUBMISSION} photos={0} onSent={onSent} />);
    const files = [photo("a.jpg"), photo("b.jpg")];
    choose(files);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "2 photographs sent. We will see them shortly.",
      );
    });
    expect(vi.mocked(sendAccountPhotos).mock.calls[0]?.slice(0, 2)).toEqual([SUBMISSION, files]);
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("says which did not go through, and to choose them again", async () => {
    vi.mocked(sendAccountPhotos).mockResolvedValue({ sent: 3, failed: 1 });
    render(<AccountPhotos submissionId={SUBMISSION} photos={0} onSent={vi.fn()} />);
    choose([photo("a.jpg")]);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "3 sent. 1 photograph did not go through: choose it again.",
      );
    });
  });

  it("shows the progress while the files go", async () => {
    let finish: (value: { sent: number; failed: number }) => void = () => undefined;
    vi.mocked(sendAccountPhotos).mockImplementation(
      (_id, _files, onProgress) =>
        new Promise((resolve) => {
          onProgress({ done: 1, total: 3 });
          finish = resolve;
        }),
    );
    render(<AccountPhotos submissionId={SUBMISSION} photos={0} onSent={vi.fn()} />);
    choose([photo("a.jpg")]);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Sent 1 of 3.");
    });
    expect(screen.getByLabelText<HTMLInputElement>("Add photographs").disabled).toBe(true);
    finish({ sent: 3, failed: 0 });
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>("Add photographs").disabled).toBe(false);
    });
  });

  it("names a file that is not a photograph, and a plain retry for anything else", async () => {
    vi.mocked(sendAccountPhotos).mockRejectedValueOnce(new UnsupportedPhotoError("plan.pdf"));
    render(<AccountPhotos submissionId={SUBMISSION} photos={0} onSent={vi.fn()} />);
    choose([photo("plan.pdf")]);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "plan.pdf is not a JPEG, PNG, WebP or HEIC photograph.",
      );
    });
    vi.mocked(sendAccountPhotos).mockRejectedValueOnce(new Error("503 unavailable"));
    choose([photo("a.jpg")]);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "We could not take these just now. Please try again.",
      );
    });
  });

  it("does nothing when no file was chosen", () => {
    render(<AccountPhotos submissionId={SUBMISSION} photos={0} onSent={vi.fn()} />);
    choose([]);
    expect(vi.mocked(sendAccountPhotos)).not.toHaveBeenCalled();
  });
});
