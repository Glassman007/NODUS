import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  FolderKanban,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Network,
  PanelRightClose,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type {
  AuthorizationContext,
  ProjectScope,
  WorkspaceRequest,
} from "../auth/models";
import "./Workspace.css";
import { WorkspaceData } from "./WorkspaceData";

import {
  allowedViews,
  views,
  storedSidebarPreference,
  type View,
} from "../workspace/navigation";
import { sourceLabel, type SourceMetadata } from "../workspace/sourceNames";
import { SourceLabel } from "./SourceLabel";
import { SourceCatalog } from "../workspace/sourceCatalog";
import { WorkspaceSidebar, type NavigationCounts } from "./WorkspaceSidebar";
import { SessionActivity, SessionVerification } from "./SessionViews";
import { SourceExplorer } from "./SourceExplorer";
import {TaskNotificationBanner} from "./TaskNotificationBanner";
const TaskWorkspace=lazy(()=>import("./TaskWorkspace").then(module=>({default:module.TaskWorkspace})));
interface Props {
  context: AuthorizationContext;
  scope: ProjectScope | null;
  pending: boolean;
  projectError: string;
  onSelectProject: (id: string) => void;
  onChangeToken: () => void;
  request: WorkspaceRequest;
}
interface Item {
  id?: string;
  name?: string;
  [key: string]: unknown;
}
export type Run = SessionRun;
import { parseInvestigationResult, submitInvestigation, type SessionRun } from "../investigations/api";
import { reportTitle, type ReportTab } from "../investigations/report";
import {
  InvestigationResultView,
  type ReportActions,
} from "./InvestigationResultView";

type Source = SourceMetadata;
const examples = [
  "What systems could be affected if the authentication API changes?",
  "Which services depend on the customer database?",
  "What decisions and evidence support this migration plan?",
];
function Empty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <Boxes size={26} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Data({ value }: { value: unknown }) {
  return <WorkspaceData value={value} />;
}
function initialView(): View {
  const value = location.hash.slice(1);
  return views.some((v) => v.id === value) ? (value as View) : "overview";
}

