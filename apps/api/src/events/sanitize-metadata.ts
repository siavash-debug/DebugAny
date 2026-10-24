/**
 * Maximum serialized size (UTF-8 bytes) accepted for event metadata. Larger
 * payloads are rejected rather than silently truncated so callers know their
 * context was not stored.
 */
export const MAX_METADATA_BYTES = 8192;

const SENSITIVE_KEY_PATTERN =
  /(pass(word|wd)?|secret|token|authorization|auth|cookie|session|api[-_.]?key|access[-_.]?key|private[-_.]?key|credential|card[-_.]?number|cvv|ssn)/i;

const MAX_DEPTH = 4;
const MAX_ARRAY_LENGTH = 50;

export type SanitizableValue = string | number | boolean | null | SanitizableValue[] | { [key: string]: SanitizableValue };

export type MetadataRedactionResult =
  | { accepted: true; metadata: Record<string, unknown> }
  | { accepted: false; reason: string };

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && value.length > 512) {
      return value.slice(0, 512) + "…[truncated]";
    }
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return "[depth limit reached]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => redactValue(item, depth + 1));
  }
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : redactValue(child, depth + 1);
  }
  return result;
}

/**
 * Recursively redacts values stored under sensitive-looking keys and bounds the
 * serialized size of event metadata. This keeps credentials that leak into
 * error context (headers, config objects) out of long-term storage.
 */
export function sanitizeMetadata(input: unknown): MetadataRedactionResult {
  if (input === undefined || input === null) {
    return { accepted: true, metadata: {} };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return { accepted: false, reason: "metadata must be a JSON object" };
  }

  const serialized = JSON.stringify(input);
  if (serialized === undefined || serialized.length > MAX_METADATA_BYTES) {
    return { accepted: false, reason: `metadata exceeds ${MAX_METADATA_BYTES} bytes after serialization` };
  }

  return { accepted: true, metadata: redactValue(input, 0) as Record<string, unknown> };
}
