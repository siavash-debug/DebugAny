"use client";

import { useActionState } from "react";
import { renameProjectAction, deleteProjectAction, type ProjectFormState } from "../../actions/workspace";

const initial: ProjectFormState = { error: null };

export function RenameForm({ projectId, currentName, canRename }: { projectId: string; currentName: string; canRename: boolean }) {
  const [state, formAction, pending] = useActionState(renameProjectAction, initial);

  return (
    <section className="panel">
      <div className="panel-heading issues-heading"><div><h2>General</h2><p>Project name shown across the dashboard.</p></div></div>
      <form action={formAction} className="key-create-row" style={{ padding: "0 20px 18px" }}>
        <input type="hidden" name="projectId" value={projectId} />
        <input name="name" defaultValue={currentName} aria-label="Project name" disabled={!canRename} required maxLength={120} />
        <button className="primary-button" type="submit" disabled={pending || !canRename}>
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
      {state.error && <p className="auth-error" role="alert" style={{ padding: "0 20px 14px" }}>{state.error}</p>}
      {!canRename && <p className="muted-note">Only project owners can rename this project.</p>}
    </section>
  );
}

export function DangerZone({ projectId, projectName }: { projectId: string; projectName: string }) {
  return (
    <section className="panel danger-zone">
      <div className="panel-heading issues-heading"><div><h2>Danger zone</h2><p>Deleting removes the project with all of its events and issues. Ingestion keys stop working immediately.</p></div></div>
      <form action={deleteProjectAction} className="key-create-row" style={{ padding: "0 20px 18px" }}>
        <input type="hidden" name="projectId" value={projectId} />
        <input name="confirm" placeholder={`Type ${projectName} to confirm`} aria-label="Type the project name to confirm deletion" required />
        <button className="primary-button danger-button" type="submit">Delete project</button>
      </form>
    </section>
  );
}
