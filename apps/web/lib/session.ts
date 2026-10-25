import { cookies } from "next/headers";

import { SESSION_COOKIE, ACTIVE_PROJECT_COOKIE } from "./session-values";

export { SESSION_COOKIE, ACTIVE_PROJECT_COOKIE };

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** Reads the raw session token from the httpOnly cookie (server-side only). */
export async function getSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

export async function getActiveProjectId(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(ACTIVE_PROJECT_COOKIE)?.value;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 3600
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(ACTIVE_PROJECT_COOKIE);
}

export async function setActiveProjectCookie(projectId: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_PROJECT_COOKIE, projectId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 3600
  });
}

export async function clearActiveProjectCookie(): Promise<void> {
  const store = await cookies();
  store.delete(ACTIVE_PROJECT_COOKIE);
}
