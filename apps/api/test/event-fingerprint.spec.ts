import { describe, expect, it } from "vitest";
import { buildEventFingerprint } from "../src/events/event-fingerprint";

describe("buildEventFingerprint", () => {
  it("produces a stable fingerprint for identical input", () => {
    const input = { message: "Payment provider timed out", errorType: "TimeoutError", stackTrace: "at a\nat b\nat c\nat d" };
    expect(buildEventFingerprint(input)).toBe(buildEventFingerprint({ ...input }));
  });

  it("normalizes whitespace in the message", () => {
    const base = { errorType: "TypeError" };
    expect(buildEventFingerprint({ ...base, message: "cannot read x" }))
      .toBe(buildEventFingerprint({ ...base, message: "cannot   read\n\tx" }));
  });

  it("only considers the first three stack frames", () => {
    const head = "at a (a.js:1)\nat b (b.js:2)\nat c (c.js:3)";
    expect(buildEventFingerprint({ message: "m", stackTrace: head }))
      .toBe(buildEventFingerprint({ message: "m", stackTrace: head + "\nat d (d.js:4)" }));
  });

  it("separates errors with different types or messages", () => {
    const a = buildEventFingerprint({ message: "boom", errorType: "TypeError" });
    const b = buildEventFingerprint({ message: "boom", errorType: "RangeError" });
    const c = buildEventFingerprint({ message: "kaboom", errorType: "TypeError" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("defaults the error type to Error when missing", () => {
    expect(buildEventFingerprint({ message: "boom" }))
      .toBe(buildEventFingerprint({ message: "boom", errorType: "Error" }));
  });
});
