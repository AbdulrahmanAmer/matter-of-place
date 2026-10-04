// FE-04: the browser's upload queue against a fake XMLHttpRequest and a fake `fetchMore`, and `submissions.send`
// against a fake API, so a failed PUT is seen to leave the received submission alone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { PreparedImage } from "../../src/lib/image-prep";
import { createHttpServices } from "../../src/services/http";
import {
  runUploadQueue,
  type SignedUpload,
  type UploadEntry,
} from "../../src/services/http/upload-queue";
import type { UploadProgress } from "../../src/services/types";
import { submissionSchema } from "../../src/domain/contracts";
import { validSubmission } from "../fixtures/builders";

vi.mock("../../src/lib/turnstile", () => ({ getTurnstileToken: () => Promise.resolve(null) }));

interface Put {
  url: string;
  type: string;
  body: unknown;
}

/** Answers every PUT on the next tick with the status `answer` gives; counts what is in flight at once. */
class FakeXhr {
  static puts: Put[] = [];
  static inFlight = 0;
  static peak = 0;
  static answer: (url: string, attempt: number) => number = () => 200;

  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private url = "";
  private type = "";

  open(_method: string, url: string) {
    this.url = url;
  }

  setRequestHeader(_name: string, value: string) {
    this.type = value;
  }

  send(body: unknown) {
    FakeXhr.inFlight += 1;
    FakeXhr.peak = Math.max(FakeXhr.peak, FakeXhr.inFlight);
    const attempt = FakeXhr.puts.filter((put) => put.url === this.url).length;
    FakeXhr.puts.push({ url: this.url, type: this.type, body });
    setTimeout(() => {
      FakeXhr.inFlight -= 1;
      this.status = FakeXhr.answer(this.url, attempt);
      this.onload?.();
    }, 5);
  }
}

const image = (): PreparedImage => ({
  original: new Blob(["o"], { type: "image/jpeg" }),
  type: "image/jpeg",
  thumb: new Blob(["t"], { type: "image/jpeg" }),
});

const signedFor = (id: string): SignedUpload => ({
  media_id: id,
  url: `https://storage.test/${id}`,
  thumb_url: `https://storage.test/${id}.thumb`,
});

/** `count` entries in posted order, the first `signed` with their URLs, as the receipt gives them. */
const entriesOf = (count: number, signed = count): UploadEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    media_id: `m${String(index)}`,
    index,
    ...(index < signed ? signedFor(`m${String(index)}`) : {}),
  }));

const noMore = () => Promise.reject(new Error("fetchMore was not expected"));

