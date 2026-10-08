import "../../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeDbOptions } from "../../fixtures/fake-db";
import {
  fakeAuth,
  rolesDb,
  routeHandler,
  sessionCookie,
  signer,
  SITE,
  stubAuthEnv,
} from "../../fixtures/supabase-auth";
import { PAYMENT_ID, paymentRow } from "../automation/fixtures/entity-rows";

// `GET /api/admin/payments/:id/pdf` (B6 Files): a 302 to a 60 second signed URL of the object in the private bucket
// `documents`. The Worker never streams the PDF. Driven through the route file with a signed-in commercial user.

const KEY = "2026/MOP-2026-0001.pdf";
const SIGNED = "https://storage.example.test/object/sign/documents/2026/MOP-2026-0001.pdf?token=t";

type Storage = NonNullable<FakeDbOptions["storage"]>;

async function getPdf(invoiceFileKey: string | null, storage: Storage) {
  const key = await signer("kid-pdf");
  fakeAuth([key.jwk]);
  stubAuthEnv();
  vi.resetModules();
  const { setDbForTests } = await import("../../../src/server/lib/db");
  setDbForTests(
    rolesDb([{ role: "commercial", disabled: false }], {
      tables: { payments: [paymentRow({ invoice_file_key: invoiceFileKey })] },
      storage,
    }),
  );
  const handler = routeHandler(
    await import("../../../src/routes/api/admin/payments.$id.pdf"),
    "GET",
  );
  return handler({
    request: new Request(`${SITE}/api/admin/payments/${PAYMENT_ID}/pdf`, {
      headers: { cookie: sessionCookie(await key.token({ now: Date.now() }), Date.now()) },
    }),
    context: { requestId: "req-pdf-route" },
    params: { id: PAYMENT_ID },
  });
}

const errorCode = async (response: Response): Promise<string> => {
  const body: unknown = await response.json();
  const error: unknown =
    typeof body === "object" && body !== null && "error" in body ? body.error : null;
  const code: unknown =
    typeof error === "object" && error !== null && "code" in error ? error.code : null;
  return `${String(response.status)} ${String(code)}`;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/admin/payments/:id/pdf", () => {
  it("answers commercial 302 to the URL Storage signed for the key and 60 seconds, private and no-store", async () => {
    const signedWith: unknown[][] = [];
    const response = await getPdf(KEY, {
      documents: {
        createSignedUrl: (...args: unknown[]) => {
          signedWith.push(args);
          return Promise.resolve({ data: { signedUrl: SIGNED }, error: null });
        },
      },
    });
    expect({
      status: response.status,
      location: response.headers.get("location"),
      cache: response.headers.get("cache-control"),
      signedWith,
    }).toEqual({
      status: 302,
      location: SIGNED,
      cache: "private, no-store",
      signedWith: [[KEY, 60]],
    });
  });

  it("answers 404 pdf_not_ready while the key is null", async () => {
    const response = await getPdf(null, {});
    expect(await errorCode(response)).toBe("404 pdf_not_ready");
  });

  it("answers 503 storage_unavailable when Storage answers an error", async () => {
    const response = await getPdf(KEY, {
      documents: {
        createSignedUrl: () =>
          Promise.resolve({ data: null, error: new Error("Object store unavailable") }),
      },
    });
    expect(await errorCode(response)).toBe("503 storage_unavailable");
  });
});
