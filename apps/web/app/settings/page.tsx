import Link from "next/link";
import { AlertTriangle, Activity , LogOut } from "lucide-react";
import { getProject, listKeys } from "../../lib/api";
import { requireWorkspace } from "../../lib/workspace";
import { logoutAction } from "../../actions/auth";
import { KeyManager } from "./key-manager";
import { RenameForm, DangerZone } from "./settings-forms";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const workspace = await requireWorkspace();
  const project = workspace.active;
  const projectId = project?.id;

  const [projectResult, keysResult] = projectId
    ? await Promise.all([getProject(projectId), listKeys(projectId)])
    : [undefined, undefined];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark"><span className="brand-symbol"><Activity size={19} strokeWidth={2.5} /></span><span>debug<span>any</span></span></div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="nav-list">
          <Link className="nav-item" href="/">Overview</Link>
          <Link className="nav-item" href="/issues">Issues</Link>
          <span className="nav-item active">Settings</span>
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-row">
            <div className="profile-avatar">{(workspace.user.name || "U").slice(0, 2).toUpperCase()}</div>
            <div className="profile-copy"><strong>{workspace.user.name || "Signed in"}</strong><small>{workspace.user.email}</small></div>
            <form action={logoutAction}><button className="profile-more" type="submit" aria-label="Sign out"><LogOut size={14} /></button></form>
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><Link href="/">Workspace</Link><span className="crumb-slash">/</span><strong>Settings</strong></div>
        </header>

        <div className="content-wrap">
          <div className="page-heading"><div><h1>Project settings</h1><p>{project ? `${project.name} · role: ${project.role.toLowerCase()}` : "Select a project first."}</p></div></div>

          {!projectId && (
            <div className="empty-state panel"><AlertTriangle size={22} /><strong>No project selected</strong><span>Create or select a project from the sidebar.</span></div>
          )}

          {projectId && keysResult && !keysResult.ok && (
            <div className="demo-banner"><div><strong>API unavailable</strong><span>{keysResult.state.message}</span></div></div>
          )}

          {projectId && projectResult?.ok && keysResult?.ok && (
            <>
              <RenameForm projectId={projectId} currentName={projectResult.data.name} canRename={projectResult.data.role === "OWNER"} />

              <KeyManager projectId={projectId} keys={keysResult.data} canRotate={projectResult.data.role === "OWNER"} />

              <section className="panel">
                <div className="panel-heading issues-heading"><div><h2>Connect the SDK</h2><p>Send events with an ingestion key from the table above.</p></div></div>
                <pre className="stack-trace">{`import { Debugany } from "@debugany/sdk";

const debugany = new Debugany({
  key: process.env.DEBUGANY_INGESTION_KEY!,
  endpoint: "${process.env.DEBUGANY_API_URL ?? "http://localhost:4000"}",
  environment: "production",
  release: "1.0.0"
});

try {
  riskyOperation();
} catch (error) {
  debugany.captureException(error);
}`}</pre>
              </section>

              {projectResult.data.role === "OWNER" && <DangerZone projectId={projectId} projectName={projectResult.data.name} />}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
