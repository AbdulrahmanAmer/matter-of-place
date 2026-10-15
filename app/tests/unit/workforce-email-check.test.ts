import { describe, expect, it } from "vitest";
import {
  addressesIn,
  probeMailbox,
  refusedWords,
  replyReader,
  type SmtpSession,
} from "../../scripts/workforce/email-check";

// W9 item 1: the runner's SMTP probe over a stubbed socket. It asks and leaves: never DATA.

function session(replies: number[]): SmtpSession & { sent: string[]; closed: boolean } {
  const queue = [...replies];
  const state = {
    sent: [] as string[],
    closed: false,
    reply: () => {
      const code = queue.shift();
      return code === undefined
        ? Promise.reject(new Error("no reply"))
        : Promise.resolve({ code, text: `${String(code)} x` });
    },
    send: (line: string) => {
      state.sent.push(line);
    },
    close: () => {
      state.closed = true;
    },
  };
  return state;
}

describe("the SMTP probe", () => {
  it("accepts a mailbox the server takes, and leaves with QUIT before any message", async () => {
    const smtp = session([220, 250, 250, 250]);
    expect(await probeMailbox(smtp, "dana@example.com")).toBe("accepted");
    expect(smtp.sent).toEqual([
      "EHLO notify.matterofplace.com",
      "MAIL FROM:<>",
      "RCPT TO:<dana@example.com>",
      "QUIT",
    ]);
    expect(smtp.sent.some((line) => line.startsWith("DATA"))).toBe(false);
    expect(smtp.closed).toBe(true);
  });

  it("refuses a mailbox the server says does not exist (550)", async () => {
    expect(await probeMailbox(session([220, 250, 250, 550]), "gone@example.com")).toBe("refused");
  });

  it("proves nothing from a greylisting 4xx, a bad greeting or a refused sender", async () => {
    expect(await probeMailbox(session([220, 250, 250, 451]), "a@example.com")).toBe("unknown");
    expect(await probeMailbox(session([554]), "a@example.com")).toBe("unknown");
    expect(await probeMailbox(session([220, 250, 553]), "a@example.com")).toBe("unknown");
  });

  it("falls back to HELO when EHLO is refused", async () => {
    const smtp = session([220, 502, 250, 250, 250]);
    expect(await probeMailbox(smtp, "a@example.com")).toBe("accepted");
    expect(smtp.sent[1]).toBe("HELO notify.matterofplace.com");
  });

  it("answers unknown and closes when the server stops answering", async () => {
    const smtp = session([220]);
    expect(await probeMailbox(smtp, "a@example.com")).toBe("unknown");
    expect(smtp.closed).toBe(true);
  });
});

describe("the reply reader", () => {
  it("joins a multi-line reply and waits for its last line", () => {
    const reader = replyReader();
    reader.push("250-mx.example.com\r\n250-SIZE 35882577\r\n");
    expect(reader.next()).toBeNull();
    reader.push("250 SMTPUTF8\r\n220 next");
    expect(reader.next()).toEqual({
      code: 250,
      text: "250-mx.example.com\n250-SIZE 35882577\n250 SMTPUTF8",
    });
    expect(reader.next()).toBeNull();
  });
});

describe("an admin call that names an address", () => {
  it("finds every address in its body, nested or not", () => {
    expect(
      addressesIn({ note: "call her", to: "Dana@Example.com", more: [{ cc: "b@x.org" }, 3] }),
    ).toEqual(["dana@example.com", "b@x.org"]);
    expect(addressesIn({ note: "write to dana at example dot com" })).toEqual([]);
  });
});

describe("a refused address, as a thread says it (W8 review)", () => {
  it("names the kind of refusal in fixed words, never the address or its domain", () => {
    const domain = refusedWords({
      verdict: "domain_has_no_mail",
      suggestion: null,
      reason: "propose-a-post.example does not receive email.",
    });
    const mailbox = refusedWords({
      verdict: "mailbox_refused",
      suggestion: null,
      reason: "The mail server of propose-a-post.example says this mailbox does not exist.",
    });
    expect([domain, mailbox]).toEqual([
      "its domain does not receive email.",
      "its mail server says the mailbox does not exist.",
    ]);
  });
});
