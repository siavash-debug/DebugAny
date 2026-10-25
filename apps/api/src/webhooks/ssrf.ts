import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const ALLOWED_PORTS = new Set([80, 443]);
const DEFAULT_PORT: Record<string, number> = { "http:": 80, "https:": 443 };

/**
 * True when the address must never be contacted: loopback, RFC1918 private,
 * CGNAT, link-local (includes the cloud metadata address), benchmark,
 * reserved, multicast, and their IPv6 equivalents plus IPv4-mapped IPv6.
 */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIPv4(address);
  if (version === 6) return isBlockedIPv6(address);
  return true; // not an IP literal: fail closed
}

function isBlockedIPv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isBlockedIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d) — check the embedded IPv4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  if (lower === "::" || lower === "::1") return true; // unspecified, loopback
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  if (lower.startsWith("ff")) return true; // multicast
  if (lower.startsWith("::ffff:")) {
    // Mapped with hex form — treat as blocked (conservative).
    return true;
  }
  return false;
}

export interface ParsedWebhookUrl {
  protocol: "http:" | "https:";
  port: number;
  hostname: string;
}

export function parseWebhookUrl(raw: string): ParsedWebhookUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Webhook URL is not a valid absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Webhook URL must use http or https");
  }
  const port = url.port ? Number(url.port) : DEFAULT_PORT[url.protocol];
  if (!ALLOWED_PORTS.has(port)) {
    throw new Error("Webhook URL must use port 80 or 443");
  }
  if (!url.hostname) {
    throw new Error("Webhook URL has no hostname");
  }
  return { protocol: url.protocol, port, hostname: url.hostname };
}

/**
 * Resolves the hostname and refuses any address that is not public. This is
 * the pre-flight check; the pinned lookup in the delivery agent enforces the
 * same policy at connect time, which closes the DNS-rebinding window.
 */
export async function assertPublicWebhookHost(raw: string): Promise<ParsedWebhookUrl> {
  const parsed = parseWebhookUrl(raw);
  const isLiteral = isIP(parsed.hostname) !== 0;
  const addresses = isLiteral
    ? [{ address: parsed.hostname }]
    : await lookup(parsed.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error("Webhook host does not resolve");
  }
  for (const entry of addresses) {
    if (isBlockedAddress(entry.address)) {
      throw new Error(`Webhook host resolves to a forbidden address (${entry.address})`);
    }
  }
  return parsed;
}
