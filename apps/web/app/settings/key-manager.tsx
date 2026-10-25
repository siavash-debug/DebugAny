"use client";

import { useActionState } from "react";
import { KeyRound, RotateCw, Trash2, X } from "lucide-react";
import {
  createKeyAction,
  revokeKeyAction,
  rotateKeyAction,
  type KeyFormState
} from "../../actions/keys";
import type { IngestionKeyView } from "../../lib/api";

const initial: KeyFormState = { error: null, created: null, idle: true };

function formatWhen(value: string | null): string {
  if (!value) return "never";
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + " min ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + " hr ago";
  return Math.floor(hours / 24) + " days ago";
}

export function KeyManager({ projectId, keys, canRotate }: { projectId: string; keys: IngestionKeyView[]; canRotate: boolean }) {
  const [createState, createFormAction, creating] = useActionState(createKeyAction, initial);
  const [rotateState, rotateFormAction, rotating] = useActionState(rotateKeyAction, initial);
  const revealed = createState.created ?? rotateState.created;

  return (
    <section className="panel">
      <div className="panel-heading issues-heading">
        <div><h2>Ingestion keys</h2><p>Used by the SDK to send events. Keys are stored hashed; the raw value is shown exactly once.</p></div>
      </div>

      {revealed && (
        <div className="key-reveal" role="alert">
          <div className="key-reveal-head">
            <strong>Copy this key now — it will not be shown again</strong>
            <button type="button" aria-label="Dismiss" onClick={() => window.location.reload()}><X size={14} /></button>
          </div>
          <code>{revealed.key}</code>
          <span>Prefix {revealed.prefix}… · store it in your app&apos;s server-side environment, never in client-side code.</span>
        </div>
      )}

      <form action={createFormAction} className="key-create-row">
        <input type="hidden" name="projectId" value={projectId} />
        <input name="name" placeholder="Label, e.g. production server" aria-label="Key label" maxLength={120} />
        <button className="primary-button" type="submit" disabled={creating}>
          <KeyRound size={14} /> {creating ? "Generating…" : "Create key"}
        </button>
      </form>
      {createState.error && <p className="auth-error" role="alert">{createState.error}</p>}

      <div className="table-scroll">
        <table>
          <thead><tr><th>LABEL</th><th>PREFIX</th><th>CREATED</th><th>LAST USED</th><th>STATUS</th><th /></tr></thead>
          <tbody>
            {keys.length === 0 && (
              <tr><td colSpan={6}><div className="empty-state" style={{ padding: 20 }}><strong>No keys yet</strong><span>Create a key to connect the SDK.</span></div></td></tr>
            )}
            {keys.map((key) => (
              <tr key={key.id} className={key.revokedAt ? "key-row-revoked" : undefined}>
                <td>{key.name ?? "—"}<small className="key-id">{key.id.slice(0, 12)}…</small></td>
                <td><code>{key.prefix}…</code></td>
                <td className="muted-cell">{formatWhen(key.createdAt)}</td>
                <td className="muted-cell">{formatWhen(key.lastUsedAt)}</td>
                <td><span className={key.revokedAt ? "status-pill ignored" : "status-pill resolved"}><span />{key.revokedAt ? "Revoked" : "Active"}</span></td>
                <td>
                  {!key.revokedAt && (
                    <div className="key-actions">
                      {canRotate && (
                        <form action={rotateFormAction}>
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="keyId" value={key.id} />
                          <button className="action-button" type="submit" disabled={rotating} title="Replace this key with a new one"><RotateCw size={12} /> Rotate</button>
                        </form>
                      )}
                      <form action={revokeKeyAction}>
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="keyId" value={key.id} />
                        <button className="action-button danger" type="submit" title="Stop this key from working immediately"><Trash2 size={12} /> Revoke</button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rotateState.error && <p className="auth-error" role="alert" style={{ padding: "0 20px 14px" }}>{rotateState.error}</p>}
    </section>
  );
}
