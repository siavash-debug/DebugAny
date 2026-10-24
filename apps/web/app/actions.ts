"use server";

import { revalidatePath } from "next/cache";
import { updateIssueStatus } from "../lib/api";

export type StatusActionState = { ok: true } | { ok: false; error: string };

/**
 * Server action behind the resolve/reopen/ignore buttons. The dashboard's
 * ingestion key never reaches the browser; the mutation happens server-side.
 */
export async function changeIssueStatus(issueId: string, status: "UNRESOLVED" | "RESOLVED" | "IGNORED"): Promise<StatusActionState> {
  const result = await updateIssueStatus(issueId, status);
  if (!result.ok) {
    return { ok: false, error: result.state.message };
  }
  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/issues");
  revalidatePath("/");
  return { ok: true };
}
