"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { createProjectAction, type ProjectFormState } from "../actions/workspace";

const initial: ProjectFormState = { error: null };

export function ProjectCreateForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createProjectAction, initial);

  return (
    <div className="project-create">
      {open ? (
        <form action={formAction} className="project-create-form">
          <div className="project-create-head">
            <span>New project</span>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)}><X size={13} /></button>
          </div>
          <input name="name" placeholder="Name, e.g. Checkout API" aria-label="Project name" required maxLength={120} />
          <input name="slug" placeholder="slug, e.g. checkout-api" aria-label="Project slug" pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]" required maxLength={64} />
          {state.error && <p className="auth-error" role="alert">{state.error}</p>}
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create project"}
          </button>
        </form>
      ) : (
        <button className="nav-item project-add" type="button" onClick={() => setOpen(true)}>
          <Plus size={15} /> New project
        </button>
      )}
    </div>
  );
}
