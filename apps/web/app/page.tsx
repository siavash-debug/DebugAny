import Link from "next/link";
import {
  Activity, AlertTriangle, ExternalLink, LayoutDashboard, LifeBuoy, LogOut, Plus, Settings
} from "lucide-react";
import {
  getMetricsOverview,
  listIssues,
  type ApiIssue,
  type ApiResult,
  type ApiState,
  type MetricsOverview
} from "../lib/api";
import { requireWorkspace } from "../lib/workspace";
import { logoutAction } from "../actions/auth";
import { switchProjectAction } from "../actions/workspace";
import { ProjectCreateForm } from "./project-create-form";

// The dashboard reads live API state (with explicit fallbacks); render it per
// request so a production build never freezes one snapshot forever.
export const dynamic = "force-dynamic";

function StateBanner({ state }: { state: ApiState }) {
  const title = state.kind === "unauthorized"
    ? "Session expired"
    : state.kind === "unconfigured"
      ? "Dashboard not connected"
      : "API unavailable";
  return (
    <div className="demo-banner">
      <div><strong>{title}</strong><span>{state.message}</span></div>
      <a href="https://github.com/siavash-debug/DebugAny/blob/main/apps/web/README.md" target="_blank" rel="noreferrer">Setup guide <ExternalLink size={13} /></a>
    </div>
  );
}

function Metric({ title, value, note }: { title: string; value: string; note?: string }) {
  return (
    <article className="metric-card">
      <div className="metric-top"><span>{title}</span></div>
      <div className="metric-value">{value}</div>
      {note && <div className="metric-delta"><span>{note}</span></div>}
    </article>
  );
}

