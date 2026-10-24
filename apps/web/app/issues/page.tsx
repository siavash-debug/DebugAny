import Link from "next/link";
import { Activity, AlertTriangle, ChevronDown, Search } from "lucide-react";
import { apiConnectionMessage, listIssues, type ApiState } from "../../lib/api";

export const dynamic = "force-dynamic";

const STATUSES = ["UNRESOLVED", "RESOLVED", "IGNORED"] as const;
const PAGE_SIZE = 25;

function StateBanner({ state }: { state: ApiState }) {
  return (
    <div className="demo-banner">
      <div><strong>{state.kind === "unconfigured" ? "Dashboard not connected" : "API unavailable"}</strong><span>{state.message}</span></div>
    </div>
  );
}

function formatTimeAgo(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + " min ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + " hr ago";
  return Math.floor(hours / 24) + " days ago";
}

function pageHref(params: { status?: string; environment?: string; search?: string }, offset: number): string {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.environment) query.set("environment", params.environment);
  if (params.search) query.set("search", params.search);
  if (offset > 0) query.set("offset", String(offset));
  const suffix = query.toString();
  return "/issues" + (suffix ? "?" + suffix : "");
}

export default async function IssuesPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string; environment?: string; search?: string; offset?: string }>;
}) {
  const params = await searchParams;
  const offset = Number(params.offset ?? "0") || 0;
  const result = await listIssues({
    status: params.status,
    environment: params.environment,
    search: params.search,
    limit: PAGE_SIZE,
    offset
  });

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark"><span className="brand-symbol"><Activity size={19} strokeWidth={2.5} /></span><span>debug<span>any</span></span></div>
        </div>
        <nav className="nav-list" style={{ marginTop: 16 }}>
          <Link className="nav-item" href="/">Overview</Link>
          <a className="nav-item active" href="#">Issues</a>
        </nav>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><Link href="/">Workspace</Link><span className="crumb-slash">/</span><strong>Issues</strong></div>
        </header>

        <div className="content-wrap">
          <div className="page-heading"><div><h1>Issues</h1><p>Every error group for the connected project.</p></div></div>

          {!result.ok && <StateBanner state={result.state} />}

          {result.ok && (
            <>
              <form className="issue-filters" method="get" action="/issues">
                <div className="search-box">
                  <Search size={15} />
                  <input
                    type="search"
                    name="search"
                    defaultValue={params.search ?? ""}
                    placeholder="Search issue titles…"
                    aria-label="Search issue titles"
                  />
                </div>
                <label className="filter-select">
                  <span>Status</span>
                  <select name="status" defaultValue={params.status ?? ""}>
                    <option value="">All</option>
                    {STATUSES.map((status) => <option key={status} value={status}>{status.charAt(0) + status.slice(1).toLowerCase()}</option>)}
                  </select>
                  <ChevronDown size={13} />
                </label>
                <label className="filter-select">
                  <span>Environment</span>
                  <input name="environment" defaultValue={params.environment ?? ""} placeholder="production" aria-label="Filter by environment" />
                </label>
                <button className="primary-button" type="submit">Apply filters</button>
                <Link className="text-link" href="/issues">Clear</Link>
              </form>

              <section className="panel issues-panel">
                <div className="panel-heading issues-heading">
                  <div><h2>Issue groups <span className="issue-count">{result.data.total}</span></h2><p>{result.data.project.name} · {result.data.totalEvents.toLocaleString()} events received</p></div>
                </div>

                {result.data.issues.length === 0 ? (
                  <div className="empty-state">
                    <AlertTriangle size={22} />
                    <strong>No issues match these filters</strong>
                    <span>Ingest an event with the project key and it will appear here grouped by fingerprint.</span>
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead><tr><th>ISSUE</th><th>EVENTS</th><th>ENV</th><th>FIRST SEEN</th><th>LAST SEEN</th><th>STATUS</th></tr></thead>
                      <tbody>
                        {result.data.issues.map((issue) => (
                          <tr key={issue.id}>
                            <td>
                              <Link href={`/issues/${issue.id}`} className="issue-title">
                                <span className="issue-symbol error-symbol"><AlertTriangle size={14} /></span>
                                <div><strong>{issue.title}</strong><small>{issue.errorType}</small></div>
                              </Link>
                            </td>
                            <td><strong className="event-count">{issue.count}</strong></td>
                            <td className="muted-cell">{issue.environment}</td>
                            <td className="muted-cell">{formatTimeAgo(issue.firstSeenAt)}</td>
                            <td className="muted-cell">{formatTimeAgo(issue.lastSeenAt)}</td>
                            <td>
                              <span className={`status-pill ${issue.status === "RESOLVED" ? "resolved" : issue.status === "IGNORED" ? "ignored" : "unresolved"}`}>
                                <span />{issue.status.charAt(0) + issue.status.slice(1).toLowerCase()}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="table-footer">
                  <span>Showing <strong>{result.data.issues.length}</strong> of <strong>{result.data.total}</strong> issues</span>
                  <span className="pager">
                    {offset > 0 && <Link className="text-link" href={pageHref(params, Math.max(0, offset - PAGE_SIZE))}>← Previous</Link>}
                    {offset + PAGE_SIZE < result.data.total && <Link className="text-link" href={pageHref(params, offset + PAGE_SIZE)}>Next →</Link>}
                  </span>
                </div>
              </section>

              <footer className="page-footer">
                <span>© 2026 Debugany</span>
                <span><span className="footer-status" /> API connected</span>
              </footer>
            </>
          )}

          {!result.ok && (
            <footer className="page-footer">
              <span>© 2026 Debugany</span>
            </footer>
          )}
        </div>
      </section>
    </main>
  );
}
