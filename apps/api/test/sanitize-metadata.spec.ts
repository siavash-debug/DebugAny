import { describe, expect, it } from "vitest";
import { MAX_METADATA_BYTES, sanitizeMetadata } from "../src/events/sanitize-metadata";

describe("sanitizeMetadata", () => {
  it("accepts undefined and null as empty metadata", () => {
    expect(sanitizeMetadata(undefined)).toEqual({ accepted: true, metadata: {} });
    expect(sanitizeMetadata(null)).toEqual({ accepted: true, metadata: {} });
  });

  it("rejects non-object metadata", () => {
    expect(sanitizeMetadata("nope").accepted).toBe(false);
    expect(sanitizeMetadata([1, 2]).accepted).toBe(false);
  });

  it("redacts values under sensitive-looking keys at any depth", () => {
    const result = sanitizeMetadata({
      service: "checkout",
      nested: { password: "hunter2", config: { AUTH_TOKEN: "abc", other: 1 } },
      apiKey: "key-123"
    });
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.metadata).toEqual({
      service: "checkout",
      nested: { password: "[redacted]", config: { AUTH_TOKEN: "[redacted]", other: 1 } },
      apiKey: "[redacted]"
    });
  });

  it("truncates very long strings", () => {
    const result = sanitizeMetadata({ blob: "x".repeat(2000) });
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect((result.metadata.blob as string).endsWith("…[truncated]")).toBe(true);
  });

  it("rejects metadata above the size cap instead of truncating silently", () => {
    const result = sanitizeMetadata({ blob: "x".repeat(MAX_METADATA_BYTES) });
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.reason).toContain("bytes");
  });
});
