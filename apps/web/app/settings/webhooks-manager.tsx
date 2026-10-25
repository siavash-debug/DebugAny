"use client";

import { useActionState, useState } from "react";
import { ChevronDown, Trash2, Webhook } from "lucide-react";
import {
  createWebhookAction,
  deleteWebhookAction,
  toggleWebhookAction,
  type WebhookFormState
} from "../../actions/webhooks";
import type { WebhookDeliveryView, WebhookView } from "../../lib/api";

const initial: WebhookFormState = { error: null, created: null, idle: true };

function formatWhen(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function WebhooksManager({
  projectId,
  webhooks,
  deliveriesByWebhook
}: {
  projectId: string;
  webhooks: WebhookView[];
  deliveriesByWebhook: Record<string, WebhookDeliveryView[]>;
}) {
  const [state, formAction, pending] = useActionState(createWebhookAction, initial);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <section className="panel">
      <div className="panel-heading issues-heading">
        <div><h2>Webhooks</h2><p>Destinations for alert notifications. Payloads are signed with HMAC-SHA256 and a timestamp; verify the <code>x-debugany-signature</code> header before trusting a delivery. Destinations on private or loopback addresses are rejected.</p></div>
      </div>

      {state.created && (
        <div className="key-reveal" role="alert">
          <div className="key-reveal-head">
            <strong>Store this signing secret now — it will not be shown again</strong>
            <button type="button" aria-label="Dismiss" onClick={() => window.location.reload()}>×</button>
          </div>
          <code>{state.created.signingSecret}</code>
          <span>Used as the HMAC-SHA256 key over &quot;&lt;timestamp&gt;.&lt;body&gt;&quot;.</span>
        </div>
      )}

      <form action={formAction} className="rule-create">
        <input type="hidden" name="projectId" value={projectId} />
        <input name="url" placeholder="https://hooks.example.com/debugany" aria-label="Webhook URL" type="url" required maxLength={2000} />
        <input name="name" placeholder="Label (optional)" aria-label="Webhook label" maxLength={120} />
        <button className="primary-button" type="submit" disabled={pending}><Webhook size={14} /> {pending ? "Creating…" : "Add webhook"}</button>
      </form>
      {state.error && <p className="auth-error" role="alert" style={{ margin: "0 20px 14px" }}>{state.error}</p>}

      {webhooks.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 10 }}>
          <Webhook size={20} />
          <strong>No webhooks yet</strong>
          <span>Add a destination to receive signed alert notifications.</span>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>WEBHOOK</th><th>STATUS</th><th>RECENT DELIVERIES</th><th /></tr></thead>
            <tbody>
              {webhooks.map((webhook) => {
                const deliveries = deliveriesByWebhook[webhook.id] ?? [];
                return (
                  <tr key={webhook.id}>
                    <td>{webhook.name || "—"}<small className="key-id">{webhook.url}</small></td>
                    <td><span className={webhook.enabled ? "status-pill resolved" : "status-pill ignored"}><span />{webhook.enabled ? "Enabled" : "Disabled"}</span></td>
                    <td>
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => setExpanded(expanded === webhook.id ? null : webhook.id)}
                        aria-expanded={expanded === webhook.id}
                      >
                        View deliveries <ChevronDown size={12} />
                      </button>
                      {expanded === webhook.id && (
                        <div className="delivery-list">
                          {deliveries.length === 0 ? (
                            <span className="muted-cell">No deliveries yet.</span>
                          ) : (
                            deliveries.map((entry) => (
                              <div key={entry.id} className="delivery-row">
                                <span className={entry.status === "DELIVERED" ? "status-pill resolved" : entry.status === "FAILED" ? "status-pill unresolved" : "status-pill ignored"}>
                                  <span />{entry.status}
                                </span>
                                <span className="muted-cell">
                                  {formatWhen(entry.createdAt)} · attempts {entry.attempts}
                                  {entry.responseStatus ? ` · HTTP ${entry.responseStatus}` : ""}
                                  {entry.error ? ` · ${entry.error}` : ""}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="key-actions">
                        <form action={toggleWebhookAction}>
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="webhookId" value={webhook.id} />
                          <input type="hidden" name="enabled" value={webhook.enabled ? "false" : "true"} />
                          <button className="action-button" type="submit">{webhook.enabled ? "Disable" : "Enable"}</button>
                        </form>
                        <form action={deleteWebhookAction}>
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="webhookId" value={webhook.id} />
                          <button className="action-button danger" type="submit" aria-label="Delete webhook"><Trash2 size={12} /></button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