/** Runs the queue to its end under fake timers, so the 1, 3 and 9 second backoffs take no real time. */
async function drain<T>(work: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return work;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  FakeXhr.puts = [];
  FakeXhr.inFlight = 0;
  FakeXhr.peak = 0;
  FakeXhr.answer = () => 200;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("runUploadQueue", () => {
  it("never has more than 3 PUTs in flight for 40 files", async () => {
    const files = Array.from({ length: 40 }, image);
    const result = await drain(
      runUploadQueue({ entries: entriesOf(40), files, fetchMore: noMore }),
    );
    expect(result.failed).toEqual([]);
    expect(FakeXhr.puts).toHaveLength(80);
    expect(FakeXhr.peak).toBe(3);
  });

  it("sends each file's thumbnail right after its original", async () => {
    await drain(runUploadQueue({ entries: entriesOf(1), files: [image()], fetchMore: noMore }));
    expect(FakeXhr.puts.map(({ url, type }) => ({ url, type }))).toEqual([
      { url: "https://storage.test/m0", type: "image/jpeg" },
      { url: "https://storage.test/m0.thumb", type: "image/jpeg" },
    ]);
  });

  it("uploads two files both named image.jpg each to its own URL", async () => {
    const files = [0, 1].map((index) => {
      const file = new File([new Uint8Array(8).fill(index)], "image.jpg", { type: "image/jpeg" });
      return { original: file, type: file.type, thumb: null };
    });
    await drain(runUploadQueue({ entries: entriesOf(2), files, fetchMore: noMore }));
    const sent = new Map(FakeXhr.puts.map((put) => [put.url, put.body]));
    expect(sent.size).toBe(2);
    expect(sent.get("https://storage.test/m0")).toBe(files[0]?.original);
    expect(sent.get("https://storage.test/m1")).toBe(files[1]?.original);
  });

  it("retries one 500 on the same URL and leaves the other files alone", async () => {
    FakeXhr.answer = (url, attempt) => (url.endsWith("/m1") && attempt === 0 ? 500 : 200);
    const files = Array.from({ length: 3 }, image);
    const result = await drain(runUploadQueue({ entries: entriesOf(3), files, fetchMore: noMore }));
    expect(result.failed).toEqual([]);
    const counts = FakeXhr.puts.reduce<Record<string, number>>(
      (all, put) => ({ ...all, [put.url]: (all[put.url] ?? 0) + 1 }),
      {},
    );
    expect(counts).toEqual({
      "https://storage.test/m0": 1,
      "https://storage.test/m0.thumb": 1,
      "https://storage.test/m1": 2,
      "https://storage.test/m1.thumb": 1,
      "https://storage.test/m2": 1,
      "https://storage.test/m2.thumb": 1,
    });
  });

  it("gives up after three retries, reports failed 1, and retry() sends only that file", async () => {
    let broken = true;
    FakeXhr.answer = (url) => (broken && url.endsWith("/m1") ? 500 : 200);
    const reports: UploadProgress[] = [];
    const result = await drain(
      runUploadQueue({
        entries: entriesOf(3),
        files: Array.from({ length: 3 }, image),
        fetchMore: noMore,
        onProgress: (progress) => reports.push(progress),
      }),
    );
    expect(result.failed).toEqual([1]);
    expect(FakeXhr.puts.filter((put) => put.url.endsWith("/m1"))).toHaveLength(4);
    const last = reports.at(-1);
    expect(last).toMatchObject({ done: 2, total: 3, failed: 1 });
    broken = false;
    FakeXhr.puts = [];
    await drain(last?.retry() ?? Promise.resolve());
    expect(FakeXhr.puts.map((put) => put.url)).toEqual([
      "https://storage.test/m1",
      "https://storage.test/m1.thumb",
    ]);
    expect(reports.at(-1)).toMatchObject({ done: 3, total: 3, failed: 0 });
  });

  it("asks fetchMore three times for 40 entries of which the receipt signed 10", async () => {
    const asked: string[][] = [];
    const fetchMore = (ids: string[]) => {
      asked.push(ids);
      return Promise.resolve(ids.map(signedFor));
    };
    const files = Array.from({ length: 40 }, image);
    const result = await drain(runUploadQueue({ entries: entriesOf(40, 10), files, fetchMore }));
    expect(result.failed).toEqual([]);
    expect(asked.map((ids) => ids.length)).toEqual([10, 10, 10]);
    expect(asked.flat()).toEqual(
      Array.from({ length: 30 }, (_, index) => `m${String(index + 10)}`),
    );
    expect(FakeXhr.puts).toHaveLength(80);
  });
});

describe("submissions.send", () => {
  const RECEIPT = {
    id: "11111111-1111-4111-8111-111111111111",
    receivedAt: "2026-10-04T00:00:00Z",
  };

  it("keeps the receipt when a PUT fails for good, reports failed 1 and posts the submission once", async () => {
    FakeXhr.answer = (url) => (url.endsWith("/m1") ? 500 : 200);
    const calls: string[] = [];
    const fetchImpl = vi.fn((url: string, _init: RequestInit) => {
      calls.push(url);
      return Promise.resolve(
        Response.json(
          { ...RECEIPT, upload_token: "1.sig", uploads: entriesOf(2) },
          { status: 201 },
        ),
      );
    });
    const reports: UploadProgress[] = [];
    const files = ["image.jpg", "image.jpg"].map(
      (name) => new File([new Uint8Array(8)], name, { type: "image/jpeg" }),
    );
    const receipt = await createHttpServices("/api/public", fetchImpl).submissions.send(
      submissionSchema.parse(validSubmission()),
      files,
      (progress) => reports.push(progress),
    );
    await vi.runAllTimersAsync();
    expect(receipt).toEqual(RECEIPT);
    expect(calls).toEqual(["/api/public/submissions"]);
    expect(reports.at(-1)).toMatchObject({ done: 1, total: 2, failed: 1 });
    const posted = z
      .object({
        media: z.array(z.object({ name: z.string(), size: z.number(), type: z.string() })),
      })
      .parse(JSON.parse(z.string().parse(fetchImpl.mock.calls[0]?.[1].body)));
    expect(posted.media).toEqual([
      { name: "image.jpg", size: 8, type: "image/jpeg" },
      { name: "image.jpg", size: 8, type: "image/jpeg" },
    ]);
  });
});
