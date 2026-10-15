import { describe, expect, it } from "vitest";
import { checkAddressFree } from "../../src/server/email/address-check";

// W9 item 1: the forms' free check in the Worker, over a stubbed DNS-over-HTTPS answer.

type Answers = Record<string, unknown>;

/** A fetch that answers each `name|type` from the table, and records what was asked. */
function doh(answers: Answers) {
  const asked: string[] = [];
  const fetchImpl = (input: string) => {
    const url = new URL(input);
    const key = `${url.searchParams.get("name") ?? ""}|${url.searchParams.get("type") ?? ""}`;
    asked.push(key);
    const body = answers[key];
    return body === undefined
      ? Promise.reject(new TypeError("network"))
      : Promise.resolve(Response.json(body));
  };
  return { fetchImpl, asked };
}

describe("the free check over DNS-over-HTTPS", () => {
  it("is ok for a domain with a mail host, and asks Cloudflare's resolver for its MX only", async () => {
    const stub = doh({
      "example.com|MX": { Status: 0, Answer: [{ type: 15, data: "10 mx.example.com." }] },
    });
    const check = await checkAddressFree("dana@example.com", stub.fetchImpl);
    expect(check.verdict).toBe("ok");
    expect(stub.asked).toEqual(["example.com|MX"]);
  });

  it("names a domain that does not exist (NXDOMAIN) as receiving no email, with the typo's fix", async () => {
    const stub = doh({ "gmial.com|MX": { Status: 3 } });
    const check = await checkAddressFree("ann@gmial.com", stub.fetchImpl);
    expect(check.verdict).toBe("domain_has_no_mail");
    expect(check.suggestion).toBe("ann@gmail.com");
  });

  it("looks for an address record when the domain lists no mail host", async () => {
    const empty = { Status: 0, Answer: [{ type: 5, data: "alias.example.com." }] };
    const withA = doh({
      "example.com|MX": empty,
      "example.com|A": { Status: 0, Answer: [{ type: 1, data: "192.0.2.1" }] },
    });
    expect((await checkAddressFree("a@example.com", withA.fetchImpl)).verdict).toBe("ok");
    const bare = doh({
      "example.com|MX": empty,
      "example.com|A": { Status: 0 },
      "example.com|AAAA": { Status: 0 },
    });
    expect((await checkAddressFree("a@example.com", bare.fetchImpl)).verdict).toBe(
      "domain_has_no_mail",
    );
  });

  it("answers unknown when the resolver fails, errs or answers something unreadable", async () => {
    expect((await checkAddressFree("a@example.com", doh({}).fetchImpl)).verdict).toBe("unknown");
    expect(
      (await checkAddressFree("a@example.com", doh({ "example.com|MX": { Status: 2 } }).fetchImpl))
        .verdict,
    ).toBe("unknown");
    expect(
      (
        await checkAddressFree(
          "a@example.com",
          doh({ "example.com|MX": { nothing: true } }).fetchImpl,
        )
      ).verdict,
    ).toBe("unknown");
  });
});
