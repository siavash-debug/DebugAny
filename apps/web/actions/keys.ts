"use server";

import { revalidatePath } from "next/cache";
import { getSessionToken } from "../lib/session";
import { createKey, revokeKey, rotateKey, type IngestionKeyCreated } from "../lib/api";

export type KeyFormState =
  | { error: null; created: IngestionKeyCreated }
  | { error: string; created: null }
  | { error: null; created: null; idle: true };

/** The raw key is returned by the API exactly once and rendered once. */
export async function createKeyAction(_prev: KeyFormState, formData: FormData): Promise<KeyFormState> {
  if (!(await getSessionToken())) return { error: "Your session has expired. Please sign in again.", created: null };
  const projectId = String(formData.get("projectId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const result = await createKey(projectId, name || undefined);
  if (!result.ok) return { error: result.state.message, created: null };
  revalidatePath("/settings");
  return { error: null, created: result.data };
}

export async function rotateKeyAction(_prev: KeyFormState, formData: FormData): Promise<KeyFormState> {
  if (!(await getSessionToken())) return { error: "Your session has expired. Please sign in again.", created: null };
  const projectId = String(formData.get("projectId") ?? "");
  const keyId = String(formData.get("keyId") ?? "");
  const result = await rotateKey(projectId, keyId);
  if (!result.ok) return { error: result.state.message, created: null };
  revalidatePath("/settings");
  return { error: null, created: result.data };
}

export async function revokeKeyAction(formData: FormData): Promise<void> {
  if (!(await getSessionToken())) return;
  const projectId = String(formData.get("projectId") ?? "");
  const keyId = String(formData.get("keyId") ?? "");
  const result = await revokeKey(projectId, keyId);
  if (result.ok) {
    revalidatePath("/settings");
  }
}
