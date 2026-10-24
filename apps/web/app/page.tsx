import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, Check,
  ChevronDown, CircleHelp, Clock3, Command, ExternalLink, Filter,
  LayoutDashboard, LifeBuoy, Plus, Search, Settings2, ShieldCheck,
  SlidersHorizontal, Sparkles, Terminal, Zap
} from "lucide-react";

// The dashboard reads live API state (with explicit fallbacks); render it per
// request so a production build never freezes one snapshot forever.
export const dynamic = "force-dynamic";

const sampleIssues = [
  { type: "error", name: "Payment provider timed out", code: "TimeoutError", service: "checkout-api", env: "production", count: "128", time: "2 min ago", status: "Unresolved" },
  { type: "warning", name: "Failed to refresh user session", code: "AuthRefreshError", service: "web-client", env: "production", count: "46", time: "8 min ago", status: "Unresolved" },
  { type: "error", name: "Cannot read properties of undefined", code: "TypeError", service: "dashboard-web", env: "staging", count: "19", time: "14 min ago", status: "Investigating" },
  { type: "error", name: "Database connection pool exhausted", code: "DatabaseError", service: "users-api", env: "production", count: "8", time: "27 min ago", status: "Unresolved" }
];

const chartBars = [24, 31, 20, 42, 34, 50, 38, 28, 44, 58, 39, 31, 48, 64, 44, 36, 51, 71, 49, 40, 59, 46, 78, 55, 42, 62, 48, 35, 53, 68, 46, 57, 38, 72, 49, 61, 43, 83, 55, 47, 66, 51, 39, 59, 74, 48, 63, 42];

function Logo() {
  return <div className="brand-mark"><span className="brand-symbol"><Activity size={19} strokeWidth={2.5} /></span><span>debug<span>any</span></span></div>;
}

function Metric({ title, value, delta, note, positive, icon: Icon }: { title: string; value: string; delta?: string; note?: string; positive?: boolean; icon: typeof Activity }) {
  return (
    <article className="metric-card">
      <div className="metric-top"><span>{title}</span><span className="metric-icon"><Icon size={16} /></span></div>
      <div className="metric-value">{value}</div>
      {delta ? <div className={positive ? "metric-delta positive" : "metric-delta negative"}>{positive ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}{delta}<span> vs previous 24h</span></div> : <div className="metric-delta"><span>{note ?? (value === "—" ? "Not available yet" : "Illustrative sample")}</span></div>}
    </article>
  );
}

type DashboardIssue = {
  type: string; name: string; code: string; service: string; env: string;
  count: string; time: string; status: string;
};

