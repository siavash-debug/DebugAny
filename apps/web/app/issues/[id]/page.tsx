import Link from "next/link";
import { Activity, AlertTriangle } from "lucide-react";
import { getIssue, type ApiState } from "../../../lib/api";
import { StatusActions } from "../status-actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function StateBanner({ state }: { state: ApiState }) {
  return (
    <div className="demo-banner">
      <div><strong>{state.kind === "unconfigured" ? "Dashboard not connected" : "API unavailable"}</strong><span>{state.message}</span></div>
    </div>
  );
}

function formatTimestamp(value: string): string {
  return new Date(value).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default async function IssueDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ offset?: string }>;
}) {
  const { id } = await params;
  const { offset: offsetParam } = await searchParams;
  const offset = Number(offsetParam ?? "0") || 0;

  const result = await getIssue(id, PAGE_SIZE, offset);
  const notFoundState = !result.ok && result.state.kind === "error" && result.state.status === 404;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark"><span className="brand-symbol"><Activity size={19} strokeWidth={2.5} /></span><span>debug<span>any</span></span></div>
        </div>
        <nav className="nav-list" style={{ marginTop: 16 }}>
          <Link className="nav-item" href="/">Overview</Link>
          <Link className="nav-item" href="/issues">Issues</Link>
        </nav>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><Link href="/">Workspace</Link><span className="crumb-slash">/</span><Link href="/issues">Issues</Link><span className="crumb-slash">/</span><strong>Detail</strong></div>
        </header>

        <div className="content-wrap">
          {notFoundState && (
            <div className="empty-state">
              <AlertTriangle size={22} />
              <strong>Issue not found</strong>
              <span>It may belong to a different project or have been deleted. <Link href="/issues">Back to issues</Link></span>
            </div>
          )}

          {!result.ok && !notFoundState && <StateBanner state={result.state} />}

          {result.ok && (
            <>
              <div className="page-heading issue-detail-heading">
                <div>
                  <h1>{result.data.issue.title}</h1>
                  <p>{result.data.issue.errorType} · {result.data.issue.environment}{result.data.issue.release ? ` · release ${result.data.issue.release}` : ""}</p>
                </div>
                <div className="issue-detail-meta">
                  <span className={`status-pill ${result.data.issue.status === "RESOLVED" ? "resolved" : result.data.issue.status === "IGNORED" ? "ignored" : "unresolved"}`}>
                    <span />{result.data.issue.status.charAt(0) + result.data.issue.status.slice(1).toLowerCase()}
                  </span>
                  <StatusActions issueId={result.data.issue.id} currentStatus={result.data.issue.status} />
                </div>
              </div>

              <div className="metric-grid">
                <div className="metric-card">
                  <div className="metric-top"><span>Events</span></div>
                  <div className="metric-value">{result.data.issue.count.toLocaleString()}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-top"><span>First seen</span></div>
                  <div className="metric-value metric-date">{formatTimestamp(result.data.issue.firstSeenAt)}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-top"><span>Last seen</span></div>
                  <div className="metric-value metric-date">{formatTimestamp(result.data.issue.lastSeenAt)}</div>
                </div>
              </div>

              <section className="panel">
                <div className="panel-heading"><div><h2>Stack trace</h2><p>From the most recent event</p></div></div>
                {result.data.issue.stackTrace ? (
                  <pre className="stack-trace">{result.data.issue.stackTrace}</pre>
                ) : (
                  <div className="empty-state"><strong>No stack trace captured</strong><span>Events for this issue were reported without one.</span></div>
                )}
              </section>

              <section className="panel issues-panel">
                <div className="panel-heading issues-heading">
                  <div><h2>Event history <span className="issue-count">{result.data.totalEvents}</span></h2><p>Newest first</p></div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>WHEN</th><th>MESSAGE</th><th>ENV</th><th>RELEASE</th><th>METADATA</th></tr></thead>
                    <tbody>
                      {result.data.events.map((event) => (
                        <tr key={event.id}>
                          <td className="muted-cell">{formatTimestamp(event.occurredAt)}</td>
                          <td>{event.message}</td>
                          <td className="muted-cell">{event.environment}</td>
                          <td className="muted-cell">{event.release ?? "—"}</td>
                          <td className="muted-cell metadata-cell">
                            {event.metadata && Object.keys(event.metadata as object).length > 0
                              ? <code>{JSON.stringify(event.metadata)}</code>
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="table-footer">
                  <span>Showing <strong>{result.data.events.length}</strong> of <strong>{result.data.totalEvents}</strong> events</span>
                  <span className="pager">
                    {offset > 0 && <Link className="text-link" href={`/issues/${id}?offset=${Math.max(0, offset - PAGE_SIZE)}`}>← Previous</Link>}
                    {offset + PAGE_SIZE < result.data.totalEvents && <Link className="text-link" href={`/issues/${id}?offset=${offset + PAGE_SIZE}`}>Next →</Link>}
                  </span>
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
