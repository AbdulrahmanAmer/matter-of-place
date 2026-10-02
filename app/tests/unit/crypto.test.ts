import { describe, expect, it } from "vitest";
import {
  aesGcmOpen,
  aesGcmSeal,
  fromBase64,
  hmacSha256,
  randomToken,
  sha1Bytes,
  sha256Hex,
  timingSafeEqual,
  toBase64Url,
  toHex,
} from "../../src/server/lib/crypto";

const filled = (length: number, byte: number) => new Uint8Array(length).fill(byte);
const text = (value: string) => new TextEncoder().encode(value);

// RFC 4231 section 4 (case 5 truncates the output and is left out).
const RFC_4231 = [
  {
    name: "case 1",
    key: filled(20, 0x0b),
    data: text("Hi There"),
    mac: "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
  },
  {
    name: "case 2",
    key: text("Jefe"),
    data: text("what do ya want for nothing?"),
    mac: "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
  },
  {
    name: "case 3",
    key: filled(20, 0xaa),
    data: filled(50, 0xdd),
    mac: "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe",
  },
  {
    name: "case 4",
    key: Uint8Array.from({ length: 25 }, (_, index) => index + 1),
    data: filled(50, 0xcd),
    mac: "82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b",
  },
  {
    name: "case 6",
    key: filled(131, 0xaa),
    data: text("Test Using Larger Than Block-Size Key - Hash Key First"),
    mac: "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
  },
  {
    name: "case 7",
    key: filled(131, 0xaa),
    data: text(
      "This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.",
    ),
    mac: "9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2",
  },
];

describe("hmacSha256", () => {
  it.each(RFC_4231)("matches RFC 4231 $name", async ({ key, data, mac }) => {
    expect(toHex(await hmacSha256(key, data))).toBe(mac);
  });

  it("verifies Svix's documented example signature in constant time", async () => {
    const secret = fromBase64("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw".slice("whsec_".length));
    const signed = 'msg_p5jXN8AQM9LWM0D4loKWxJek.1614265330.{"test": 2432232314}';
    const expected = fromBase64("g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
    expect(timingSafeEqual(await hmacSha256(secret, signed), expected)).toBe(true);
    expect(timingSafeEqual(await hmacSha256(secret, `${signed} `), expected)).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it("is true for equal arrays", () => {
    expect(timingSafeEqual(text("same bytes"), text("same bytes"))).toBe(true);
  });

  it("is false for different lengths", () => {
    expect(timingSafeEqual(text("short"), text("shorter"))).toBe(false);
  });

  it("is false when one bit differs", () => {
    const flipped = text("same bytes");
    flipped[9] = (flipped[9] ?? 0) ^ 0x01;
    expect(timingSafeEqual(text("same bytes"), flipped)).toBe(false);
  });

  // The time it takes must not tell where the first difference is (CS-04), so it reads them all.
  it("reads every byte of both arrays when the first byte differs", () => {
    const watched = (bytes: Uint8Array) => {
      const reads = new Set<string>();
      const proxy = new Proxy(bytes, {
        get(target, key) {
          if (typeof key === "string" && /^\d+$/.test(key)) reads.add(key);
          const value: unknown = Reflect.get(target, key);
          return value;
        },
      });
      return { proxy, reads };
    };
    const a = watched(filled(32, 0x00));
    const b = watched(filled(32, 0xff));
    expect(timingSafeEqual(a.proxy, b.proxy)).toBe(false);
    expect([a.reads.size, b.reads.size]).toEqual([32, 32]);
  });
});

describe("hashes and encodings", () => {
  it("gives the FIPS 180-2 value for sha256 of abc", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("gives the FIPS 180-2 value for sha1 of abc", async () => {
    expect(toHex(await sha1Bytes(text("abc")))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  it("makes a random token of 43 base64url characters", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
  });

  it("writes base64url without padding", () => {
    expect(toBase64Url(Uint8Array.of(0xfb, 0xff))).toBe("-_8");
  });
});

describe("aesGcmSeal and aesGcmOpen", () => {
  const key = filled(32, 7);
  const message = text("sealed message");

  it("opens what it sealed", async () => {
    expect(await aesGcmOpen(key, await aesGcmSeal(key, message))).toEqual(message);
  });

  it("starts every seal with a fresh 12-byte IV", async () => {
    const first = await aesGcmSeal(key, message);
    const second = await aesGcmSeal(key, message);
    // IV, ciphertext of the same length as the message, then the 16-byte tag.
    expect(first).toHaveLength(12 + message.length + 16);
    expect(first.subarray(0, 12)).not.toEqual(second.subarray(0, 12));
    expect(first.subarray(12)).not.toEqual(second.subarray(12));
  });

  it("returns null when one byte was changed", async () => {
    const sealed = await aesGcmSeal(key, message);
    sealed[sealed.length - 1] = (sealed[sealed.length - 1] ?? 0) ^ 0x01;
    expect(await aesGcmOpen(key, sealed)).toBeNull();
  });
});
