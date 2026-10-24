"use client";

import { useState, useTransition } from "react";
import { changeIssueStatus } from "../actions";

const STATUS_LABELS: Record<string, string> = {
  RESOLVED: "Resolve",
  UNRESOLVED: "Reopen",
  IGNORED: "Ignore"
};

export function StatusActions({ issueId, currentStatus }: { issueId: string; currentStatus: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const targets = (Object.keys(STATUS_LABELS) as Array<"RESOLVED" | "UNRESOLVED" | "IGNORED">)
    .filter((status) => status !== currentStatus);

  function apply(status: "UNRESOLVED" | "RESOLVED" | "IGNORED") {
    setError(null);
    startTransition(async () => {
      const result = await changeIssueStatus(issueId, status);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="status-actions">
      {targets.map((status) => (
        <button
          key={status}
          className="action-button"
          onClick={() => apply(status)}
          disabled={pending}
        >
          {STATUS_LABELS[status]}
        </button>
      ))}
      {pending && <span className="action-pending">Saving…</span>}
      {error && <span className="action-error" role="alert">{error}</span>}
    </div>
  );
}
