import { createHash } from "node:crypto";

/**
 * Builds a stable fingerprint used to group similar events into one issue.
 *
 * The fingerprint deliberately ignores timestamps and variable parts deep in the
 * stack trace so that repeated occurrences of the same error land in the same
 * group. It is a pure function so grouping behavior can be unit-tested.
 */
export function buildEventFingerprint(input: {
  message: string;
  errorType?: string | null;
  stackTrace?: string | null;
}): string {
  const normalizedMessage = input.message.trim().replace(/\s+/g, " ");
  const stackHead = (input.stackTrace ?? "")
    .split("\n")
    .slice(0, 3)
    .map((line) => line.trim())
    .join("\n");

  return createHash("sha256")
    .update([input.errorType?.trim() || "Error", normalizedMessage, stackHead].join("|"))
    .digest("hex");
}
