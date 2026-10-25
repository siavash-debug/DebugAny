"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createProject, deleteProject, getProject, updateProject } from "../lib/api";
import { clearActiveProjectCookie, getSessionToken, setActiveProjectCookie } from "../lib/session";
import { listProjects } from "../lib/api";

export type ProjectFormState = { error: string | null; ok?: boolean };

/** Creates a project and makes it the active one. */
export async function createProjectAction(_prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  if (!(await getSessionToken())) redirect("/login");
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  if (!name || !slug) return { error: "Name and slug are required." };

  const result = await createProject(name, slug);
  if (!result.ok) {
    return { error: result.state.kind === "error" ? result.state.message : `Could not create the project (${result.state.message})` };
  }
  await setActiveProjectCookie(result.data.id);
  revalidatePath("/", "layout");
  return { error: null, ok: true };
}

/** Switches the active project after verifying membership server-side. */
export async function switchProjectAction(formData: FormData): Promise<void> {
  if (!(await getSessionToken())) redirect("/login");
  const projectId = String(formData.get("projectId") ?? "");
  const projects = await listProjects();
  if (projects.ok && projects.data.some((p) => p.id === projectId)) {
    await setActiveProjectCookie(projectId);
  }
  revalidatePath("/", "layout");
}

export async function renameProjectAction(_prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  if (!(await getSessionToken())) redirect("/login");
  const projectId = String(formData.get("projectId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };

  const result = await updateProject(projectId, name);
  if (!result.ok) return { error: result.state.message };
  revalidatePath("/", "layout");
  return { error: null, ok: true };
}

/** Owner-only. The API enforces the role; deletion cascades events and issues. */
export async function deleteProjectAction(formData: FormData): Promise<void> {
  if (!(await getSessionToken())) redirect("/login");
  const projectId = String(formData.get("projectId") ?? "");
  const confirm = String(formData.get("confirm") ?? "").trim();
  // Require the exact project name as a deliberate confirmation step.
  const current = await getProject(projectId);
  if (!current.ok || current.data.name !== confirm) return;

  const result = await deleteProject(projectId);
  if (result.ok) {
    await clearActiveProjectCookie();
  }
  revalidatePath("/", "layout");
  redirect("/");
}
