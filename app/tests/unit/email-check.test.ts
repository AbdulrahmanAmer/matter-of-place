import { describe, expect, it } from "vitest";
import { checkEmail, suggestAddress, type EmailCheckDeps } from "../../src/lib/email-check";

// W9 item 1: the one rule for an address, with a stubbed resolver and probe.

const mailHost = [{ exchange: "mx.pacificbrokers.com", priority: 10 }];

function deps(over: Partial<EmailCheckDeps> = {}): EmailCheckDeps {
  return {
    mx: () => Promise.resolve(mailHost),
    hasAddress: () => Promise.resolve(true),
    ...over,
  };
}

describe("an address before anything is sent", () => {
  it("is ok when its domain lists a mail host and no probe is given", async () => {
    const check = await checkEmail("dana@pacificbrokers.com", deps());
    expect(check).toEqual({
      verdict: "ok",
      suggestion: null,
      reason: "pacificbrokers.com receives email.",
    });
  });

  it("names a domain that does not exist as receiving no email", async () => {
    const check = await checkEmail(
      "dana@nowhere-at-all.com",
      deps({ mx: () => Promise.resolve(null) }),
    );
    expect(check.verdict).toBe("domain_has_no_mail");
  });

  it("takes a null MX (one record, exchange '.') as receiving no email", async () => {
    const check = await checkEmail(
      "dana@pacificbrokers.com",
      deps({ mx: () => Promise.resolve([{ exchange: ".", priority: 0 }]) }),
    );
    expect(check.verdict).toBe("domain_has_no_mail");
  });

  it("falls back to the domain's own address record when it lists no mail host", async () => {
    const none = () => Promise.resolve([]);
    expect((await checkEmail("a@pacificbrokers.com", deps({ mx: none }))).verdict).toBe("ok");
    expect(
      (
        await checkEmail(
          "a@pacificbrokers.com",
          deps({ mx: none, hasAddress: () => Promise.resolve(false) }),
        )
      ).verdict,
    ).toBe("domain_has_no_mail");
  });

  it("answers unknown when DNS cannot answer, so a form is never held back by it", async () => {
    expect(
      (await checkEmail("a@pacificbrokers.com", deps({ mx: () => Promise.resolve("unknown") })))
        .verdict,
    ).toBe("unknown");
    expect(
      (
        await checkEmail(
          "a@pacificbrokers.com",
          deps({ mx: () => Promise.reject(new Error("down")) }),
        )
      ).verdict,
    ).toBe("unknown");
  });

  it("refuses the mailbox the mail server refuses, and probes the host of lowest priority", async () => {
    const asked: string[] = [];
    const check = await checkEmail(
      "gone@pacificbrokers.com",
      deps({
        mx: () =>
          Promise.resolve([
            { exchange: "backup.pacificbrokers.com.", priority: 20 },
            { exchange: "primary.pacificbrokers.com.", priority: 5 },
          ]),
        probe: (host) => {
          asked.push(host);
          return Promise.resolve("refused");
        },
      }),
    );
    expect(check.verdict).toBe("mailbox_refused");
    expect(asked).toEqual(["primary.pacificbrokers.com"]);
  });

  it("is ok when the mail server accepts the mailbox, and unknown when it could not be asked", async () => {
    const accepted = deps({ probe: () => Promise.resolve("accepted") });
    expect((await checkEmail("dana@pacificbrokers.com", accepted)).verdict).toBe("ok");
    const closed = deps({ probe: () => Promise.resolve("unknown") });
    expect((await checkEmail("dana@pacificbrokers.com", closed)).verdict).toBe("unknown");
  });

  it("refuses what is not an address before any lookup", async () => {
    let looked = false;
    const watch = deps({
      mx: () => {
        looked = true;
        return Promise.resolve(mailHost);
      },
    });
    for (const bad of [
      "no-at-sign",
      "@pacificbrokers.com",
      "a@b",
      "a..b@pacificbrokers.com",
      "a@-x.com",
    ]) {
      expect((await checkEmail(bad, watch)).verdict).toBe("domain_has_no_mail");
    }
    expect(looked).toBe(false);
  });

  it("carries the fix of a typo domain with its verdict", async () => {
    const check = await checkEmail("ann@gmial.com", deps({ mx: () => Promise.resolve(null) }));
    expect(check.verdict).toBe("domain_has_no_mail");
    expect(check.suggestion).toBe("ann@gmail.com");
    expect(check.reason).toBe("gmial.com does not receive email. Did you mean ann@gmail.com?");
  });
});

describe("a name kept for tests and examples", () => {
  it("is never looked up and reads unknown, so the CI fixtures' addresses pass the form", async () => {
    let looked = 0;
    const watch = deps({
      mx: () => {
        looked += 1;
        return Promise.resolve(null);
      },
    });
    const verdicts: string[] = [];
    for (const address of ["e2e+1@fixtures.invalid", "person@example.com", "a@shop.test"]) {
      verdicts.push((await checkEmail(address, watch)).verdict);
    }
    expect(verdicts).toEqual(["unknown", "unknown", "unknown"]);
    expect(looked).toBe(0);
    expect((await checkEmail("a@notexample.com", watch)).verdict).toBe("domain_has_no_mail");
  });
});

describe("a typo domain", () => {
  it("suggests the provider people meant", () => {
    expect(suggestAddress("Ann.Lee@GMIAL.com")).toBe("Ann.Lee@gmail.com");
    expect(suggestAddress("ann@hotmial.com")).toBe("ann@hotmail.com");
    expect(suggestAddress("ann@yahoo.co")).toBe("ann@yahoo.com");
  });

  it("fixes an ending one key away from .com or .net", () => {
    expect(suggestAddress("ann@brokerage.con")).toBe("ann@brokerage.com");
    expect(suggestAddress("ann@brokerage.nte")).toBe("ann@brokerage.net");
  });

  it("says nothing for a right address, a real country domain or a half-typed one", () => {
    for (const fine of ["ann@gmail.com", "ann@yahoo.co.uk", "ann@studio.co", "ann@gmial"]) {
      expect(suggestAddress(fine)).toBeNull();
    }
  });
});
