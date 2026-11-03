import { projectLabel } from "../workspace/projectNames";
﻿import {
  Fingerprint,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
} from "lucide-react";
import type { AuthorizationContext } from "../auth/models";
import { allowedViews, type View } from "../workspace/navigation";
export interface NavigationCounts {
  generation: number;
  runs: number;
  pendingRequests?: number;
}
interface Props {
  context: AuthorizationContext;
  project?: { id: string; name: string };
  collapsed: boolean;
  mobile: boolean;
  view: View;
  counts?: NavigationCounts;
  navigate: (view: View) => void;
  toggle: () => void;
  changeToken: () => void;
}
export function WorkspaceSidebar({
  context,
  project,
  collapsed,
  mobile,
  view,
  counts,
  navigate,
  toggle,
  changeToken,
}: Props) {
  const destinations = allowedViews(context);
  return (
    <nav
      className={`left-nav ${mobile ? "mobile-open" : ""}`}
      aria-label="Workspace navigation"
    >
      <div className="nav-title">
        <span>YOUR WORKSPACE</span>
        <button
          className="icon-button"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          onClick={toggle}
        >
          {collapsed ? (
            <PanelLeftOpen size={16} />
          ) : (
            <PanelLeftClose size={16} />
          )}
        </button>
      </div>
      <div
        className="sidebar-workspace"
        title={`${context.company.name} / ${project ? projectLabel(project.id, project.name) : "No active project"}`}
      >
        <strong>{context.company.name}</strong>
        <span>{project ? projectLabel(project.id, project.name) : "No active project"}</span>
        <small>
          <ShieldCheck size={11} />
          {context.role} · Scoped access
        </small>
      </div>
      <div className="nav-destinations">
        {destinations.map((item, i) => {
          const count =
            item.id === "investigations"
              ? counts?.runs
              : item.id === "access-requests"
                ? counts?.pendingRequests
                : undefined;
          return (
            <div key={item.id}>
              {(i === 0 || destinations[i - 1].group !== item.group) && (
                <p className="nav-group">{item.group}</p>
              )}
              <button
                aria-label={item.label}
                title={`${item.label}${count === undefined ? "" : ` (${count}, ${item.id === "investigations" ? "this session" : "loaded pending requests"})`}`}
                className={`nav-item ${view === item.id ? "active" : ""}`}
                aria-current={view === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {count !== undefined && (
                  <span
                    className="nav-count"
                    aria-label={`${count} ${item.id === "investigations" ? "session investigations" : "loaded pending requests"}`}
                  >
                    {count}
                  </span>
                )}
                {view === item.id && <i aria-hidden="true" />}
              </button>
            </div>
          );
        })}
      </div>
      <div className="nav-bottom">
        <div className="sidebar-person">
          <span className="avatar" aria-hidden="true">
            {context.identity.name
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("")}
          </span>
          <div>
            <strong>{context.identity.name}</strong>
            <small>{context.role}</small>
          </div>
        </div>
        <button
          className="nav-item"
          aria-label="Change token"
          title="Change token"
          onClick={changeToken}
        >
          <Fingerprint size={18} />
          <span>Change token</span>
        </button>
      </div>
    </nav>
  );
}
