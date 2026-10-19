import { beforeEach, describe, expect, it, vi } from "vitest";
import { addAccountPhotosFn } from "../../src/lib/account.functions";
import { sendAccountPhotos, UnsupportedPhotoError } from "../../src/lib/account-photos";
import { prepareImage, type PreparedImage } from "../../src/lib/image-prep";
import { runUploadQueue } from "../../src/services/http/upload-queue";

// W6 item 8 (phase 2): photographs from the room to an open request, ten at a time. Every outside call is replaced:
// no photograph is decoded, no URL is signed and nothing is put anywhere from a test.

vi.mock("../../src/lib/account.functions", () => ({ addAccountPhotosFn: vi.fn() }));
vi.mock("../../src/lib/image-prep", () => ({ prepareImage: vi.fn() }));
vi.mock("../../src/services/http/upload-queue", () => ({ runUploadQueue: vi.fn() }));

const SUBMISSION = "00000000-0000-4000-8000-0000000000c1";

const file = (name: string) => new File(["bytes"], name, { type: "image/jpeg" });
const files = (count: number) =>
  Array.from({ length: count }, (_, index) => file(`${String(index)}.jpg`));

const prepared = (type = "image/jpeg"): PreparedImage => ({
  original: new Blob(["12345"]),
  type,
  thumb: null,
});

beforeEach(() => {
  vi.mocked(prepareImage)
    .mockReset()
    .mockImplementation(() => Promise.resolve(prepared()));
  vi.mocked(addAccountPhotosFn)
    .mockReset()
    .mockImplementation(({ data }) =>
      Promise.resolve({
        uploads: data.media.map((_, index) => ({
          media_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          index,
          url: "https://storage.test/a",
          thumb_url: "https://storage.test/a.thumb",
        })),
      }),
    );
  vi.mocked(runUploadQueue).mockReset().mockResolvedValue({ failed: [] });
});

describe("sendAccountPhotos", () => {
  it("declares the photographs ten at a time, with the size and type the prepared file has", async () => {
    const progress = vi.fn();
    const result = await sendAccountPhotos(SUBMISSION, files(25), progress);
    expect(result).toEqual({ sent: 25, failed: 0 });
    expect(
      vi.mocked(addAccountPhotosFn).mock.calls.map(([call]) => call.data.media.length),
    ).toEqual([10, 10, 5]);
    expect(vi.mocked(addAccountPhotosFn).mock.calls[0]?.[0].data).toEqual({
      submission_id: SUBMISSION,
      media: Array.from({ length: 10 }, (_, index) => ({
        name: `${String(index)}.jpg`,
        size: 5,
        type: "image/jpeg",
      })),
    });
    expect(progress.mock.calls.map(([step]) => step)).toEqual([
      { done: 0, total: 25 },
      { done: 10, total: 25 },
      { done: 20, total: 25 },
      { done: 25, total: 25 },
    ]);
  });

  it("hands each batch's prepared files to the upload queue with the URLs the Worker signed", async () => {
    await sendAccountPhotos(SUBMISSION, files(3), vi.fn());
    const options = vi.mocked(runUploadQueue).mock.calls[0]?.[0];
    expect(options?.files).toHaveLength(3);
    expect(options?.entries.map((entry) => entry.index)).toEqual([0, 1, 2]);
    // Every entry is signed already, so the queue is never asked to sign more.
    expect(await options?.fetchMore([])).toEqual([]);
  });

  it("counts the photographs that did not go through, and sends no more than it was given", async () => {
    vi.mocked(runUploadQueue)
      .mockResolvedValueOnce({ failed: [1, 4] })
      .mockResolvedValueOnce({ failed: [] });
    expect(await sendAccountPhotos(SUBMISSION, files(12), vi.fn())).toEqual({
      sent: 10,
      failed: 2,
    });
  });

  it("refuses a file that is not a photograph before anything is declared", async () => {
    vi.mocked(prepareImage).mockResolvedValueOnce(prepared("application/pdf"));
    await expect(sendAccountPhotos(SUBMISSION, [file("plan.pdf")], vi.fn())).rejects.toBeInstanceOf(
      UnsupportedPhotoError,
    );
    expect(vi.mocked(addAccountPhotosFn)).not.toHaveBeenCalled();
    expect(vi.mocked(runUploadQueue)).not.toHaveBeenCalled();
  });

  it("stops at a batch the Worker refuses, with the earlier batches already sent", async () => {
    vi.mocked(addAccountPhotosFn)
      .mockResolvedValueOnce({ uploads: [] })
      .mockRejectedValueOnce(new Error("refused"));
    await expect(sendAccountPhotos(SUBMISSION, files(25), vi.fn())).rejects.toThrow("refused");
    expect(vi.mocked(addAccountPhotosFn)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runUploadQueue)).toHaveBeenCalledTimes(1);
  });
});
