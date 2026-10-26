import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { isBlockedAddress, parseWebhookUrl } from "../src/webhooks/ssrf";
import { validateRuleConfig } from "../src/alerts/dto/alert-rule.dto";
import { WebhookDeliveryService } from "../src/webhooks/delivery.service";
import { deliveryJobId } from "../src/queue/queue.module";

describe("BullMQ job id sanity", () => {
  it("produces custom job ids BullMQ accepts for delivery dedupe keys", () => {
    const key = `${Date.now()}:-${Math.random()}:${Math.random()}:1`;
    const jobId = deliveryJobId(key);
    // BullMQ rejects ids containing ':' unless split(':').length === 3.
    const segments = jobId.split(":");
    expect(jobId.startsWith("delivery-")).toBe(true);
    expect(segments.length === 1 || segments.length === 3).toBe(true);
    // Same key always maps to the same waiting-job dedupe id.
    expect(deliveryJobId(key)).toBe(jobId);
  });
});

describe("SSRF address blocklist", () => {
  const blocked = [
    "127.0.0.1", "127.8.8.8", "10.1.2.3", "172.16.0.1", "172.31.255.255",
    "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1",
    "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1"
  ];
  const allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"];

  it.each(blocked)("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(allowed)("allows public %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it("rejects non-IP strings (fail closed)", () => {
    expect(isBlockedAddress("example.com")).toBe(true);
  });
});

describe("webhook URL parsing", () => {
  it("accepts standard ports and defaults them", () => {
    expect(parseWebhookUrl("https://hooks.example.com/x").port).toBe(443);
    expect(parseWebhookUrl("http://hooks.example.com/x").port).toBe(80);
    expect(parseWebhookUrl("https://hooks.example.com:443/x").port).toBe(443);
  });

  it("rejects wrong schemes and ports", () => {
    expect(() => parseWebhookUrl("ftp://hooks.example.com/x")).toThrow(/http or https/);
    expect(() => parseWebhookUrl("file:///etc/passwd")).toThrow();
    expect(() => parseWebhookUrl("http://hooks.example.com:8080/x")).toThrow(/port 80 or 443/);
    expect(() => parseWebhookUrl("javascript:alert(1)")).toThrow();
    expect(() => parseWebhookUrl("not a url")).toThrow();
  });
});

describe("alert rule config validation", () => {
  it("requires a filter for NEW_ISSUE_MATCHING", () => {
    expect(() => validateRuleConfig("NEW_ISSUE_MATCHING", {})).toThrow(/titleContains or config.fingerprint/);
    expect(() => validateRuleConfig("NEW_ISSUE_MATCHING", { titleContains: "payment" })).not.toThrow();
  });

  it("bounds ISSUE_THRESHOLD between 2 and 100000", () => {
    expect(() => validateRuleConfig("ISSUE_THRESHOLD", { threshold: 1 })).toThrow(/threshold/);
    expect(() => validateRuleConfig("ISSUE_THRESHOLD", { threshold: 2 })).not.toThrow();
    expect(() => validateRuleConfig("ISSUE_THRESHOLD", { threshold: 100001 })).toThrow();
    expect(() => validateRuleConfig("ISSUE_THRESHOLD", { threshold: 2.5 })).toThrow();
  });

  it("bounds ERROR_RATE windows between 5 and 1440 minutes", () => {
    expect(() => validateRuleConfig("ERROR_RATE", { eventThreshold: 10, windowMinutes: 4 })).toThrow(/windowMinutes/);
    expect(() => validateRuleConfig("ERROR_RATE", { eventThreshold: 10, windowMinutes: 60 })).not.toThrow();
    expect(() => validateRuleConfig("ERROR_RATE", { eventThreshold: 1 })).toThrow(/eventThreshold/);
  });

  it("accepts an empty config for NEW_ISSUE", () => {
    expect(() => validateRuleConfig("NEW_ISSUE", {})).not.toThrow();
  });
});

describe("webhook signature", () => {
  const service = new WebhookDeliveryService({} as never, {} as never);
  const secret = "a".repeat(64);
  const body = JSON.stringify({ hello: "world" });

  it("signs and verifies in round-trip", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const header = service.signPayload(secret, body, timestamp);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(service.verifySignature(secret, body, header)).toBe(true);
  });

  it("rejects tampered bodies and stale timestamps", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const header = service.signPayload(secret, body, timestamp);
    expect(service.verifySignature(secret, body + " ", header)).toBe(false);
    expect(service.verifySignature(secret, body, service.signPayload(secret, body, timestamp - 4000))).toBe(false);
    expect(service.verifySignature("wrong-secret", body, header)).toBe(false);
    expect(service.verifySignature(secret, body, "garbage")).toBe(false);
  });
});
