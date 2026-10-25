"use server";

import { revalidatePath } from "next/cache";
import { getSessionToken } from "../lib/session";
import { createWebhook, deleteWebhook, updateWebhook, type WebhookCreated } from "../lib/api";

export type WebhookFormState =
  | { error: null; created: WebhookCreated | null; idle?: boolean }
  | { error: string; created: null };

export async function createWebhookAction(
  _prev: WebhookFormState,
  formData: FormData
): Promise<WebhookFormState> {
  if (!(await getSessionToken())) return { error: "Your session has expired. Please sign in again.", created: null };
  const projectId = String(formData.get("projectId") ?? "");
  const url = String(formData.get("url") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!url) return { error: "Webhook URL is required.", created: null };

  const result = await createWebhook(projectId, url, name || undefined);
  if (!result.ok) return { error: result.state.message, created: null };
  revalidatePath("/settings");
  return { error: null, created: result.data };
}

export async function toggleWebhookAction(formData: FormData): Promise<void> {
  if (!(await getSessionToken())) return;
  const projectId = String(formData.get("projectId") ?? "");
  const webhookId = String(formData.get("webhookId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  const result = await updateWebhook(projectId, webhookId, { enabled });
  if (result.ok) revalidatePath("/settings");
}

export async function deleteWebhookAction(formData: FormData): Promise<void> {
  if (!(await getSessionToken())) return;
  const projectId = String(formData.get("projectId") ?? "");
  const webhookId = String(formData.get("webhookId") ?? "");
  const result = await deleteWebhook(projectId, webhookId);
  if (result.ok) revalidatePath("/settings");
}