async function getDashboardIssues(): Promise<{ issues: DashboardIssue[]; connected: boolean; totalEvents: number; issueGroupCount: number; projectName: string; connectionMessage: string }> {
  const configuredUrl = process.env.DEBUGANY_API_URL;
  const baseUrl = configuredUrl?.endsWith("/") ? configuredUrl.slice(0, -1) : configuredUrl;
  const apiKey = process.env.DEBUGANY_API_KEY;
  if (!baseUrl || !apiKey) return { issues: sampleIssues, connected: false, totalEvents: 1284, issueGroupCount: 12, projectName: "Demo workspace", connectionMessage: "Set DEBUGANY_API_URL and DEBUGANY_API_KEY in apps/web/.env.local to load real events." };
  try {
    const response = await fetch(baseUrl + "/v1/issues?limit=25", { headers: { "x-debugany-key": apiKey }, cache: "no-store" });
    if (!response.ok) return { issues: sampleIssues, connected: false, totalEvents: 1284, issueGroupCount: 12, projectName: "Demo workspace", connectionMessage: response.status === 401 ? "The API rejected the key. Check DEBUGANY_API_KEY in apps/web/.env.local." : "The API returned HTTP " + response.status + ". Showing sample data instead." };
    const data = await response.json() as {
      totalEvents: number; total: number; project: { name: string; slug: string };
      issues: Array<{ title: string; errorType: string; environment: string; count: number; status: string; lastSeenAt: string }>;
    };
    return {
      connected: true, totalEvents: data.totalEvents, issueGroupCount: data.total, projectName: data.project.name, connectionMessage: "Connected to the Debugany API. Counts reflect persisted events and issues.",
      issues: data.issues.slice(0, 4).map((issue) => ({
        type: "error", name: issue.title, code: issue.errorType, service: data.project.slug,
        env: issue.environment, count: String(issue.count), time: formatTimeAgo(issue.lastSeenAt),
        status: issue.status === "RESOLVED" ? "Resolved" : issue.status === "IGNORED" ? "Ignored" : "Unresolved"
      }))
    };
  } catch { return { issues: sampleIssues, connected: false, totalEvents: 1284, issueGroupCount: 12, projectName: "Demo workspace", connectionMessage: "Could not reach the API. Check that it is running and DEBUGANY_API_URL is correct." }; }
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

export default async function Home() {
  const dashboard = await getDashboardIssues();
  const issues = dashboard.issues;
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><Logo /><span className="workspace-tag">BETA</span></div>
        <button className="workspace-switch"><span className="workspace-avatar">S</span><span className="workspace-copy"><strong>Siavash workspace</strong><small>Free plan</small></span><ChevronDown size={15} /></button>
        <div className="nav-label">WORKSPACE</div>
        <nav className="nav-list">
          <a className="nav-item active" href="#"><LayoutDashboard size={17} />Overview</a>
          <a className="nav-item" href="#issues"><AlertTriangle size={17} />Issues<span className="nav-count">{dashboard.connected ? dashboard.issueGroupCount : 12}</span></a>
          <a className="nav-item" href="#performance"><Activity size={17} />Performance</a>
          <a className="nav-item" href="#alerts"><Bell size={17} />Alerts</a>
        </nav>
        <div className="nav-label project-label">PROJECTS <button aria-label="Add project"><Plus size={14} /></button></div>
        <a className="project-item" href="#issues"><span className="project-dot blue" />checkout-api <span className="project-env">PROD</span></a>
        <a className="project-item" href="#issues"><span className="project-dot purple" />dashboard-web</a>
        <a className="project-item" href="#issues"><span className="project-dot green" />users-api</a>
        <div className="sidebar-bottom">
          <a className="nav-item" href="#settings"><Settings2 size={17} />Settings</a>
          <a className="nav-item" href="#help"><LifeBuoy size={17} />Help & feedback</a>
          <div className="profile-row"><div className="profile-avatar">SS</div><div className="profile-copy"><strong>Siavash Safi</strong><small>Developer</small></div><MoreDots /></div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>Overview</strong></div>
          <div className="topbar-actions"><div className="search-box"><Search size={15} /><span>Search anything...</span><kbd><Command size={10} /> K</kbd></div><button className="icon-button" aria-label="Help"><CircleHelp size={17} /></button><button className="icon-button notification-button" aria-label="Notifications"><Bell size={17} /><i /></button><div className="top-avatar">SS</div></div>
        </header>

        <div className="content-wrap">
          <div className="page-heading"><div><div className="eyebrow"><span className="live-dot" />SYSTEM STATUS <span className="status-divider">/</span> LAST 24 HOURS</div><h1>Good morning, Siavash <span className="wave">✳</span></h1><p>Here’s what’s happening across your applications.</p></div><button className="primary-button"><Plus size={16} /> Add project</button></div>

          <div className="demo-banner"><div className="demo-icon"><Sparkles size={17} /></div><div><strong>{dashboard.connected ? dashboard.projectName + " · Connected" : "Preview workspace"}</strong><span>{dashboard.connectionMessage}</span></div><a href="https://github.com/siavash-debug/DebugAny/blob/main/apps/web/README.md" target="_blank" rel="noreferrer">Setup guide <ExternalLink size={13} /></a></div>

          <div className="metric-grid">
            <Metric title="Total events" value={dashboard.connected ? dashboard.totalEvents.toLocaleString() : "1,284"} delta={dashboard.connected ? undefined : "12.8%"} note={dashboard.connected ? "Received by API" : undefined} icon={Activity} />
            <Metric title="Issue groups" value={dashboard.connected ? String(dashboard.issueGroupCount) : "12"} delta={dashboard.connected ? undefined : "8.4%"} note={dashboard.connected ? "Grouped by fingerprint" : undefined} positive icon={AlertTriangle} />
            <Metric title="Affected users" value="—" icon={Zap} />
            <Metric title="Avg. response time" value="—" icon={Clock3} />
          </div>

          <div className="section-grid" id="performance">
            <article className="panel chart-panel">
              <div className="panel-heading"><div><h2>Event activity</h2><p>{dashboard.connected ? "Chart is illustrative; time-series API is not implemented yet." : "Sample chart · connect the API for live issue data"}</p></div><button className="select-button">Last 24 hours <ChevronDown size={14} /></button></div>
              <div className="chart-legend"><span><i className="legend-blue" />Errors</span><span><i className="legend-purple" />Warnings</span><span className="chart-total">{dashboard.connected ? dashboard.totalEvents.toLocaleString() : "1,284"} <small>{dashboard.connected ? "events received · chart sample" : "sample events"}</small></span></div>
              <div className="chart-area">
                <div className="y-labels"><span>80</span><span>60</span><span>40</span><span>20</span><span>0</span></div>
                <div className="bar-chart">{chartBars.map((height, index) => <div key={index} className="bar-column"><span className="bar-error" style={{ height: `${height}%` }} /><span className="bar-warning" style={{ height: `${Math.max(7, height * 0.3)}%` }} /></div>)}</div>
              </div>
              <div className="x-labels"><span>12 AM</span><span>4 AM</span><span>8 AM</span><span>12 PM</span><span>4 PM</span><span>8 PM</span><span>Now</span></div>
            </article>

            <article className="panel health-panel">
              <div className="panel-heading"><div><h2>Service health</h2><p>Current availability</p></div><button className="dots-button" aria-label="More options">···</button></div>
              <div className="health-score"><div className="health-ring"><ShieldCheck size={25} /><span>DEMO</span></div><div><strong>Sample service health</strong><small><span className="live-dot" />Availability monitoring is not implemented</small></div></div>
              <div className="service-list">
                <div className="service-row"><span className="service-name"><span className="service-dot green" />Checkout API</span><strong>99.98%</strong><span className="service-latency">142 ms</span></div>
                <div className="service-row"><span className="service-name"><span className="service-dot green" />Dashboard Web</span><strong>99.95%</strong><span className="service-latency">86 ms</span></div>
                <div className="service-row"><span className="service-name"><span className="service-dot amber" />Users API</span><strong>98.72%</strong><span className="service-latency">324 ms</span></div>
              </div>
              <a className="text-link" href="#services">View service details <span>→</span></a>
            </article>
          </div>

          <section className="panel issues-panel" id="issues">
            <div className="panel-heading issues-heading"><div><h2>Recent issues <span className="issue-count">{dashboard.connected ? dashboard.issues.length : 12}</span></h2><p>Errors that need your attention</p></div><div className="issue-actions"><button className="select-button"><Filter size={14} /> All environments <ChevronDown size={13} /></button><button className="select-button"><SlidersHorizontal size={14} /> Filter</button><button className="text-button">View all issues <span>→</span></button></div></div>
            <div className="table-scroll"><table><thead><tr><th>ISSUE</th><th>PROJECT</th><th>EVENTS</th><th>LAST SEEN</th><th>STATUS</th><th /></tr></thead><tbody>{issues.map((issue) => <tr key={issue.name}><td><div className="issue-title"><span className={issue.type === "error" ? "issue-symbol error-symbol" : "issue-symbol warning-symbol"}>{issue.type === "error" ? <AlertTriangle size={14} /> : <Zap size={14} />}</span><div><strong>{issue.name}</strong><small>{issue.code}</small></div></div></td><td><span className="table-project"><span className="project-dot blue" />{issue.service}<small>{issue.env}</small></span></td><td><strong className="event-count">{issue.count}</strong></td><td className="muted-cell">{issue.time}</td><td><span className={issue.status === "Resolved" ? "status-pill resolved" : issue.status === "Ignored" ? "status-pill ignored" : "status-pill unresolved"}><span />{issue.status}</span></td><td><button className="row-more" aria-label={`More options for ${issue.name}`}>···</button></td></tr>)}</tbody></table></div>
            <div className="table-footer"><span>Showing <strong>{issues.length}</strong> of <strong>{dashboard.connected ? dashboard.issueGroupCount : 12}</strong> issues</span><button className="text-link">Explore all issues <span>→</span></button></div>
          </section>

          <footer className="page-footer"><span>© 2026 Debugany</span><span><span className="footer-status" /> {dashboard.connected ? "API connected" : "Preview mode"}</span><a href="https://github.com/siavash-debug/DebugAny" target="_blank" rel="noreferrer">Open-source project <ExternalLink size={12} /></a></footer>
        </div>
      </section>
    </main>
  );
}

function MoreDots() {
  return <button className="profile-more" aria-label="Profile menu">···</button>;
}