function HourChart({ series }: { series: MetricsOverview["series"] }) {
  const max = Math.max(...series.map((point) => point.count), 1);
  return (
    <div className="chart-area">
      <div className="y-labels"><span>{max}</span><span>{Math.ceil(max / 2)}</span><span>0</span></div>
      <div className="bar-chart">
        {series.map((point) => (
          <div key={point.bucket} className="bar-column" title={`${point.bucket.slice(11, 13)}:00 UTC — ${point.count} events`}>
            <span className="bar-error" style={{ height: `${(point.count / max) * 100}%` }} />
          </div>
        ))}
      </div>
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

function statusLabel(status: string): string {
  return status === "RESOLVED" ? "Resolved" : status === "IGNORED" ? "Ignored" : "Unresolved";
}

function statusClass(status: string): string {
  return status === "RESOLVED" ? "status-pill resolved" : status === "IGNORED" ? "status-pill ignored" : "status-pill unresolved";
}

function firstFailureState(...results: Array<ApiResult<unknown>>): ApiState {
  for (const result of results) {
    if (!result.ok) return result.state;
  }
  throw new Error("firstFailureState called with only successful results");
}

export default async function Home() {
  const workspace = await requireWorkspace();
  const projectId = workspace.active?.id;

  const [issuesResult, metricsResult] = projectId
    ? await Promise.all([listIssues(projectId, { limit: 4 }), getMetricsOverview(projectId, 24)])
    : [undefined, undefined];
  const connected = Boolean(projectId) && issuesResult?.ok === true && metricsResult?.ok === true;
  const metrics = metricsResult?.ok ? metricsResult.data : undefined;
  const issues = issuesResult?.ok ? issuesResult.data.issues : [];

  const latestBucket = metrics?.series.at(-1)?.bucket;
  const earliestBucket = metrics?.series[0]?.bucket;
  const eventsInWindow = metrics?.series.reduce((sum, point) => sum + point.count, 0) ?? 0;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark"><span className="brand-symbol"><Activity size={19} strokeWidth={2.5} /></span><span>debug<span>any</span></span></div>
        </div>

        <div className="nav-label">WORKSPACE</div>
        <nav className="nav-list">
          <span className="nav-item active"><LayoutDashboard size={17} />Overview</span>
          <Link className="nav-item" href="/issues"><AlertTriangle size={17} />Issues<span className="nav-count">{connected ? metrics!.totalIssues : "—"}</span></Link>
          {workspace.active && (
            <Link className="nav-item" href="/settings"><Settings size={17} />Settings</Link>
          )}
        </nav>

        <div className="nav-label project-label">PROJECTS</div>
        <nav className="project-list">
          {workspace.projects.map((project) => (
            <form key={project.id} action={switchProjectAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <button type="submit" className={"project-item" + (project.id === projectId ? " active" : "")}>
                <span className="project-dot blue" />{project.name}
              </button>
            </form>
          ))}
          {workspace.projects.length === 0 && <span className="project-item muted">No projects yet</span>}
        </nav>
        <ProjectCreateForm />

        <div className="sidebar-bottom">
          <a className="nav-item" href="https://github.com/siavash-debug/DebugAny" target="_blank" rel="noreferrer"><LifeBuoy size={17} />Help &amp; feedback</a>
          <div className="profile-row">
            <div className="profile-avatar">{workspace.user.name.slice(0, 2).toUpperCase()}</div>
            <div className="profile-copy"><strong>{workspace.user.name || "Signed in"}</strong><small>{workspace.user.email || ""}</small></div>
            <form action={logoutAction}><button className="profile-more" type="submit" aria-label="Sign out"><LogOut size={14} /></button></form>
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{workspace.active?.name ?? "Overview"}</strong></div>
        </header>

        <div className="content-wrap">
          <div className="page-heading"><div><div className="eyebrow"><span className="live-dot" />SYSTEM STATUS <span className="status-divider">/</span> LAST {metrics?.windowHours ?? 24} HOURS</div><h1>Overview</h1><p>Real metrics from the Debugany API — nothing on this page is simulated.</p></div><Link className="primary-button" href="/issues"><Plus size={16} /> View issues</Link></div>

          {!projectId && (
            <div className="empty-state panel">
              <AlertTriangle size={22} />
              <strong>No projects yet</strong>
              <span>Create your first project to start tracking errors. You will get an ingestion key to wire up the SDK.</span>
            </div>
          )}

          {projectId && !connected && <StateBanner state={firstFailureState(issuesResult!, metricsResult!)} />}

          {projectId && connected && (
            <>
              <div className="metric-grid">
                <Metric title={`Events · last ${metrics!.windowHours}h`} value={metrics!.totalEvents.toLocaleString()} note="Received by the API" />
                <Metric title="Issue groups" value={metrics!.totalIssues.toLocaleString()} note="All statuses" />
                <Metric title={`New issues · last ${metrics!.windowHours}h`} value={metrics!.newIssues.toLocaleString()} note="First seen in window" />
                <Metric title="Unresolved issues" value={metrics!.unresolved.toLocaleString()} note="Awaiting resolution" />
              </div>

              <div className="section-grid" id="performance">
                <article className="panel chart-panel">
                  <div className="panel-heading"><div><h2>Event activity</h2><p>Hourly event counts · {earliestBucket?.slice(0, 16)} → {latestBucket?.slice(0, 16)} UTC</p></div></div>
                  {eventsInWindow > 0 ? (
                    <>
                      <div className="chart-legend"><span><i className="legend-blue" />Events per hour</span><span className="chart-total">{eventsInWindow.toLocaleString()} <small>events in window</small></span></div>
                      <HourChart series={metrics!.series} />
                      <div className="x-labels"><span>{earliestBucket?.slice(11, 16)} UTC</span><span>{latestBucket?.slice(11, 16)} UTC</span></div>
                    </>
                  ) : (
                    <div className="empty-state">
                      <Activity size={22} />
                      <strong>No events in this window</strong>
                      <span>Send an event with your project&apos;s ingestion key and it will appear here within the hour.</span>
                    </div>
                  )}
                </article>

                <article className="panel health-panel">
                  <div className="panel-heading"><div><h2>Top issues</h2><p>Most recurring error groups</p></div></div>
                  {metrics!.topIssues.length > 0 ? (
                    <div className="service-list">
                      {metrics!.topIssues.map((issue) => (
                        <Link key={issue.id} href={`/issues/${issue.id}`} className="service-row">
                          <span className="service-name"><span className={issue.status === "RESOLVED" ? "service-dot green" : "service-dot amber"} />{issue.title}</span>
                          <strong>{issue.count.toLocaleString()}</strong>
                          <span className="service-latency">{formatTimeAgo(issue.lastSeenAt)}</span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <AlertTriangle size={22} />
                      <strong>No issues recorded yet</strong>
                      <span>Ingest events to start grouping errors into issues.</span>
                    </div>
                  )}
                </article>
              </div>

              <section className="panel issues-panel" id="issues">
                <div className="panel-heading issues-heading"><div><h2>Recent issues <span className="issue-count">{issues.length}</span></h2><p>Newest activity across all issue groups</p></div><div className="issue-actions"><Link className="text-button" href="/issues">View all issues <span>→</span></Link></div></div>
                {issues.length === 0 ? (
                  <div className="empty-state">
                    <AlertTriangle size={22} />
                    <strong>No issues yet</strong>
                    <span>Ingest an event with your project&apos;s ingestion key and grouped issues will appear here.</span>
                  </div>
                ) : (
                  <div className="table-scroll"><table><thead><tr><th>ISSUE</th><th>EVENTS</th><th>ENV</th><th>LAST SEEN</th><th>STATUS</th></tr></thead><tbody>{issues.map((issue: ApiIssue) => <tr key={issue.id}><td><Link href={`/issues/${issue.id}`} className="issue-title"><span className="issue-symbol error-symbol"><AlertTriangle size={14} /></span><div><strong>{issue.title}</strong><small>{issue.errorType}</small></div></Link></td><td><strong className="event-count">{issue.count}</strong></td><td className="muted-cell">{issue.environment}</td><td className="muted-cell">{formatTimeAgo(issue.lastSeenAt)}</td><td><span className={statusClass(issue.status)}><span />{statusLabel(issue.status)}</span></td></tr>)}</tbody></table></div>
                )}
                <div className="table-footer"><span>Showing <strong>{issues.length}</strong> of <strong>{metrics!.totalIssues}</strong> issues</span><Link className="text-link" href="/issues">Explore all issues <span>→</span></Link></div>
              </section>
            </>
          )}

          <footer className="page-footer"><span>© 2026 Debugany</span><span><span className="footer-status" /> {connected ? `API connected · ${workspace.active?.name}` : projectId ? "Preview mode" : "No project selected"}</span><a href="https://github.com/siavash-debug/DebugAny" target="_blank" rel="noreferrer">Open-source project <ExternalLink size={12} /></a></footer>
        </div>
      </section>
    </main>
  );
}
