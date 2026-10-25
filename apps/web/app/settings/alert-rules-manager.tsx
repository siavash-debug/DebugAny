"use client";

import { useActionState, useState } from "react";
import { BellRing, Plus, Trash2 } from "lucide-react";
import {
  createAlertRuleAction,
  deleteAlertRuleAction,
  toggleAlertRuleAction,
  type RuleFormState
} from "../../actions/alerts";
import type { AlertRuleView, AlertRuleType, WebhookView } from "../../lib/api";

const initial: RuleFormState = { error: null };

const TYPE_LABELS: Record<AlertRuleType, string> = {
  NEW_ISSUE: "New issue",
  NEW_ISSUE_MATCHING: "New matching issue",
  ISSUE_THRESHOLD: "Issue occurrence threshold",
  ERROR_RATE: "Error rate"
};

function describeRule(rule: AlertRuleView): string {
  const c = rule.config;
  if (rule.type === "NEW_ISSUE") return "any new issue";
  if (rule.type === "NEW_ISSUE_MATCHING") return c.titleContains ? `new issue matching “${c.titleContains}”` : `new issue with fingerprint ${c.fingerprint?.slice(0, 10)}…`;
  if (rule.type === "ISSUE_THRESHOLD") return `${c.threshold}+ occurrences${c.fingerprint ? " on one issue" : ""}`;
  return `${c.eventThreshold}+ events in ${c.windowMinutes} min`;
}

export function AlertRulesManager({
  projectId,
  rules,
  webhooks
}: {
  projectId: string;
  rules: AlertRuleView[];
  webhooks: WebhookView[];
}) {
  const [state, formAction, pending] = useActionState(createAlertRuleAction, initial);
  const [type, setType] = useState<AlertRuleType>("NEW_ISSUE");

  return (
    <section className="panel">
      <div className="panel-heading issues-heading">
        <div><h2>Alert rules</h2><p>Trigger a webhook when the condition is met. Cooldowns prevent notification storms.</p></div>
      </div>

      <form action={formAction} className="rule-create" key={type}>
        <input type="hidden" name="projectId" value={projectId} />
        <input name="name" placeholder="Rule name" aria-label="Rule name" required minLength={2} maxLength={120} />
        <select name="type" value={type} onChange={(event) => setType(event.target.value as AlertRuleType)} aria-label="Rule type">
          {(Object.keys(TYPE_LABELS) as AlertRuleType[]).map((value) => (
            <option key={value} value={value}>{TYPE_LABELS[value]}</option>
          ))}
        </select>
        {type === "NEW_ISSUE_MATCHING" && (
          <input name="titleContains" placeholder="Title contains…" aria-label="Title filter" maxLength={200} required />
        )}
        {type === "ISSUE_THRESHOLD" && (
          <input name="threshold" type="number" min={2} placeholder="Occurrences" aria-label="Occurrence threshold" required />
        )}
        {type === "ERROR_RATE" && (
          <>
            <input name="eventThreshold" type="number" min={2} placeholder="Events" aria-label="Event threshold" required />
            <input name="windowMinutes" type="number" min={5} max={1440} placeholder="Window (min)" aria-label="Window in minutes" required />
          </>
        )}
        <select name="webhookId" aria-label="Webhook destination" defaultValue="">
          <option value="">No webhook (rule only)</option>
          {webhooks.map((webhook) => <option key={webhook.id} value={webhook.id}>{webhook.name || webhook.url}</option>)}
        </select>
        <input name="cooldownMinutes" type="number" min={1} max={10080} defaultValue={60} aria-label="Cooldown in minutes" title="Cooldown in minutes" />
        <button className="primary-button" type="submit" disabled={pending}><Plus size={14} /> {pending ? "Creating…" : "Create rule"}</button>
      </form>
      {state.error && <p className="auth-error" role="alert" style={{ margin: "0 20px 14px" }}>{state.error}</p>}

      {rules.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 10 }}>
          <BellRing size={20} />
          <strong>No alert rules yet</strong>
          <span>Create a rule and point it at a webhook to be notified about new or recurring failures.</span>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>RULE</th><th>CONDITION</th><th>COOLDOWN</th><th>LAST TRIGGERED</th><th>STATUS</th><th /></tr></thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.name}<small className="key-id">{TYPE_LABELS[rule.type]}</small></td>
                  <td className="muted-cell">{describeRule(rule)}</td>
                  <td className="muted-cell">{rule.cooldownMinutes} min</td>
                  <td className="muted-cell">{rule.lastTriggeredAt ? new Date(rule.lastTriggeredAt).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never"}</td>
                  <td><span className={rule.enabled ? "status-pill resolved" : "status-pill ignored"}><span />{rule.enabled ? "Enabled" : "Disabled"}</span></td>
                  <td>
                    <div className="key-actions">
                      <form action={toggleAlertRuleAction}>
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <input type="hidden" name="enabled" value={rule.enabled ? "false" : "true"} />
                        <button className="action-button" type="submit">{rule.enabled ? "Disable" : "Enable"}</button>
                      </form>
                      <form action={deleteAlertRuleAction}>
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <button className="action-button danger" type="submit" aria-label={`Delete ${rule.name}`}><Trash2 size={12} /></button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
