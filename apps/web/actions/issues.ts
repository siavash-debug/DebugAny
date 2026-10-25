"use server";

import { revalidatePath } from "next/cache";
import { getSessionToken } from "../lib/session";
import { updateIssueStatus } from "../lib/api";

export type StatusActionState = { ok: true } | { ok: false; error: string };

/** Resolve/reopen/ignore from the issue detail page; fully project-scoped. */
export async function changeIssueStatus(
  projectId: string,
  issueId: string,
  status: "UNRESOLVED" | "RESOLVED" | "IGNORED"
): Promise<StatusActionState> {
  if (!(await getSessionToken())) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  const result = await updateIssueStatus(projectId, issueId, status);
  if (!result.ok) {
    return { ok: false, error: result.state.message };
  }
  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/issues");
  revalidatePath("/");
  return { ok: true };
}
