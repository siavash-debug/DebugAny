"use server";

import { revalidatePath } from "next/cache";
import { getSessionToken } from "../lib/session";
import {
  createAlertRule,
  deleteAlertRule,
  updateAlertRule,
  type AlertRuleType,
  type AlertRuleView
} from "../lib/api";

export type RuleFormState = { error: string | null };

function parseConfig(type: AlertRuleType, formData: FormData): { config: AlertRuleView["config"] | null; error: string | null } {
  const get = (key: string) => String(formData.get(key) ?? "").trim();
  if (type === "NEW_ISSUE") return { config: {}, error: null };
  if (type === "NEW_ISSUE_MATCHING") {
    const titleContains = get("titleContains");
    if (!titleContains) return { config: null, error: "Provide a title filter." };
    return { config: { titleContains }, error: null };
  }
  if (type === "ISSUE_THRESHOLD") {
    const threshold = Number(get("threshold"));
    if (!Number.isInteger(threshold) || threshold < 2) {
      return { config: null, error: "Threshold must be an integer of at least 2." };
    }
    return { config: { threshold }, error: null };
  }
  const eventThreshold = Number(get("eventThreshold"));
  const windowMinutes = Number(get("windowMinutes"));
  if (!Number.isInteger(eventThreshold) || eventThreshold < 2) {
    return { config: null, error: "Event threshold must be an integer of at least 2." };
  }
  if (!Number.isInteger(windowMinutes) || windowMinutes < 5 || windowMinutes > 1440) {
    return { config: null, error: "Window must be between 5 and 1440 minutes." };
  }
  return { config: { eventThreshold, windowMinutes }, error: null };
}

export async function createAlertRuleAction(
  _prev: RuleFormState,
  formData: FormData
): Promise<RuleFormState> {
  if (!(await getSessionToken())) return { error: "Your session has expired. Please sign in again." };
  const projectId = String(formData.get("projectId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "") as AlertRuleType;
  const webhookId = String(formData.get("webhookId") ?? "").trim();
  const cooldownMinutes = Number(String(formData.get("cooldownMinutes") ?? "60"));

  if (!name || name.length < 2) return { error: "Give the rule a name." };
  const { config, error } = parseConfig(type, formData);
  if (!config) return { error: error ?? "Invalid rule configuration." };

  const result = await createAlertRule(projectId, {
    name,
    type,
    config,
    ...(Number.isInteger(cooldownMinutes) && cooldownMinutes >= 1 ? { cooldownMinutes } : {}),
    ...(webhookId ? { webhookId } : {})
  });
  if (!result.ok) return { error: result.state.message };
  revalidatePath("/settings");
  return { error: null };
}

export async function toggleAlertRuleAction(formData: FormData): Promise<void> {
  if (!(await getSessionToken())) return;
  const projectId = String(formData.get("projectId") ?? "");
  const ruleId = String(formData.get("ruleId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  const result = await updateAlertRule(projectId, ruleId, { enabled });
  if (result.ok) revalidatePath("/settings");
}

export async function deleteAlertRuleAction(formData: FormData): Promise<void> {
  if (!(await getSessionToken())) return;
  const projectId = String(formData.get("projectId") ?? "");
  const ruleId = String(formData.get("ruleId") ?? "");
  const result = await deleteAlertRule(projectId, ruleId);
  if (result.ok) revalidatePath("/settings");
}
