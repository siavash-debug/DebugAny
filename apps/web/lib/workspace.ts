import { redirect } from "next/navigation";
import { getActiveProjectId, getSessionToken } from "./session";
import { getMe, listProjects, type ProjectSummary } from "./api";

export interface Workspace {
  user: { id: string; email: string; name: string };
  projects: ProjectSummary[];
  /** The project all dashboard queries are scoped to; always a member project. */
  active: ProjectSummary | null;
}

/**
 * Resolves the signed-in user and the active project for server components.
 * The active-project cookie is only honored when it references a project the
 * user is actually a member of; otherwise it falls back to the first one.
 * Redirects to /login when there is no valid session.
 */
export async function requireWorkspace(): Promise<Workspace> {
  const token = await getSessionToken();
  if (!token) redirect("/login");

  const [projectsResult, meResult] = await Promise.all([listProjects(), getMe()]);
  if (!projectsResult.ok) {
    if (projectsResult.state.kind === "unauthorized") redirect("/login");
    // API down: keep the user signed in but show an explicit unavailable state.
    return {
      user: { id: "", email: "", name: "" },
      projects: [],
      active: null
    };
  }

  const projects = projectsResult.data;
  // Cookies can only be written in server actions, so the fallback is purely
  // computational here; switchProjectAction persists the preference.
  const cookieProjectId = await getActiveProjectId();
  const active =
    projects.find((p) => p.id === cookieProjectId) ?? projects[0] ?? null;

  return {
    user: meResult.ok ? meResult.data.user : { id: "", email: "", name: "" },
    projects,
    active
  };
}
