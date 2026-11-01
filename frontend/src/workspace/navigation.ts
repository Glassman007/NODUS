import {
  Activity,
  FileCheck2,
  FolderKanban,
  GitFork,
  LayoutDashboard,
  Network,
  Search,
  ShieldCheck,
  GitPullRequest,
  ScrollText,
  ClipboardCheck,
  Bell,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AuthorizationContext } from "../auth/models";
export type View =
  | "tasks"
  | "notifications"
  | "overview"
  | "investigations"
  | "projects"
  | "activity"
  | "knowledge"
  | "dependencies"
  | "decisions"
  | "verification"
  | "access"
  | "access-requests";
interface Destination {
  id: View;
  label: string;
  icon: LucideIcon;
  group: string;
  permission?: string;
  description: string;
}
export const views: readonly Destination[] = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    group: "WORKSPACE",
    description: "Your active project and investigation workspace.",
  },
  {
    id: "investigations",
    label: "My Investigations",
    icon: Search,
    group: "WORKSPACE",
    description: "Open and review investigations run in this project session.",
  },
  {id:"tasks",label:"Tasks",icon:ClipboardCheck,group:"WORKSPACE",description:"Evidence-backed remediation work and team progress.",permission:"READ_GRAPH"},
  {id:"notifications",label:"Notifications",icon:Bell,group:"WORKSPACE",description:"Authorized team assignment notifications.",permission:"READ_GRAPH"},
  {
    id: "projects",
    label: "Projects",
    icon: FolderKanban,
    group: "WORKSPACE",
    description: "Project assignments returned by your authenticated session.",
  },
  {
    id: "activity",
    label: "Recent Activity",
    icon: Activity,
    group: "WORKSPACE",
    description:
      "Investigation activity from this project session. Earlier activity is not available through the API.",
  },
  {
    id: "knowledge",
    label: "Knowledge & Evidence",
    icon: Network,
    group: "INTELLIGENCE",
    description:
      "Inspect authorized source metadata and search accessible graph entities.",
    permission: "READ_GRAPH",
  },
  {
    id: "dependencies",
    label: "Knowledge & Dependencies",
    icon: GitFork,
    group: "INTELLIGENCE",
    description:
      "Search accessible entities, then inspect their connections and reverse dependencies.",
    permission: "READ_GRAPH",
  },
  {
    id: "decisions",
    label: "Decisions",
    icon: ScrollText,
    group: "INTELLIGENCE",
    description:
      "Search graph entities and view results whose server-returned type is DECISION.",
    permission: "READ_GRAPH",
  },
  {
    id: "verification",
    label: "Verification Results",
    icon: FileCheck2,
    group: "INTELLIGENCE",
    description:
      "Review evidence references, coverage limitations and rejected claims from session investigations. Independent verification is not exposed by this API.",
  },
  {
    id: "access",
    label: "My Access",
    icon: ShieldCheck,
    group: "ACCOUNT",
    description:
      "Your authenticated identity, project assignments and granted permissions.",
  },
  {
    id: "access-requests",
    label: "Access Requests",
    icon: GitPullRequest,
    group: "ACCOUNT",
    description:
      "Retrieve your access requests or review pending requests when authorized.",
  },
];
export function allowedViews(context: AuthorizationContext) {
  return views.filter(
    (view) =>
      !view.permission ||
      context.permissions.includes(view.permission) ||
      context.permissions.includes("ADMIN"),
  );
}
export function storedSidebarPreference(): boolean {
  try {
    return localStorage.getItem("nodus.sidebar.collapsed") === "true";
  } catch {
    return false;
  }
}
