/**
 * Server-side access to the Debugany API. The user's session token lives only
 * in an httpOnly cookie and is attached server-side; ingestion keys are never
 * sent to or held by the browser.
 *
 * Every function returns a discriminated result so pages can render accurate
 * loading/empty/error/unauthorized states instead of fabricated data.
 */

import { getSessionToken } from "./session";

export type ApiState =
  | { kind: "unconfigured"; message: string }
  | { kind: "unreachable"; message: string }
  | { kind: "unauthorized"; message: string }
  | { kind: "error"; status: number; message: string };

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; state: ApiState };

function apiBaseUrl(): string | undefined {
  const configured = process.env.DEBUGANY_API_URL;
  return configured?.endsWith("/") ? configured.slice(0, -1) : configured;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const baseUrl = apiBaseUrl();
  const sessionToken = await getSessionToken();
  if (!baseUrl || !sessionToken) {
    return { ok: false, state: { kind: "unconfigured", message: "No active session." } };
  }

  try {
    const response = await fetch(baseUrl + path, {
      ...init,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        ...(init?.headers ?? {})
      },
      cache: "no-store"
    });

    if (response.status === 401) {
      return { ok: false, state: { kind: "unauthorized", message: "Your session has expired. Please sign in again." } };
    }
    if (!response.ok) {
      return { ok: false, state: { kind: "error", status: response.status, message: `The API returned HTTP ${response.status}.` } };
    }
    if (response.status === 204) {
      return { ok: true, data: undefined as T };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, state: { kind: "unreachable", message: "Could not reach the Debugany API. Check that it is running and DEBUGANY_API_URL is correct." } };
  }
}

// ---- unauthenticated ----

export interface AuthPayload {
  token: string;
  user: { id: string; email: string; name: string };
}

/** Raw calls used by the auth server actions (no session required). */
async function authFetch<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) {
    return { ok: false, message: "Set DEBUGANY_API_URL in apps/web/.env.local to reach the API." };
  }
  try {
    const response = await fetch(baseUrl + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store"
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, message: payload?.message ?? `The API returned HTTP ${response.status}.` };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, message: "Could not reach the Debugany API. Check that it is running." };
  }
}

export function apiRegister(email: string, password: string, name: string) {
  return authFetch<AuthPayload>("/v1/auth/register", { email, password, name });
}

export function apiLogin(email: string, password: string) {
  return authFetch<AuthPayload>("/v1/auth/login", { email, password });
}

export function apiLogout(): Promise<void> {
  return getSessionToken().then((token) => {
    if (!token) return;
    const baseUrl = apiBaseUrl();
    if (!baseUrl) return;
    return fetch(baseUrl + "/v1/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    }).then(() => undefined, () => undefined);
  });
}

// ---- session-scoped ----

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  role: "OWNER" | "MEMBER";
  createdAt: string;
  updatedAt: string;
}

export interface ApiIssue {
  id: string;
  fingerprint: string;
  title: string;
  errorType: string;
  environment: string;
  release: string | null;
  status: "UNRESOLVED" | "RESOLVED" | "IGNORED";
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface IssueListResponse {
  issues: ApiIssue[];
  total: number;
  totalEvents: number;
  limit: number;
  offset: number;
}

export interface ApiEvent {
  id: string;
  message: string;
  errorType: string | null;
  environment: string;
  release: string | null;
  metadata: unknown;
  occurredAt: string;
  createdAt: string;
}

export interface IssueDetailResponse {
  issue: ApiIssue & { stackTrace: string | null; createdAt: string; updatedAt: string };
  events: ApiEvent[];
  totalEvents: number;
}

export interface MetricsOverview {
  windowHours: number;
  totalEvents: number;
  newIssues: number;
  unresolved: number;
  totalIssues: number;
  topIssues: Array<Pick<ApiIssue, "id" | "title" | "errorType" | "status" | "count" | "lastSeenAt">>;
  series: Array<{ bucket: string; count: number }>;
}

export interface IngestionKeyView {
  id: string;
  prefix: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface IngestionKeyCreated extends IngestionKeyView {
  key: string;
}

export function getMe(): Promise<ApiResult<{ user: { id: string; email: string; name: string } }>> {
  return apiFetch<{ user: { id: string; email: string; name: string } }>("/v1/auth/me");
}

export function listProjects(): Promise<ApiResult<ProjectSummary[]>> {
  return apiFetch<ProjectSummary[]>("/v1/projects");
}

export function createProject(name: string, slug: string) {
  return apiFetch<ProjectSummary>("/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, slug })
  });
}

export function updateProject(projectId: string, name: string) {
  return apiFetch<ProjectSummary>(`/v1/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
}

export function deleteProject(projectId: string) {
  return apiFetch<{ id: string; slug: string }>(`/v1/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE"
  });
}

export function getProject(projectId: string): Promise<ApiResult<ProjectSummary>> {
  // The API wraps the record: { project: {...} }.
  return apiFetch<{ project: ProjectSummary }>(`/v1/projects/${encodeURIComponent(projectId)}`)
    .then((result) => result.ok ? { ok: true, data: result.data.project } : result);
}

export function listIssues(projectId: string, params: {
  status?: string;
  environment?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<ApiResult<IssueListResponse>> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.environment) query.set("environment", params.environment);
  if (params.search) query.set("search", params.search);
  query.set("limit", String(params.limit ?? 25));
  query.set("offset", String(params.offset ?? 0));
  return apiFetch<IssueListResponse>(`/v1/projects/${encodeURIComponent(projectId)}/issues?${query.toString()}`);
}

export function getIssue(projectId: string, id: string, limit: number, offset: number): Promise<ApiResult<IssueDetailResponse>> {
  return apiFetch<IssueDetailResponse>(
    `/v1/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(id)}?limit=${limit}&offset=${offset}`
  );
}

export function updateIssueStatus(projectId: string, id: string, status: "UNRESOLVED" | "RESOLVED" | "IGNORED") {
  return apiFetch<ApiIssue>(`/v1/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status })
  });
}

export function getMetricsOverview(projectId: string, windowHours: number): Promise<ApiResult<MetricsOverview>> {
  return apiFetch<MetricsOverview>(`/v1/projects/${encodeURIComponent(projectId)}/metrics/overview?windowHours=${windowHours}`);
}

export function listKeys(projectId: string): Promise<ApiResult<IngestionKeyView[]>> {
  return apiFetch<IngestionKeyView[]>(`/v1/projects/${encodeURIComponent(projectId)}/keys`);
}

export function createKey(projectId: string, name?: string) {
  return apiFetch<IngestionKeyCreated>(`/v1/projects/${encodeURIComponent(projectId)}/keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
}

export function rotateKey(projectId: string, keyId: string) {
  return apiFetch<IngestionKeyCreated>(`/v1/projects/${encodeURIComponent(projectId)}/keys/${encodeURIComponent(keyId)}/rotate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "ROTATE" })
  });
}

export function revokeKey(projectId: string, keyId: string) {
  return apiFetch<{ revoked: boolean }>(`/v1/projects/${encodeURIComponent(projectId)}/keys/${encodeURIComponent(keyId)}`, {
    method: "DELETE"
  });
}