export function AuthorizedWorkspace(props: Props) {
  const [view, setView] = useState<View>(initialView);
  const [collapsed, setCollapsed] = useState(storedSidebarPreference);
  const [counts, setCounts] = useState<NavigationCounts>();
  const [contextOpen, setContextOpen] = useState(
    () => window.innerWidth >= 1440,
  );
  const [mobileNav, setMobileNav] = useState(false);
  const [account, setAccount] = useState(false);
  useEffect(() => {
    const handler = () => setView(initialView());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  const navigate = (next: View) => {
    setView(next);
    location.hash = next;
    setMobileNav(false);
  };
  const availableViews = allowedViews(props.context);
  const activeView = availableViews.some((item) => item.id === view)
    ? view
    : "overview";
  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    setMobileNav(false);
    try {
      localStorage.setItem("nodus.sidebar.collapsed", String(next));
    } catch {
      /* Preference storage may be disabled. */
    }
  };
  const project = props.context.projects.find(
    (p) => p.id === props.scope?.projectId,
  );
  return (
    <section
      className={`workspace-app ${collapsed ? "nav-collapsed" : ""} ${contextOpen ? "context-open" : ""}`}
      aria-label="Authorized workspace"
    >
      <header className="topbar">
        <button
          className="icon-button mobile-menu"
          aria-label="Open navigation"
          onClick={() => setMobileNav(!mobileNav)}
        >
          <Menu size={20} />
        </button>
        <a
          href="#overview"
          className="wordmark"
          onClick={() => navigate("overview")}
        >
          <Network size={23} />
          <strong>
            NODUS<span> / </span>
          </strong>
        </a>
        <span className="organization">{props.context.company.name}</span>
        <ChevronRight size={14} className="top-separator" />
        {props.context.projects.length > 1 ? (
          <select
            aria-label="Switch project"
            value={project?.id ?? ""}
            onChange={(e) => props.onSelectProject(e.target.value)}
          >
            <option value="" disabled>
              Choose an authorized project
            </option>
            {props.context.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="single-project">
            {project?.id ?? "No active project"}
          </span>
        )}
        <button className="global-search" onClick={() => navigate("knowledge")}>
          <Search size={15} />
          Search knowledge<span>↗</span>
        </button>
        <span className="role-badge" aria-label="Authenticated role">
          {props.context.role}
        </span>
        <div className="account-wrap">
          <button
            className="account-button"
            aria-label="Account menu"
            aria-expanded={account}
            onClick={() => setAccount(!account)}
          >
            <span className="avatar">
              {props.context.identity.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </span>
            <span className="account-name">{props.context.identity.name}</span>
          </button>
          {account && (
            <div className="account-menu">
              <strong>{props.context.identity.name}</strong>
              <small>{props.context.role}</small>
              <button onClick={props.onChangeToken}>
                Change token / sign out
              </button>
            </div>
          )}
        </div>
        <button
          className="icon-button"
          aria-label="Toggle context panel"
          aria-expanded={contextOpen}
          onClick={() => setContextOpen(!contextOpen)}
        >
          <PanelRightClose size={19} />
        </button>
      </header>
      <WorkspaceSidebar
        context={props.context}
        project={project}
        collapsed={collapsed}
        mobile={mobileNav}
        view={activeView}
        counts={
          counts?.generation === props.scope?.generation && !props.pending
            ? counts
            : undefined
        }
        navigate={navigate}
        toggle={toggleSidebar}
        changeToken={props.onChangeToken}
      />
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      {props.scope && !props.pending && project ? (
        <ProjectWorkspace
          key={`${props.context.identity.id}:${props.scope.generation}`}
          {...props}
          scope={props.scope}
          project={project}
          view={activeView}
          reportCounts={setCounts}
          navigate={navigate}
          contextOpen={contextOpen}
          closeContext={() => setContextOpen(false)}
        />
      ) : (
        <div className="workspace-content">
          <p className="breadcrumb">Workspace / Authorization</p>
          {props.pending ? (
            <div className="loading-state" role="status">
              <LoaderCircle className="spin" />
              Checking current project permissions…
            </div>
          ) : props.projectError ? (
            <div role="alert" className="notice error">
              {props.projectError}
              {props.context.projects.length === 1 && (
                <button
                  onClick={() =>
                    props.onSelectProject(props.context.projects[0].id)
                  }
                >
                  Use authorized project
                </button>
              )}
            </div>
          ) : (
            <Empty title="No authorized projects">
              Your current authorization does not include a project. Change
              token or check with your administrator.
            </Empty>
          )}
        </div>
      )}
    </section>
  );
}

function ProjectWorkspace({
  context,
  scope,
  onSelectProject: propsSelectProject,
  request,
  project,
  view,
  navigate,
  contextOpen,
  closeContext,
  reportCounts,
}: Props & {
  scope: ProjectScope;
  project: { id: string; name: string };
  view: View;
  navigate: (view: View) => void;
  contextOpen: boolean;
  closeContext: () => void;
  reportCounts: (counts: NavigationCounts) => void;
}) {
  const [workspaces, setWorkspaces] = useState<Item[]>([]);
  const [workspace, setWorkspace] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [reportTab, setReportTab] = useState<ReportTab>("overview");
  const reportActions = useRef<ReportActions>(null);
  const [objective, setObjective] = useState("");
  const [entityHint, setEntityHint] = useState("");
  const [executing, setExecuting] = useState(false);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [entities, setEntities] = useState<Item[] | null>(null);
  const [detail, setDetail] = useState<unknown>(null);
  const [entity, setEntity] = useState<Item | null>(null);
  const [searching, setSearching] = useState(false);
  const [requests, setRequests] = useState<Item[]>([]);
  const [accessLoaded, setAccessLoaded] = useState(false);
  const [accessLoading, setAccessLoading] = useState(false);
  const [resource, setResource] = useState("");
  const [justification, setJustification] = useState("");
  const [message, setMessage] = useState("");
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [selectedTaskId,setSelectedTaskId] = useState<string|null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  const graphSequence = useRef(0);
  const [deciding, setDeciding] = useState(false);
  const can = (permission: string) =>
    context.permissions.includes(permission) ||
    context.permissions.includes("ADMIN");
  const review =
    context.capabilities.reviewAccessRequests &&
    context.permissions.includes("ADMIN");
  const graphPath = `workspaces/${encodeURIComponent(workspace)}`;
  const openTask=(id:string)=>{setSelectedTaskId(id);navigate("tasks");};
  const openTaskInvestigation=(id:string)=>{
    void perform(async()=>{
      const raw=await request<Record<string,unknown>>(`${graphPath}/investigations/${encodeURIComponent(id)}`,scope.signal);
      const result=parseInvestigationResult(raw);
      return {...result,objective:typeof raw.objective==="string"?raw.objective:"Source investigation",
        created:typeof raw.created_at==="string"?raw.created_at:new Date().toISOString(),
        workspaceId:workspace,projectId:project.id,entityId:result.starting_entity_id??undefined,selectedSourceIds:result.selected_source_ids??[]} as Run;
    },run=>{setSelectedRun(run);setReportTab("overview");navigate("investigations");});
  };
  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    setError("");
    const controller = new AbortController();
    const abort = () => controller.abort();
    scope.signal.addEventListener("abort", abort);
    const tasks = [
      can("READ_GRAPH")
        ? request<{ items: Item[] }>("workspaces", controller.signal).then(
            (data) => {
              if (!controller.signal.aborted) {
                setWorkspaces(data.items);
                setWorkspace(String(data.items[0]?.id ?? ""));
              }
            },
          )
        : Promise.resolve(),
      request<{ items: Source[] }>("nexus/sources", controller.signal).then(
        (data) => {
          if (!controller.signal.aborted) {
            setSources(
              data.items.filter(
                (s) =>
                  (!s.owner_project_id || s.owner_project_id === project.id) &&
                  (!context.sourceIds ||
                    context.sourceIds.includes(s.source_id)),
              ),
            );
            setSourcesLoaded(true);
          }
        },
      ),
    ];
    Promise.allSettled(tasks).then((results) => {
      if (!controller.signal.aborted) {
        const failed = results.some((r) => r.status === "rejected");
        if (failed)
          setError(
            "Some workspace data could not be loaded. Check service availability or retry.",
          );
        setLoading(false);
      }
    });
    return () => {
      mounted.current = false;
      controller.abort();
      scope.signal.removeEventListener("abort", abort);
    };
    // Each instance owns one immutable, server-validated project scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry]);
  useEffect(() => {
    reportCounts({
      generation: scope.generation,
      runs: runs.length,
      pendingRequests: accessLoaded
        ? requests.filter((r) => r.status === "PENDING").length
        : undefined,
    });
  }, [scope.generation, runs.length, requests, accessLoaded, reportCounts]);
  useEffect(() => {
    graphSequence.current++;
    setEntities(null);
    setEntity(null);
    setDetail(null);
    setSearching(false);
  }, [view]);
  async function perform<T>(task: () => Promise<T>, done: (value: T) => void) {
    setError("");
    try {
      const value = await task();
      if (mounted.current && !scope.signal.aborted) done(value);
    } catch (reason) {
      if (mounted.current && !scope.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Request failed. Please retry.",
        );
    }
  }
  function start() {
    navigate("overview");
    setSelectedRun(null);
    window.setTimeout(() => input.current?.focus(), 0);
  }
  async function investigate() {
    if (
      submitting.current ||
      scope.signal.aborted ||
      !can("EXECUTE_TOOL") ||
      !workspaces.some((item) => item.id === workspace) ||
      !objective.trim() ||
      !selectedSources.length ||
      selectedSources.some(
        (id) => !sources.some((source) => source.source_id === id),
      )
    )
      return;
    const captured = {
      project_id: project.id,
      objective: objective.trim(),
      selected_source_ids: [...selectedSources],
      ...(entityHint.trim() ? { entity_id: entityHint.trim() } : {}),
    };
    submitting.current = true;
    setExecuting(true);
    await perform(
      () => submitInvestigation(request, workspace, captured, scope.signal),
      (result) => {
        const run: Run = {
          ...result,
          objective: captured.objective,
          created: new Date().toISOString(),
          workspaceId: workspace,
          projectId: project.id,
          selectedSourceIds: captured.selected_source_ids,
          entityId: result.starting_entity_id??captured.entity_id,
        };
        setRuns((old) => [run, ...old]);
        setSelectedRun(run);
        setReportTab("overview");
        navigate("investigations");
      },
    );
    submitting.current = false;
    if (mounted.current) setExecuting(false);
  }
  async function loadSavedInvestigations() {
    await perform(async () => {
      const base = `workspaces/${encodeURIComponent(workspace)}/investigations`;
      const listing = await request<{items: {run_id: string; objective: string; created_at: string; project_id: string | null}[]}>(base, scope.signal);
      return Promise.all(listing.items.filter((item) => item.project_id === project.id).map(async (item) => {
        const result = parseInvestigationResult(await request<unknown>(`${base}/${encodeURIComponent(item.run_id)}`, scope.signal));
        return {...result, objective: item.objective, created: item.created_at, workspaceId: workspace,
          projectId: project.id, entityId: result.starting_entity_id??undefined, selectedSourceIds: result.selected_source_ids ?? []} as Run;
      }));
    }, (saved) => setRuns((old) => [...saved, ...old.filter((run) => !saved.some((item) => item.run_id === run.run_id))]));
  }
  async function loadAccess() {
    if (accessLoading) return;
    setAccessLoading(true);
    await perform(
      () =>
        request<{ items: Item[] }>(
          `nexus/access-requests/${review ? "pending" : "mine"}`,
          scope.signal,
        ),
      (data) => {
        setRequests(data.items);
        setAccessLoaded(true);
      },
    );
    if (mounted.current) setAccessLoading(false);
  }
  async function search() {
    if (!query.trim() || !workspace || searching) return;
    setSearching(true);
    setEntity(null);
    setDetail(null);
    setEntities(null);
    const sequence = ++graphSequence.current;
    await perform(
      () =>
        request<{ items: Item[] }>(
          `${graphPath}/search?q=${encodeURIComponent(query.trim())}`,
          scope.signal,
        ),
      (data) => {
        if (sequence === graphSequence.current) setEntities(data.items);
      },
    );
    if (mounted.current && sequence === graphSequence.current)
      setSearching(false);
  }
  function inspect(item: Item, endpoint: string) {
    const sequence = ++graphSequence.current;
    setEntity(item);
    setDetail(null);
    void perform(
      () =>
        request<unknown>(
          `${graphPath}/entities/${encodeURIComponent(String(item.id))}/${endpoint}`,
          scope.signal,
        ),
      (value) => {
        if (sequence === graphSequence.current) setDetail(value);
      },
    );
  }
  async function decide(requestId: string, action: "approve" | "deny") {
    if (deciding || !review) return;
    setDeciding(true);
    await perform(
      () =>
        request(
          `nexus/access-requests/${encodeURIComponent(requestId)}/${action}`,
          scope.signal,
          {},
        ),
      () => {
        setMessage(
          action === "approve" ? "Request approved." : "Request denied.",
        );
        void loadAccess();
      },
    );
    if (mounted.current) setDeciding(false);
  }
  const title = views.find((v) => v.id === view)!.label;
  const visibleRuns = runs.filter((r) =>
    `${r.objective} ${r.status}`.toLowerCase().includes(filter.toLowerCase()),
  );
  function RunTable({ limit }: { limit?: number }) {
    return runs.length ? (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>OBJECTIVE</th>
              <th>STATUS</th>
              <th>CREATED</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visibleRuns.slice(0, limit).map((run) => (
              <tr key={run.run_id}>
                <td>
                  <button
                    className="row-link"
                    onClick={() => {
                      setSelectedRun(run);
                      setReportTab("overview");
                      navigate("investigations");
                    }}
                  >
                    {reportTitle(run)}
                  </button>
                  <small>{project.id}</small>
                </td>
                <td>
                  <span className={`run-status ${run.status.toLowerCase()}`}>
                    {run.status}
                  </span>
                </td>
                <td className="timestamp">
                  {new Date(run.created).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Open ${reportTitle(run)}`}
                    onClick={() => {
                      setSelectedRun(run);
                      setReportTab("overview");
                      navigate("investigations");
                    }}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visibleRuns.length && (
          <p className="inline-note">No investigations match your filter.</p>
        )}
      </div>
    ) : (
      <Empty title="Your next discovery starts here">
        No investigations have been run in this project session. Start with a
        question about your engineering environment.
      </Empty>
    );
  }
  const scopeCard = (
    <>
      <div className="context-section">
        <p className="section-kicker">ACTIVE CONTEXT</p>
        <div className="context-project">
          <FolderKanban size={20} />
          <div>
            <strong>{project.id}</strong>
            <small>Authorized project</small>
          </div>
          <span className="status-dot" />
        </div>
        <dl>
          <dt>Role</dt>
          <dd>{context.role}</dd>
          <dt>Access model</dt>
          <dd>Permission scoped</dd>
          <dt>Knowledge workspace</dt>
          <dd>{workspace || "Unavailable"}</dd>
          <dt>Source selection</dt>
          <dd>{selectedSources.length} selected</dd>
        </dl>
      </div>
    </>
  );
  return (
    <SourceCatalog.Provider value={sources}>
      <div className="workspace-content">
        <div className="breadcrumb">
          Workspace <ChevronRight size={12} />
          {title}
          <span className="secure-label">
            <LockKeyhole size={12} />
            Permission-aware workspace
          </span>
        </div>
        {!(view === "investigations" && selectedRun) && (
          <div className="page-heading">
            <div>
              <p className="section-kicker">ENGINEERING INTELLIGENCE</p>
              <h1>{view === "overview" ? "Workspace Overview" : title}</h1>
              <p>
                {view === "overview"
                  ? `Welcome back, ${context.identity.name.split(" ")[0]}. Follow the evidence. Understand the connections.`
                  : views.find((item) => item.id === view)?.description}
              </p>
            </div>
            <button className="primary" onClick={start}>
              <Plus size={16} />
              New Investigation
            </button>
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button
              className="quiet-button"
              onClick={() => setRetry((old) => old + 1)}
            >
              Retry data
            </button>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {workspace&&can("READ_GRAPH")&&<TaskNotificationBanner workspaceId={workspace} scope={scope} request={request} openTask={openTask}/>}
        {message && (
          <div
            className="notice"
            role="status"
            aria-label="Workspace notification"
          >
            {message}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setMessage("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {executing && (
          <div className="notice investigation-progress" role="status">
            <LoaderCircle className="spin" size={17} />
            <span>
              Investigation in progress. The backend is processing your
              objective. Navigating away or changing identity does not guarantee
              backend cancellation.
            </span>
          </div>
        )}
        {loading && (
          <div className="loading-state" role="status">
            <LoaderCircle className="spin" size={17} />
            Loading authorized workspace data…
          </div>
        )}
        {view === "overview" && (
          <>
            <div className="metrics">
              {(
                [
                  [
                    "Investigations",
                    runs.length,
                    "Run in this project session",
                    Search,
                    "investigations",
                  ],
                  [
                    "Need attention",
                    runs.filter((r) => r.status !== "COMPLETE").length,
                    "Partial, incomplete or blocked",
                    Activity,
                    "investigations",
                  ],
                  [
                    "Available sources",
                    sourcesLoaded ? sources.length : "Unavailable",
                    "Returned for this project scope",
                    FileCheck2,
                    "knowledge",
                  ],
                  [
                    "Granted permissions",
                    context.permissions.length,
                    "From your authenticated session",
                    ShieldCheck,
                    "access",
                  ],
                ] as const
              ).map(([label, value, note, Icon, next]) => (
                <button
                  className="metric"
                  key={label}
                  onClick={() => navigate(next)}
                >
                  <span>
                    {label}
                    <Icon size={16} />
                  </span>
                  <strong
                    className={
                      typeof value === "string"
                        ? "metric-unavailable"
                        : undefined
                    }
                  >
                    {value}
                  </strong>
                  <small>
                    {note}
                    <ArrowUpRight size={12} />
                  </small>
                </button>
              ))}
            </div>
            <section className="panel command-center">
              <div className="panel-heading">
                <div className="heading-icon">
                  <Sparkles size={18} />
                  <h2>Start a New Investigation</h2>
                </div>
                <span className="subtle-badge">OBJECTIVE DRIVEN</span>
              </div>
              <p className="panel-description">
                Ask a focused question. Investigate relationships across your
                authorized sources.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void investigate();
                }}
              >
                <label className="sr-only" htmlFor="objective">
                  What would you like to investigate?
                </label>
                <textarea
                  ref={input}
                  id="objective"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  placeholder="What would you like to understand about your project?"
                  rows={3}
                  maxLength={4000}
                  disabled={executing}
                />
                <div className="command-context">
                  <span>
                    <FolderKanban size={14} />
                    {project.id}
                  </span>
                  {workspaces.length > 1 ? (
                    <select
                      aria-label="Graph workspace"
                      value={workspace}
                      disabled={executing}
                      onChange={(e) => {
                        setWorkspace(e.target.value);
                        setRuns([]);
                        setSelectedRun(null);
                        setEntities(null);
                        setDetail(null);
                        setEntity(null);
                      }}
                    >
                      {workspaces.map((w) => (
                        <option key={String(w.id)} value={String(w.id)}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>Workspace: {workspace || "unavailable"}</span>
                  )}
                </div>
                <label className="entity-hint">
                  Entity identifier (optional)
                  <input
                    aria-label="Entity identifier (optional)"
                    value={entityHint}
                    maxLength={500}
                    disabled={executing}
                    onChange={(event) => setEntityHint(event.target.value)}
                    placeholder="Select a specific entity, or leave blank"
                  />
                </label>
                <fieldset className="source-selection" disabled={executing}>
                  <legend>Investigation sources · select explicitly</legend>
                  {sources.map((s) => (
                    <label
                      key={s.source_id}
                      className={
                        selectedSources.includes(s.source_id)
                          ? "source-option selected"
                          : "source-option"
                      }
                      title={s.source_id}
                    >
                      <input
                        type="checkbox"
                        value={s.source_id}
                        aria-label={sourceLabel(s.source_id, sources)}
                        checked={selectedSources.includes(s.source_id)}
                        onChange={(e) =>
                          setSelectedSources((old) =>
                            e.target.checked
                              ? [...old, s.source_id]
                              : old.filter((id) => id !== s.source_id),
                          )
                        }
                      />
                      <span>
                        <SourceLabel id={s.source_id} />
                        {typeof s.description === "string" &&
                          s.description.trim() && (
                            <small>{s.description}</small>
                          )}
                      </span>
                    </label>
                  ))}
                  {!sources.length && (
                    <small>
                      No selectable sources returned. Source access is required
                      to execute an investigation.
                    </small>
                  )}
                </fieldset>
                <div className="command-footer">
                  <span>
                    <ShieldCheck size={13} />
                    Only selected, authorized sources are used
                  </span>
                  <button
                    className="primary"
                    disabled={
                      executing ||
                      !can("EXECUTE_TOOL") ||
                      !workspace ||
                      !objective.trim() ||
                      !selectedSources.length
                    }
                  >
                    {executing ? (
                      <>
                        <LoaderCircle className="spin" size={16} />
                        Investigating…
                      </>
                    ) : (
                      <>
                        Start investigation
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </div>
                {!can("EXECUTE_TOOL") && (
                  <p className="inline-note">
                    Your session does not grant EXECUTE_TOOL. Authorized
                    read-only views remain available.{" "}
                    {context.capabilities.requestAccess && (
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() => navigate("access-requests")}
                      >
                        View access requests
                      </button>
                    )}
                  </p>
                )}
              </form>
              <div className="examples">
                <span>TRY AN OBJECTIVE</span>
                {examples.map((example, i) => (
                  <button
                    key={example}
                    disabled={executing}
                    onClick={() => {
                      setObjective(example);
                      input.current?.focus();
                    }}
                  >
                    <span>0{i + 1}</span>
                    {example}
                    <ArrowUpRight size={14} />
                  </button>
                ))}
              </div>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  Recent investigations{" "}
                  <span className="count-pill">{runs.length}</span>
                </h2>
                <button
                  className="quiet-button"
                  onClick={() => navigate("investigations")}
                >
                  View all
                  <ArrowRight size={14} />
                </button>
              </div>
              <RunTable limit={4} />
              <div className="panel-footnote">
                Saved investigations can be reopened from the investigations view.
              </div>
            </section>
            <div className="overview-bottom">
              <section className="panel project-summary">
                <p className="section-kicker">PROJECT INTELLIGENCE</p>
                <div className="heading-icon">
                  <FolderKanban size={21} />
                  <h2>{project.name}</h2>
                </div>
                <p>
                  Explore sources and relationships within your authorized
                  scope.
                </p>
                <button
                  className="quiet-button"
                  onClick={() => navigate("projects")}
                >
                  View project context
                  <ArrowRight size={14} />
                </button>
              </section>
              <section className="panel">
                <p className="section-kicker">ACTIONS & FOLLOW-UP</p>
                {runs.some((r) => r.status !== "COMPLETE") ? (
                  runs
                    .filter((r) => r.status !== "COMPLETE")
                    .map((r) => (
                      <button
                        className="action-row"
                        key={r.run_id}
                        onClick={() => {
                          setSelectedRun(r);
                          navigate("investigations");
                        }}
                      >
                        <CircleHelp size={16} />
                        <span>
                          {r.objective}
                          <small>{r.status} · Review limitations</small>
                        </span>
                        <ArrowRight size={15} />
                      </button>
                    ))
                ) : (
                  <div className="nothing-pending">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>No run follow-ups in this session</strong>
                      <p>
                        Coverage limitations will appear with investigation
                        results.
                      </p>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
        {(view === "tasks" || view === "notifications") && workspace && <Suspense fallback={<p className="loading-state">Loading tasks?</p>}><TaskWorkspace
          key={`${workspace}-${view}-${selectedTaskId??"list"}`} workspaceId={workspace} scope={scope} request={request}
          initialTaskId={view==="tasks"?selectedTaskId:null} notificationsOnly={view==="notifications"}
          openInvestigation={openTaskInvestigation}/></Suspense>}
        {view === "investigations" && (
          <>
            {selectedRun && (
              <button
                className="quiet-button report-back"
                onClick={() => setSelectedRun(null)}
              >
                Back to session investigations
              </button>
            )}
            {!selectedRun && (
              <section className="panel">
                <div className="panel-heading">
                  <h2>Project session investigations</h2>
                  <button className="quiet-button" onClick={() => void loadSavedInvestigations()}>Load saved investigations</button>
                  <div className="filter">
                    <ListFilter size={14} />
                    <input
                      aria-label="Filter investigations"
                      placeholder="Filter objective or status…"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                  </div>
                </div>
                <RunTable />
                <div className="panel-footnote">
                  Saved reports are checked against your current access before reopening. Session-only results are cleared on refresh.
                </div>
              </section>
            )}
            {selectedRun && (
              <InvestigationResultView
                openTask={openTask}
                key={selectedRun.run_id}
                run={selectedRun}
                scope={scope}
                request={request}
                canReadEvidence={can("READ_EVIDENCE")}
                canReadGraph={can("READ_GRAPH")}
                tab={reportTab}
                setTab={setReportTab}
                actions={reportActions}
                authorizedSourceIds={sources.map((source) => source.source_id)}
                overview={start}
              />
            )}
          </>
        )}
        {view === "activity" && (
          <SessionActivity
            runs={runs}
            projectId={project.id}
            openRun={(run) => {
              setSelectedRun(run);
              setReportTab("overview");
              navigate("investigations");
            }}
          />
        )}
        {view === "verification" && (
          <SessionVerification
            runs={runs}
            openRun={(run) => {
              setSelectedRun(run);
              setReportTab("overview");
              navigate("investigations");
            }}
          />
        )}
        {view === "projects" && (
          <section className="panel">
            <div className="panel-heading">
              <h2>Authorized projects</h2>
              <span className="subtle-badge">SERVER RETURNED</span>
            </div>
            {context.projects.map((p) => (
              <div className="project-list-item" key={p.id}>
                <FolderKanban size={21} />
                <div>
                  <h3>{p.name}</h3>
                  <small>{p.id}</small>
                </div>
                {p.id === project.id ? (
                  <button
                    className="quiet-button"
                    onClick={() => navigate("knowledge")}
                  >
                    Explore project
                  </button>
                ) : (
                  <button
                    className="quiet-button"
                    onClick={() => propsSelectProject(p.id)}
                  >
                    Open project
                  </button>
                )}
              </div>
            ))}
            <div className="panel-body">
              <h3>Sources available to the active project</h3>
              {sources.length ? (
                sources.map((s) => (
                  <div className="metadata-row" key={s.source_id}>
                    <FileCheck2 size={16} />
                    <SourceLabel id={s.source_id} />
                    <small>{s.classification ?? "Authorized source"}</small>
                  </div>
                ))
              ) : (
                <p className="inline-note">
                  No source metadata returned for this project.
                </p>
              )}
              <p className="inline-note">
                Project descriptions and service inventories are not exposed.
                Use Knowledge & Evidence to query authorized graph entities.
              </p>
              <button
                className="quiet-button"
                onClick={() => navigate("knowledge")}
              >
                Explore knowledge
                <ArrowRight size={14} />
              </button>
            </div>
          </section>
        )}
        {view === "knowledge" && (
          <SourceExplorer
            sources={sources}
            loaded={sourcesLoaded}
            selected={selectedSource}
            select={setSelectedSource}
          />
        )}
        {["knowledge", "dependencies", "decisions"].includes(view) && (
          <section className="panel">
            <div className="panel-heading">
              <h2>
                {view === "decisions"
                  ? "Decision search"
                  : view === "dependencies"
                    ? "Knowledge & dependency explorer"
                    : "Knowledge & evidence explorer"}
              </h2>
              <Network size={18} />
            </div>
            {can("READ_GRAPH") ? (
              <>
                <form
                  className="explorer-search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void search();
                  }}
                >
                  <Search size={18} />
                  <input
                    aria-label="Search graph entities"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search accessible services, people, decisions…"
                    maxLength={200}
                  />
                  <button
                    className="primary"
                    disabled={!workspace || !query.trim() || searching}
                  >
                    {searching ? "Searching…" : "Search"}
                  </button>
                </form>
                <div className="panel-body">
                  <p className="inline-note">
                    Search runs against workspace {workspace || "unavailable"}{" "}
                    using server-enforced authorization. Graph results may span
                    your authorized projects in this workspace.
                  </p>
                  {view === "decisions" && (
                    <p className="inline-note">
                      Decision results are filtered from the first 25 authorized
                      search matches by the returned DECISION type. A text query
                      is required; this is not a full decision inventory.
                    </p>
                  )}
                </div>
                {entities === null ? (
                  <Empty title="Trace a connection">
                    Search an entity to inspect its evidence, assertions, and
                    dependencies.
                  </Empty>
                ) : !entities.filter(
                    (item) => view !== "decisions" || item.type === "DECISION",
                  ).length ? (
                  <Empty title="No accessible results">
                    Try a different name or check your authorization scope.
                  </Empty>
                ) : (
                  entities
                    .filter(
                      (item) =>
                        view !== "decisions" || item.type === "DECISION",
                    )
                    .map((item, index) => (
                      <div
                        className="entity-row"
                        key={String(item.id ?? index)}
                      >
                        <Network size={18} />
                        <div>
                          <strong>{String(item.name ?? item.id)}</strong>
                          <small>{String(item.id ?? "")}</small>
                        </div>
                        <button
                          className="quiet-button"
                          onClick={() => inspect(item, "neighborhood")}
                        >
                          Connections
                        </button>
                        <button
                          className="quiet-button"
                          onClick={() => inspect(item, "reverse-dependencies")}
                        >
                          Dependencies
                        </button>
                        {can("READ_EVIDENCE") && (
                          <>
                            <button
                              className="quiet-button"
                              onClick={() => inspect(item, "evidence")}
                            >
                              Evidence
                            </button>
                            <button
                              className="quiet-button"
                              onClick={() => inspect(item, "assertions")}
                            >
                              Assertions
                            </button>
                          </>
                        )}
                      </div>
                    ))
                )}
                {entity && (
                  <div className="panel-body">
                    <h3>{String(entity.name ?? entity.id)}</h3>
                    {detail === null ? (
                      <p className="inline-note">
                        Selected entity · Loading details or awaiting a
                        successful response.
                      </p>
                    ) : (
                      <Data value={detail} />
                    )}
                  </div>
                )}
              </>
            ) : (
              <Empty title="Graph access is restricted">
                Your session does not grant READ_GRAPH. Check My Access for your
                current permissions.
              </Empty>
            )}
          </section>
        )}
        {["access", "access-requests"].includes(view) && (
          <>
            {view === "access" && (
              <section className="panel">
                <div className="panel-heading">
                  <h2>Current authorization</h2>
                  <ShieldCheck size={18} />
                </div>
                <div className="panel-body">
                  <p className="section-kicker">
                    {context.identity.name} · {context.role}
                  </p>
                  <dl className="authorization-summary">
                    <div>
                      <dt>Organization</dt>
                      <dd>{context.company.name}</dd>
                    </div>
                    <div>
                      <dt>Currently viewing</dt>
                      <dd>{project.name}</dd>
                    </div>
                    <div>
                      <dt>Projects you can access</dt>
                      <dd>
                        {context.projects.map((item) => (
                          <span className="project-chip" key={item.id}>
                            {item.name}
                          </span>
                        ))}
                      </dd>
                    </div>
                  </dl>
                  <h3>What you're allowed to do</h3>
                  <div className="permission-list">
                    {context.permissions.map((p) => (
                      <span key={p}>
                        <ShieldCheck size={12} />
                        {p}
                      </span>
                    ))}
                  </div>
                  <p className="inline-note">
                    Permissions come from the session. Every API request
                    independently checks server authorization. New grants
                    require session revalidation.
                  </p>
                </div>
              </section>
            )}
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  {review ? "Review access requests" : "My access requests"}
                </h2>
                <button
                  className="quiet-button"
                  disabled={accessLoading}
                  onClick={() => void loadAccess()}
                >
                  Refresh requests
                </button>
              </div>
              {accessLoading && (
                <p className="loading-state panel-body" role="status">
                  Loading authorized requests...
                </p>
              )}
              {!review && !context.capabilities.requestAccess && (
                <p className="inline-note panel-body">
                  Request submission is not available to this session. You can
                  retrieve your existing requests.
                </p>
              )}
              {!review && context.capabilities.requestAccess && (
                <form
                  className="access-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setBusy(true);
                    void perform(
                      () =>
                        request("nexus/access-requests", scope.signal, {
                          resource_id: resource.trim(),
                          justification: justification.trim(),
                          requested_project_id: project.id,
                          requested_actions: ["READ"],
                        }),
                      () => {
                        setMessage(
                          "Access request submitted. An administrator must review it.",
                        );
                        setResource("");
                        setJustification("");
                        void loadAccess();
                      },
                    ).finally(() => {
                      if (mounted.current) setBusy(false);
                    });
                  }}
                >
                  <label>
                    Resource identifier
                    <input
                      required
                      value={resource}
                      onChange={(e) => setResource(e.target.value)}
                      placeholder="Enter the resource ID supplied by your administrator"
                    />
                  </label>
                  <label>
                    Justification
                    <textarea
                      required
                      value={justification}
                      onChange={(e) => setJustification(e.target.value)}
                      rows={3}
                    />
                  </label>
                  <p className="inline-note">
                    Requests READ access for project {project.id}. The server
                    validates the resource and your eligibility.
                  </p>
                  <button className="primary" disabled={busy}>
                    Request additional access
                    <ArrowUpRight size={15} />
                  </button>
                </form>
              )}
              {!accessLoaded ? (
                <Empty title="Load your access requests">
                  Refresh requests to retrieve the current server state.
                </Empty>
              ) : requests.length === 0 ? (
                <Empty title="No requests returned">
                  There are no accessible requests in this view.
                </Empty>
              ) : (
                requests.map((r, i) => (
                  <div
                    className="access-request"
                    key={String(r.request_id ?? i)}
                  >
                    <strong>
                      <SourceLabel id={String(r.resource_id)} />
                    </strong>
                    <span className="subtle-badge">{String(r.status)}</span>
                    <p>{String(r.justification ?? "")}</p>
                    <details>
                      <summary>Requested scope & metadata</summary>
                      <Data value={r} />
                    </details>
                    {review && r.status === "PENDING" && (
                      <div className="button-row">
                        <button
                          className="quiet-button"
                          disabled={deciding}
                          onClick={() =>
                            void decide(String(r.request_id), "approve")
                          }
                        >
                          Approve requested scope
                        </button>
                        <button
                          className="quiet-button"
                          disabled={deciding}
                          onClick={() =>
                            void decide(String(r.request_id), "deny")
                          }
                        >
                          Deny
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </section>
          </>
        )}
        <footer className="workspace-footer">
          <span>
            <Network size={12} />
            NODUS / Relationship intelligence
          </span>
          <span>Evidence first. Access aware.</span>
        </footer>
      </div>
      <aside
        className={`right-context ${contextOpen ? "opened" : ""}`}
        aria-label="Contextual intelligence"
      >
        <div className="context-header">
          <span>
            <Activity size={16} />
            INTELLIGENCE PANEL
          </span>
          <button
            className="icon-button"
            aria-label="Close context panel"
            onClick={closeContext}
          >
            <X size={15} />
          </button>
        </div>
        {scopeCard}
        {view === "investigations" && selectedRun ? (
          <div className="context-section">
            <p className="section-kicker">SELECTED INVESTIGATION</p>
            <span className={`run-status ${selectedRun.status.toLowerCase()}`}>
              {selectedRun.status}
            </span>
            <p className="context-copy compact-report-title">
              {reportTitle(selectedRun)}
            </p>
            <details className="compact-objective">
              <summary>View original objective</summary>
              <p>{selectedRun.objective}</p>
            </details>
            <dl>
              <dt>Sources selected</dt>
              <dd>{selectedRun.selectedSourceIds.length}</dd>
              <dt>Entities observed</dt>
              <dd>{selectedRun.entity_ids.length}</dd>
              <dt>Relationships observed</dt>
              <dd>{selectedRun.relationship_ids.length}</dd>
              <dt>Evidence refs</dt>
              <dd>{selectedRun.evidence_refs?.length ?? 0}</dd>
              <dt>Verification</dt>
              <dd>
                {selectedRun.evidence_refs.length
                  ? "Not independently verified"
                  : "Unavailable"}
              </dd>
            </dl>
            <div className="context-report-actions">
              <button
                className="context-action"
                onClick={() => setReportTab("graph")}
              >
                Open graph
                <ArrowUpRight size={13} />
              </button>
              <button
                className="context-action"
                onClick={() => setReportTab("overview")}
              >
                Jump to findings
                <ArrowUpRight size={13} />
              </button>
              <button
                className="context-action"
                onClick={() => setReportTab("evidence")}
              >
                Review evidence
                <ArrowUpRight size={13} />
              </button>
              <button
                className="context-action"
                onClick={() => reportActions.current?.exportReport()}
              >
                Export report
                <ArrowUpRight size={13} />
              </button>
            </div>
          </div>
        ) : view === "knowledge" && entity ? (
          <div className="context-section">
            <p className="section-kicker">SELECTED ENTITY</p>
            <strong>{String(entity.name ?? entity.id)}</strong>
            <Data value={entity} />
            <p className="context-copy">
              Evidence and assertions are restricted by server authorization.
            </p>
          </div>
        ) : (
          <div className="context-section">
            <p className="section-kicker">RECENT SESSION ACTIVITY</p>
            {runs.length ? (
              runs.slice(0, 4).map((run) => (
                <button
                  className="activity-item"
                  key={run.run_id}
                  onClick={() => {
                    setSelectedRun(run);
                    setReportTab("overview");
                    navigate("investigations");
                  }}
                >
                  <span className="activity-marker" />
                  <span>
                    {reportTitle(run)}
                    <small>
                      {run.status} ·{" "}
                      {new Date(run.created).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <div className="activity-empty">
                <Activity size={22} />
                <p>No investigations yet</p>
                <small>
                  Your investigation activity appears here during this session.
                </small>
              </div>
            )}
          </div>
        )}
        <div className="context-section">
          <p className="section-kicker">QUICK ACTIONS</p>
          <button className="context-action" onClick={start}>
            <Plus size={15} />
            Create an investigation
            <ArrowUpRight size={13} />
          </button>
          <button
            className="context-action"
            onClick={() => navigate("investigations")}
          >
            <Search size={15} />
            View investigations
            <ArrowUpRight size={13} />
          </button>
          <button className="context-action" onClick={() => navigate("access")}>
            <ShieldCheck size={15} />
            View my access
            <ArrowUpRight size={13} />
          </button>
        </div>
        <div className="context-section">
          <p className="section-kicker">DATA AVAILABILITY</p>
          <div className="availability">
            <span className="status-dot" />
            Session authorized
          </div>
          <p className="context-copy">
            {loading
              ? "Retrieving workspace data…"
              : `${workspaces.length} graph workspace(s) returned. Project sources: ${sourcesLoaded ? sources.length : "unavailable"}.`}
          </p>
          <p className="context-copy">
            Connection health is not monitored by this workspace.
          </p>
        </div>
        <div className="context-tip">
          <LockKeyhole size={18} />
          <p>
            Your access defines your view.
            <br />
            <span>Counts reflect only data returned for your identity.</span>
          </p>
        </div>
      </aside>
    </SourceCatalog.Provider>
  );
}
