/**
 * Server-side access to the Debugany API. The ingestion key stays on the
 * server; the browser only ever sees rendered results.
 *
 * Every function returns a discriminated result so pages can render accurate
 * loading/empty/error/disconnected states instead of fabricated data.
 */

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

export function apiConnectionMessage(): string {
  return "Set DEBUGANY_API_URL and DEBUGANY_API_KEY in apps/web/.env.local to load real events.";
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const baseUrl = apiBaseUrl();
  const apiKey = process.env.DEBUGANY_API_KEY;
  if (!baseUrl || !apiKey) {
    return { ok: false, state: { kind: "unconfigured", message: apiConnectionMessage() } };
  }

  try {
    const response = await fetch(baseUrl + path, {
      ...init,
      headers: {
        "x-debugany-key": apiKey,
        ...(init?.headers ?? {})
      },
      cache: "no-store"
    });

    if (response.status === 401) {
      return { ok: false, state: { kind: "unauthorized", message: "The API rejected the dashboard key. Check DEBUGANY_API_KEY in apps/web/.env.local." } };
    }
    if (!response.ok) {
      return { ok: false, state: { kind: "error", status: response.status, message: `The API returned HTTP ${response.status}.` } };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, state: { kind: "unreachable", message: "Could not reach the API. Check that it is running and DEBUGANY_API_URL is correct." } };
  }
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
  project: { id: string; name: string; slug: string };
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
  project: { id: string; name: string; slug: string };
  issue: ApiIssue & { stackTrace: string | null; createdAt: string; updatedAt: string };
  events: ApiEvent[];
  totalEvents: number;
}

export function listIssues(params: {
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
  return apiFetch<IssueListResponse>(`/v1/issues?${query.toString()}`);
}

export function getIssue(id: string, limit: number, offset: number): Promise<ApiResult<IssueDetailResponse>> {
  return apiFetch<IssueDetailResponse>(`/v1/issues/${encodeURIComponent(id)}?limit=${limit}&offset=${offset}`);
}

export function updateIssueStatus(id: string, status: "UNRESOLVED" | "RESOLVED" | "IGNORED"): Promise<ApiResult<ApiIssue>> {
  return apiFetch<ApiIssue>(`/v1/issues/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status })
  });
}
